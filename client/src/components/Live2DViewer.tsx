// src/components/Live2DViewer.tsx
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "../lib/live2d-compat";

type FitMode = "contain" | "cover";

type Props = {
  // foreground (character)
  modelUrl: string;
  entryMotion?: string;
  idleMotion?: string;

  // background (optional)
  bgModelUrl?: string;
  bgEntryMotion?: string;
  bgIdleMotion?: string;

  // layout / fit
  scale?: number;            // manual FG scale; if omitted, auto-fit
  bgScale?: number;          // manual BG scale; if omitted, auto-fit
  fitPadding?: number;       // 0..1 (default 0.9) used on FG auto-fit
  fitMode?: FitMode;         // FG auto-fit mode (default: "contain")
  bgFitMode?: FitMode;       // BG auto-fit mode (default: "cover")
  offsetX?: number;
  offsetY?: number;
  bgOffsetX?: number;
  bgOffsetY?: number;

  // interactions
  lookAtMouse?: boolean;     // default false

  // caching / persistence
  cacheKey?: string;         // default: `${modelUrl}||${bgModelUrl || ""}`
  persistent?: boolean;      // default: true (keep app/models alive across unmounts)
};

type CacheEntry = {
  app: PIXI.Application;
  stageRoot: PIXI.Container; // we attach models to this (so stage can have other stuff)
  fg?: Live2DModel;
  bg?: Live2DModel;
  refCount: number;
  initialized: boolean;
};

const L2D_CACHE = new Map<string, CacheEntry>();
let TICKER_REGISTERED = false;

function ensureTickerRegistered() {
  if (TICKER_REGISTERED) return;
  try {
    (Live2DModel as any).registerTicker((PIXI as any).Ticker);
    TICKER_REGISTERED = true;
  } catch {
    // ignore
  }
}

function fitModel(opts: {
  model: Live2DModel;
  canvasW: number;
  canvasH: number;
  mode: FitMode;
  padding: number; // 0..1
  offsetX?: number;
  offsetY?: number;
  manualScale?: number;
}) {
  const { model, canvasW, canvasH, mode, padding, offsetX = 0, offsetY = 0, manualScale } = opts;
  // anchor center if available
  try { (model as any).anchor?.set?.(0.5, 0.5); } catch {}

  if (manualScale && manualScale > 0) {
    model.scale.set(manualScale);
    model.position.set(canvasW / 2 + offsetX, canvasH / 2 + offsetY);
    return;
  }

  // derive size from bounds
  const b = model.getBounds();
  const mw = Math.max(1, b.width);
  const mh = Math.max(1, b.height);

  const sx = canvasW / mw;
  const sy = canvasH / mh;
  const base = mode === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const clampedPad = Math.min(Math.max(padding, 0), 0.95);
  const s = base * (1 - clampedPad);

  if (Number.isFinite(s) && s > 0) model.scale.set(s);
  // recalc center offset after scale
  const nb = model.getBounds();
  const cx = nb.x + nb.width / 2;
  const cy = nb.y + nb.height / 2;
  const dx = canvasW / 2 - (cx - (model as any).x);
  const dy = canvasH / 2 - (cy - (model as any).y);
  model.position.set(dx + offsetX, dy + offsetY);
}

async function playMotions(model: Live2DModel | undefined, entry?: string, idle?: string) {
  if (!model) return;
  try {
    const defs = (model as any)?.internalModel?.motionManager?.definitions as Record<string, any[]> | undefined;
    const groups = defs ? Object.keys(defs) : [];

    const resolvedEntry = entry && groups.includes(entry)
      ? entry
      : groups.find((g) => /entry/i.test(g)) ?? groups[0];

    const resolvedIdle = idle && groups.includes(idle)
      ? idle
      : groups.find((g) => /loop/i.test(g)) ?? resolvedEntry;

    const play = (m: Live2DModel, group?: string, loop = false) => {
      if (!group) return false;
      try {
        const res = (m as any).motion(group, 0, 2);
        if (loop && res && typeof res.then === "function") {
          res.then(() => play(m, group, true));
        } else if (loop) {
          (m as any).once?.("motionFinish", () => play(m, group, true));
        }
        return true;
      } catch {
        return false;
      }
    };

    if (!play(model, resolvedEntry, false)) {
      play(model, resolvedIdle, true);
    } else {
      (model as any).once?.("motionFinish", () => play(model, resolvedIdle, true));
    }
  } catch {
    // ignore
  }
}

function setInteractionMode(model: Live2DModel | undefined, look: boolean) {
  if (!model) return;
  try { (model as any).eventMode = "none"; (model as any).interactive = false; } catch {}
  try { (model as any).autoInteract = !!look; } catch {}
  try {
    const im = (model as any).internalModel;
    if (im?.focusController) im.focusController.enabled = !!look;
    if (!look && im?.dragManager) {
      try { im.dragManager.isDragging = false; } catch {}
      try { im.dragManager.update?.(0, 0, 0); } catch {}
      try { im.dragManager._targetX = 0; im.dragManager._targetY = 0; } catch {}
    }
  } catch {
    // ignore
  }
}

export default function Live2DViewer(props: Props) {
  const {
    modelUrl,
    entryMotion = "entry_animation15",
    idleMotion = "loop",
    bgModelUrl,
    bgEntryMotion,
    bgIdleMotion,
    scale,
    bgScale,
    fitPadding = 0.9,
    fitMode = "contain",
    bgFitMode = "cover",
    offsetX = 0,
    offsetY = 0,
    bgOffsetX = 0,
    bgOffsetY = 0,
    lookAtMouse = false,
    cacheKey: customKey,
    persistent = true,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const entryRef = useRef<CacheEntry | null>(null);
  const viewAttachedRef = useRef(false);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  ensureTickerRegistered();

  const cacheKey = useMemo(
    () => (customKey ?? `${modelUrl}||${bgModelUrl || ""}`),
    [customKey, modelUrl, bgModelUrl]
  );

  // Acquire/create cache entry (no DOM)
  if (!entryRef.current) {
    const existing = L2D_CACHE.get(cacheKey);
    if (existing) {
      existing.refCount += 1;
      entryRef.current = existing;
    } else {
      const app = new PIXI.Application({
        width: 1280,
        height: 720,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        powerPreference: "high-performance",
      });
      try {
        (app.renderer as any).eventsDeprecated = false;
        const ev = (app.renderer as any).events;
        if (ev) ev.autoPreventDefault = false;
        app.stage.sortableChildren = true;
        app.stage.interactiveChildren = false;
        app.stage.interactive = false;
      } catch {}
      const stageRoot = new PIXI.Container();
      app.stage.addChild(stageRoot);
      const fresh: CacheEntry = { app, stageRoot, refCount: 1, initialized: false };
      L2D_CACHE.set(cacheKey, fresh);
      entryRef.current = fresh;
    }
  }

  // Load models once per cache entry (cold start)
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const entry = entryRef.current!;
      if (!entry.initialized) {
        try {
          // Load BG first (under)
          if (bgModelUrl) {
            entry.bg = (await Live2DModel.from(bgModelUrl)) as Live2DModel;
            // guard: entry.bg may be undefined if load failed; protect usage
            if (entry.bg) {
              try { setInteractionMode(entry.bg, false); } catch {}
              try { (entry.bg as any).zIndex = 0; } catch {}
              try { entry.stageRoot.addChild(entry.bg as unknown as PIXI.DisplayObject); } catch {}
            }
          }

          // Load FG on top
          entry.fg = (await Live2DModel.from(modelUrl)) as Live2DModel;
          if (entry.fg) setInteractionMode(entry.fg, lookAtMouse);
          // guard: entry.fg may be undefined if load failed; protect zIndex and addChild
          if (entry.fg) {
            try { (entry.fg as any).zIndex = 1; } catch {}
            try { entry.stageRoot.addChild(entry.fg as unknown as PIXI.DisplayObject); } catch {}
          }

          entry.initialized = true;

          if (!cancelled) {
            // Start default motions on cold load
            await Promise.all([
              playMotions(entry.bg, bgEntryMotion, bgIdleMotion),
              playMotions(entry.fg, entryMotion, idleMotion),
            ]);
          }
        } catch (e) {
          console.error("[Live2D] load error:", e);
        }
      } else {
        // Hot reuse: just update interaction mode (in case prop changed)
        if (entry.fg) setInteractionMode(entry.fg, lookAtMouse);
      }
    };

    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]); // if cacheKey changes, a new entryRef will be created before this runs

  // Attach canvas to this host; detach on unmount (do not destroy app/models unless no refs)
  useLayoutEffect(() => {
    const entry = entryRef.current!;
    const host = hostRef.current!;
    const view = entry.app.view as HTMLCanvasElement;

    // attach if not already parented here
    if (view.parentElement !== host) {
      host.appendChild(view);
      view.style.pointerEvents = "none";
      view.classList.add("live2d-canvas");
      viewAttachedRef.current = true;
      // ensure ticker running
      try { if (!entry.app.ticker.started) entry.app.ticker.start(); } catch {}
    }

    // Size to host using ResizeObserver
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      entry.app.renderer.resize(w, h);

      // Lay out models
      if (entry.bg) {
        fitModel({
          model: entry.bg,
          canvasW: w,
          canvasH: h,
          mode: bgFitMode,
          padding: 0,
          offsetX: bgOffsetX,
          offsetY: bgOffsetY,
          manualScale: bgScale,
        });
      }
      if (entry.fg) {
        fitModel({
          model: entry.fg,
          canvasW: w,
          canvasH: h,
          mode: fitMode,
          padding: fitPadding,
          offsetX,
          offsetY,
          manualScale: scale,
        });
      }
    });

    ro.observe(host);
    resizeObsRef.current = ro;

    return () => {
      try { ro.disconnect(); } catch {}
      resizeObsRef.current = null;

      // Detach the canvas but keep app running if persistent
      if (viewAttachedRef.current && view.parentElement === host) {
        try { host.removeChild(view); } catch {}
        viewAttachedRef.current = false;
      }

      // Decrement refcount; destroy only when last user unmounts or persistent=false
      const entry = entryRef.current!;
      entry.refCount -= 1;

      const shouldDestroy = entry.refCount <= 0 || !persistent;
      if (shouldDestroy) {
        try {
          // remove from cache first to prevent reuse after destroy
          L2D_CACHE.delete(cacheKey);
        } catch {}
        try {
          // destroy children/models safely
          entry.stageRoot.removeChildren().forEach((c) => {
            try {
              // Live2DModel has .destroy
              (c as any).destroy?.({ children: true, texture: true, baseTexture: true });
            } catch {}
          });
        } catch {}
        try {
          entry.app.destroy(true, { children: true, texture: true, baseTexture: true } as any);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, fitMode, bgFitMode, fitPadding, scale, bgScale, offsetX, offsetY, bgOffsetX, bgOffsetY, persistent]);

  // If lookAtMouse changes while mounted, update interaction mode on fg
  useEffect(() => {
    const entry = entryRef.current!;
    setInteractionMode(entry.fg, lookAtMouse);
  }, [lookAtMouse]);

  return <div ref={hostRef} className="nc-live2d" />;
}

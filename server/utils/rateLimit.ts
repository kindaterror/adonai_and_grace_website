import { Request, Response, NextFunction } from "express";

type Keyer = (req: Request) => string;

interface Options {
  windowMs: number;   // time window in ms
  max: number;        // max requests per window
  keyer?: Keyer;      // how to build the key
  message?: string;   // message when limited
}

// Very small in-memory bucket store (OK for single-process dev/prod)
const buckets = new Map<string, { count: number; expiresAt: number }>();

export function simpleRateLimit(opts: Options) {
  // Clamp window and max to reasonable values to avoid abuse
  const DEFAULT_WINDOW = 10 * 60 * 1000; // 10m
  const MAX_WINDOW = 24 * 60 * 60 * 1000; // 24h
  const windowMsRaw = Number(opts.windowMs ?? DEFAULT_WINDOW) || DEFAULT_WINDOW;
  const windowMs = Math.min(Math.max(1000, windowMsRaw), MAX_WINDOW);

  const maxRaw = Number(opts.max ?? 5) || 5;
  const max = Math.min(Math.max(1, maxRaw), 1000);
  const keyer: Keyer =
    opts.keyer ??
    ((req) => {
      // Mix IP + email/username when available to scope better
      try {
        const rawEmail = (req.body?.email as any) || (req.body?.username as any) || (req.query?.email as any) || "";
        const email = String(rawEmail || "").slice(0, 200).toLowerCase();
        const ip = String(req.ip || "unknown").slice(0, 100);
        return `${ip}::${email}`;
      } catch {
        return String(req.ip || "unknown");
      }
    });

  const message =
    opts.message ?? "Too many attempts. Please try again later.";

  // occasional prune of expired buckets (keeps memory bounded)
  function pruneExpired() {
    const now = Date.now();
    buckets.forEach((v, k) => {
      if (v.expiresAt <= now) buckets.delete(k);
    });
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // small probabilistic prune to avoid expensive ops on every request
    if (Math.random() < 0.01) pruneExpired();

    const key = (() => {
      try {
        return keyer(req);
      } catch (e) {
        return String(req.ip || "unknown");
      }
    })();

    const now = Date.now();
    const entry = buckets.get(key);

    // new bucket or expired -> reset
    if (!entry || now > entry.expiresAt) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({ success: false, message });
    }

    entry.count += 1;
    return next();
  };
}

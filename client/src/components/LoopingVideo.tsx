// src/components/LoopingVideo.tsx
import React, { useEffect, useRef } from "react";

type Props = {
  srcMp4: string;
  srcWebm?: string;
  poster?: string;

  /** First pass: start time (seconds). Default: 0 */
  initialStart?: number;

  /** First pass: end time (seconds). Default: video duration */
  initialEnd?: number;

  /** Loop segment start (seconds). If undefined, loops entire video */
  loopStart?: number;

  /** Loop segment end (seconds). If undefined, loops entire video */
  loopEnd?: number;

  /** Playback rate for the video. Default: 1 */
  playbackRate?: number;

  /** Muted is required for mobile autoplay. Default: true */
  muted?: boolean;

  /** Class forwarded to the <video> (for sizing/styling) */
  className?: string;

  /** Pass through to <video>. Default: true */
  autoPlay?: boolean;

  /** Pass through to <video>. Default: true */
  playsInline?: boolean;

  /** Pass through to <video>. Default: true (and ignored when a custom segment is set) */
  loop?: boolean;

  /** Optional error handler for the <video> element */
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
};

/** Persist playback per source across unmounts */
type ResumeState = {
  time: number;
  wasPlaying: boolean;
  hasDoneInitial: boolean;
};
const resumeCache = new Map<string, ResumeState>();

export default function LoopingVideo({
  srcMp4,
  srcWebm,
  poster,
  initialStart = 0,
  initialEnd, // if undefined, we'll use duration
  loopStart,
  loopEnd,
  playbackRate = 1,
  muted = true,
  className,
  autoPlay = true,
  playsInline = true,
  loop = true,
  onError,
}: Props) {
  const vref = useRef<HTMLVideoElement | null>(null);
  const hasDoneInitialRef = useRef<boolean>(false);

  const hasCustomSegment =
    typeof loopStart === "number" &&
    typeof loopEnd === "number" &&
    loopEnd > loopStart;

  const shouldUseNativeLoop = loop && !hasCustomSegment;

  // When the source changes, load cached flags for that source
  useEffect(() => {
    const cached = resumeCache.get(srcMp4);
    hasDoneInitialRef.current = cached?.hasDoneInitial ?? false;
  }, [srcMp4]);

  useEffect(() => {
    const v = vref.current;
    if (!v) return;

    // Keep base attributes in sync
    v.playbackRate = playbackRate;
    v.muted = muted;
    v.playsInline = playsInline;
    v.controls = false;

    // Decide whether to use native loop or manual segment loop
    v.loop = shouldUseNativeLoop;

    const seekSafely = (t: number) => {
      try {
        v.currentTime = Math.max(0, t);
      } catch {
        // Safari may throw if we seek too early; we'll retry on loadedmetadata.
      }
    };

    const tryPlay = () => {
      if (!autoPlay) return;
      void v.play().catch(() => {
        // ignore autoplay rejections (e.g., unmuted videos)
      });
    };

    const restoreFromCache = () => {
      const cached = resumeCache.get(srcMp4);
      if (cached) {
        hasDoneInitialRef.current = cached.hasDoneInitial;
        seekSafely(cached.time);
        if (cached.wasPlaying) tryPlay();
      } else {
        hasDoneInitialRef.current = false;
        seekSafely(initialStart || 0);
        tryPlay();
      }
    };

    const onLoadedMetadata = () => {
      const cached = resumeCache.get(srcMp4);
      if (cached) {
        const clamped = Math.min(Math.max(0, cached.time), v.duration || cached.time);
        seekSafely(clamped);
        if (cached.wasPlaying) tryPlay();
      } else {
        seekSafely(initialStart || 0);
        tryPlay();
      }
    };

    const onTimeUpdate = () => {
      if (!v.duration || v.currentTime === undefined) return;

      const finalInitialEnd = typeof initialEnd === "number" ? initialEnd : v.duration;

      // First pass: initialStart -> initialEnd
      if (!hasDoneInitialRef.current && v.currentTime >= finalInitialEnd) {
        hasDoneInitialRef.current = true;

        if (hasCustomSegment) {
          seekSafely(loopStart as number);
        } else if (loop) {
          // No custom segment; if loop=true, restart from 0
          seekSafely(0);
        }
      }

      // Loop window enforcement after initial pass (manual segment)
      if (hasCustomSegment && hasDoneInitialRef.current) {
        if (v.currentTime >= (loopEnd as number) || v.currentTime < (loopStart as number)) {
          seekSafely(loopStart as number);
        }
      }
    };

    const onEnded = () => {
      // Only restart automatically if native loop is disabled *and* we still want looping (no custom segment)
      if (!hasCustomSegment && loop) {
        seekSafely(0);
        void v.play();
      }
    };

    /** Save state frequently so remounts can resume smoothly */
    const saveResumeState = () => {
      resumeCache.set(srcMp4, {
        time: v.currentTime || 0,
        wasPlaying: !v.paused && !v.ended,
        hasDoneInitial: hasDoneInitialRef.current,
      });
    };

    // First attach & restore
    restoreFromCache();

    // Listeners
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("timeupdate", saveResumeState);
    v.addEventListener("pause", saveResumeState);
    v.addEventListener("playing", saveResumeState);
    v.addEventListener("ended", onEnded);

    const onVisibility = () => {
      saveResumeState();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      // Save once more on unmount
      saveResumeState();

      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("timeupdate", saveResumeState);
      v.removeEventListener("pause", saveResumeState);
      v.removeEventListener("playing", saveResumeState);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    srcMp4,
    initialStart,
    initialEnd,
    loopStart,
    loopEnd,
    playbackRate,
    muted,
    autoPlay,
    playsInline,
    loop,
    shouldUseNativeLoop,
    hasCustomSegment,
  ]);

  return (
    <video
      ref={vref}
      className={className}
      poster={poster}
      muted={muted}
      autoPlay={autoPlay}
      playsInline={playsInline}
      loop={shouldUseNativeLoop}
      preload="metadata"
      controls={false}
      onError={
        onError ??
        ((e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
          // eslint-disable-next-line no-console
          console.error("Video error:", e.currentTarget?.error);
        })
      }
    >
      {srcWebm && <source src={srcWebm} type="video/webm" />}
      <source src={srcMp4} type="video/mp4" />
    </video>
  );
}

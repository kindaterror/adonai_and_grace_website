// Dynamic lazy shim for framer-motion to keep it out of the initial critical bundle.
// Usage: import { motion, AnimatePresence } from '@/lib/motionShim'
// This defers loading until a motion component actually mounts.
import React, { useEffect, useState, Suspense } from 'react';

type AnyComp = React.ComponentType<any>;

function loadFramer() {
  return import('framer-motion');
}

function createMotionTag(tag: string): AnyComp {
  const Wrapped: React.FC<any> = (props) => {
    const [Real, setReal] = useState<AnyComp | null>(null);
    useEffect(() => {
      let alive = true;
      loadFramer().then(mod => {
        const motionObj: any = (mod as any).motion;
        const RealTag = motionObj?.[tag];
        if (alive) setReal(() => RealTag || ((p: any) => <div {...p} />));
      });
      return () => { alive = false; };
    }, [tag]);
    if (!Real) return null; // fallback can be skeleton / span later
    return <Real {...props}>{props.children}</Real>;
  };
  Wrapped.displayName = `LazyMotion.${tag}`;
  return Wrapped;
}

export const motion: any = new Proxy({}, {
  get(_t, prop: string) {
    return createMotionTag(prop);
  }
});

export const AnimatePresence: React.FC<any> = (props) => {
  const [Comp, setComp] = useState<AnyComp | null>(null);
  useEffect(() => {
    let alive = true;
    loadFramer().then(mod => { if (alive) setComp(() => (mod as any).AnimatePresence); });
    return () => { alive = false; };
  }, []);
  if (!Comp) return null;
  return <Comp {...props} />;
};

// Optional helper to eagerly warm framer-motion after first interaction.
let warmed = false;
export function warmFramerMotion() {
  if (warmed) return; warmed = true; loadFramer();
}
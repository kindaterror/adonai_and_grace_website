// Dynamic shim for framer-motion to avoid pulling it into the initial critical bundle.
// Usage: import { motion, AnimatePresence } from '@/lib/motionShim';
// The first component access triggers a dynamic import of 'framer-motion'.
// This .ts file only re-exports the TSX implementation so esbuild/tsc parse it correctly.
export * from './motionShim.tsx';

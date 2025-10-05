// Compatibility wrapper for pixi-live2d-display entrypoints.
// Some package versions don't expose subpath imports (e.g. "pixi-live2d-display/cubism4").
// Import from the bundled dist file which exists across versions and re-export the symbol
// used by the app. Keep this wrapper in one place so future upgrades are easier.
export { Live2DModel } from "pixi-live2d-display/dist/cubism4";

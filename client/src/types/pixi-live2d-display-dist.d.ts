declare module "pixi-live2d-display/dist/cubism4" {
  import type { Container } from "pixi.js";

  export class Live2DModel extends Container {
    static from(url: string): Promise<Live2DModel>;
    static registerTicker(tickerClass: any): void;
    motion(group: string, a?: any, b?: any): any;
    getBounds(): { x: number; y: number; width: number; height: number };
    scale: { set: (v: number) => void };
    position: { set: (x: number, y: number) => void } & { x?: number; y?: number };
    internalModel?: any;
    once?: (evt: string, cb: () => void) => void;
    destroy?: (opts?: any) => void;
  }

  export default Live2DModel;
}

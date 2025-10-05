declare module 'compression' {
  import type { RequestHandler } from 'express';

  interface CompressionOptions {
    threshold?: number | string;
    level?: number;
    filter?: (req: any, res: any) => boolean;
    [key: string]: any;
  }

  function compression(options?: CompressionOptions): RequestHandler;

  export default compression;
}

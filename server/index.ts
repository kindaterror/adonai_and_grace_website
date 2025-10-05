import dotenv from "dotenv";
dotenv.config();
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { setupRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import { fileURLToPath } from 'url';
import cors from "cors";
import applySecurityHeaders, { getCSPHeader } from "./security";
import crypto from 'crypto';
import { runStartupSeed } from "./startupSeed";

// Environment configuration for deployment
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || '0.0.0.0');
const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on ${host}:${port}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Remove (where possible) the generic Server header sometimes added by upstream
app.use((req, res, next) => { try { res.removeHeader('Server'); } catch {} next(); });

// (Moved below CSP middleware so redirect responses also carry security headers)

// Security headers baseline
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));

// Optional compression (non-fatal if missing)
(async () => {
  try {
    const compressionMod: any = await import('compression');
    const compression = compressionMod.default || compressionMod;
    app.use(compression());
    log('Compression middleware enabled', 'startup');
  } catch (e) {
    log(`Compression not loaded: ${(e as Error).message}`, 'startup');
  }
})();

// Apply our custom security headers & CSP with per-request nonce
applySecurityHeaders(app);
app.use((req, res, next) => {
  try {
    // Generate a base64 nonce per request for any inline (script/style) we intentionally allow
    const nonce = crypto.randomBytes(16).toString('base64');
    (res as any).locals = (res as any).locals || {};
    (res as any).locals.cspNonce = nonce;
    const csp = getCSPHeader({ nonce });
    if (csp) res.setHeader("Content-Security-Policy", csp);
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), fullscreen=(self)");
  } catch {}
  next();
});

// Redirect plain HTTP to HTTPS in production (after headers so redirect also carries them)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    try {
      const xfProto = req.headers['x-forwarded-proto'];
      if (xfProto && typeof xfProto === 'string' && xfProto.split(',')[0] !== 'https') {
        const hostHeader = req.headers.host;
        if (hostHeader) {
          // Preserve method? For GET/HEAD a 301 is fine; others we could use 308. Simplicity: 301.
          return res.redirect(301, `https://${hostHeader}${req.url}`);
        }
      }
    } catch {}
    next();
  });
}

// JSON body parser with validation
app.use(express.json({
  limit: '100mb',
  strict: true,
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf.toString(encoding as BufferEncoding));
    } catch (e: any) {
      log(`Invalid JSON received: ${e.message || 'Unknown error'}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Invalid JSON format', error: e.message || 'Unknown error' }));
      throw new Error('Invalid JSON format');
    }
  }
}));

// URL-encoded parser
app.use(express.urlencoded({ extended: false, limit: '100mb', parameterLimit: 100000 }));

// ESM __dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Serve server/public
app.use(express.static(path.join(__dirname, "public"), { dotfiles: 'deny', maxAge: '7d' }));
// Serve client/public assets (built-time assets copied by Vite build or static extras)
const clientPublic = path.resolve(__dirname, "..", "client", "public");
app.use(express.static(clientPublic, { fallthrough: true, dotfiles: 'deny', maxAge: '7d' }));
app.use("/live2d", express.static(path.join(clientPublic, "live2d"), { fallthrough: false, dotfiles: 'deny' }));
app.use("/live2dcubismcore.min.js", express.static(path.join(clientPublic, "live2dcubismcore.min.js"), { fallthrough: false, dotfiles: 'deny' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const server = await setupRoutes(app);

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      console.error('Server error:', err);
      res.status(status).json({ message });
    });

    // Setup Vite for development or serve static files for production
    if (process.env.NODE_ENV !== "production") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Perform idempotent startup seed (non-blocking)
    runStartupSeed().catch(e => log(`Startup seed failed: ${(e as Error).message}`, 'seed'));

    // Start the server
    log(`Attempting to listen on ${host}:${port}`);
    server.on('error', (err) => {
      console.error('HTTP server error before listen:', err);
    });
    server.listen(port, host, () => {
      log(`Server running on http://${host}:${port}`);
      log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
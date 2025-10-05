import dotenv from "dotenv";
dotenv.config();
import express, { type Request, Response, NextFunction } from "express";
import compression from 'compression';
import helmet from "helmet";
import { setupRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import { fileURLToPath } from 'url';
import cors from "cors";
import applySecurityHeaders, { getCSPHeader } from "./security";
// Environment configuration for deployment
const host = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on ${host}:${port}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Apply Helmet with a conservative base configuration. We still set a CSP
// header manually below to allow fine-grained tuning in `security.ts`.
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false, // we will set CSP header manually
  })
);

// Enable gzip compression for responses (small, safe middleware)
app.use(compression());

// Apply our lightweight security headers and CSP generator
applySecurityHeaders(app);
app.use((req, res, next) => {
  try {
    const csp = getCSPHeader();
    if (csp) res.setHeader("Content-Security-Policy", csp);
    // HSTS for production only
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
  } catch (e) {
    // swallow header errors to avoid crashing
  }
  next();
});

// Configure JSON body parser with increased limits for large images
app.use(express.json({
  limit: '100mb',
  strict: true,
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf.toString(encoding as BufferEncoding));
    } catch (e: any) {
      log(`Invalid JSON received: ${e.message || 'Unknown error'}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Invalid JSON format',
        error: e.message || 'Unknown error'
      }));
      throw new Error('Invalid JSON format');
    }
  }
}));

// Updated URL-encoded parser with increased limits
app.use(express.urlencoded({ 
  extended: false, 
  limit: '100mb',
  parameterLimit: 100000
}));


// ESM __dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve static files (deny dotfiles to avoid accidental exposure)
app.use(express.static(path.join(__dirname, "public"), { dotfiles: 'deny', maxAge: '7d' }));

/* ----------------- ADDED: serve client/public assets (Live2D) ----------------- */
// Absolute path to client/public
const clientPublic = path.resolve(__dirname, "..", "client", "public");

// Serve everything in client/public (so /images, etc. work too) with caching
app.use(express.static(clientPublic, { fallthrough: true, dotfiles: 'deny', maxAge: '7d' }));

// Ensure /live2d/* is always served as real files (not rewritten by SPA fallback)
app.use("/live2d", express.static(path.join(clientPublic, "live2d"), { fallthrough: false, dotfiles: 'deny' }));

// Ensure the Cubism runtime is always served
app.use("/live2dcubismcore.min.js",
  express.static(path.join(clientPublic, "live2dcubismcore.min.js"), { fallthrough: false, dotfiles: 'deny' })
);
/* ----------------------------------------------------------------------------- */

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

    // Start the server
    server.listen(port, host, () => {
      log(`Server running on http://${host}:${port}`);
      log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
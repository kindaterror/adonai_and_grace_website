import express, { type Express, type Request, type Response, type NextFunction } from "express";
import crypto from 'crypto';

/**
 * Minimal security helpers placeholder.
 *
 * This file is intentionally conservative: it provides small helpers to
 * register a few safe HTTP headers and to perform light payload sanitation.
 * They are designed to be no-ops if not used and to avoid side-effects when
 * imported.
 */

// Lightweight middleware to set a few safe security headers.
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Intentionally do not set CSP here; CSP needs to be tuned to the app and may
    // vary by route (and may include nonces).
  } catch (e) {
    // Swallow header errors to avoid crashing when headers are already sent.
  }
  next();
}

// Conservative payload sanitizer: trim strings and cap their length. This is
// intentionally non-destructive and will not mutate non-plain objects.
export function sanitizePayloadMiddleware(req: Request, _res: Response, next: NextFunction) {
  const MAX_STRING_LEN = 10000; // generous upper bound

  function sanitize(obj: any) {
    if (!obj || typeof obj !== "object") return obj;

    // Only operate on plain objects and arrays to avoid touching special types
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i];
        if (typeof v === "string") obj[i] = v.trim().slice(0, MAX_STRING_LEN);
        else if (typeof v === "object" && v !== null) sanitize(v);
      }
      return obj;
    }

    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        if (typeof val === "string") {
          obj[key] = val.trim().slice(0, MAX_STRING_LEN);
        } else if (typeof val === "object" && val !== null) {
          sanitize(val);
        }
        // leave other types untouched
      } catch (e) {
        // Ignore errors during sanitation for safety.
      }
    }
    return obj;
  }

  if (req && req.body && typeof req.body === "object") {
    // Work on a shallow clone to avoid unexpected prototype pollution when
    // consumers rely on exact object identity. Most handlers will read req.body
    // synchronously after parser middleware.
    try {
      // Only clone at top-level to keep performance reasonable.
      const topClone = Array.isArray(req.body) ? [...req.body] : { ...req.body };
      sanitize(topClone);
      req.body = topClone as any;
    } catch (e) {
      // If sanitation fails, do not block the request — fail open.
    }
  }

  next();
}

export function applySecurityHeaders(app?: Express) {
  if (!app || typeof app.use !== "function") return;
  // Register a middleware that sets common security headers.
  app.use(securityHeadersMiddleware);
  // Optionally expose a CSP report receiver if configured. This endpoint
  // accepts the browser's CSP violation reports and logs them so you can
  // iterate on the policy safely in production.
  const enableReportEndpoint = (process.env.CSP_ENABLE_REPORT_ENDPOINT || 'false').toLowerCase() === 'true';
  if (enableReportEndpoint) {
    // Lightweight receiver: browsers may POST either `application/csp-report`
    // or JSON with a `csp-report` field. We keep this permissive and log the
    // payload for later analysis.
    app.post('/csp-report', express.json({ limit: '1mb' }), (req: Request, res: Response) => {
      try {
        const payload = req.body || {};
        // If the browser puts the report under `csp-report` (Firefox), pick it
        const report = (payload['csp-report'] || payload) as any;
        console.warn('[CSP REPORT]', JSON.stringify(report));
      } catch (e) {
        console.warn('[CSP REPORT] invalid payload');
      }
      // 204 No Content
      res.status(204).end();
    });
  }
}

export default applySecurityHeaders;

// Small helper to produce a conservative CSP string. It is intentionally
// permissive for development (allows localhost and 'unsafe-inline' if NODE_ENV
// is not production) and more strict for production. Adjust as you add
// third-party resources (Cloudinary, analytics, etc.).
export interface BuildCSPOptions { nonce?: string }
export function getCSPHeader(opts: BuildCSPOptions = {}): string {
  const isProd = process.env.NODE_ENV === "production";
  const additionalHostsRaw = process.env.CSP_ADDITIONAL_HOSTS || '';
  const additionalHosts = additionalHostsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const enableReportEndpoint = (process.env.CSP_ENABLE_REPORT_ENDPOINT || 'false').toLowerCase() === 'true';
  const nonce = opts.nonce;

  // Base directives
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // Forbid inline event handler attributes explicitly (CSP3). Older browsers ignore this.
    "script-src-attr": ["'none'"],
    // Allow external Google Fonts stylesheet + inline (dev) + self-hosted styles
    // We explicitly add https://fonts.googleapis.com below (prod + dev) so the link tag works under CSP.
  // Radix UI + some component libraries inject inline style attributes. To avoid
  // widespread CSP violations we allow 'unsafe-inline' for styles. If you later
  // refactor to eliminate inline styles, you can remove 'unsafe-inline' and
  // move styles into stylesheet files.
  // We will include a nonce in production instead of 'unsafe-inline'. During dev we still allow inline for HMR.
  "style-src": ["'self'", "https://fonts.googleapis.com"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'"],
  // media-src controls allowed sources for <audio> and <video>
  "media-src": ["'self'", "data:", "blob:"],
    // Allow font files from Google Fonts CDN (woff2) and data: for small embeds
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    // Added to satisfy scanners complaining about missing directive fallback
    "form-action": ["'self'"],
    // Forbid legacy plugin content
    "object-src": ["'none'"],
    // Defensive: disallow embedding other frames unless explicitly added later
    "frame-src": ["'none'"],
    // Older directive aliasing potential child browsing contexts (defense in depth)
    "child-src": ["'none'"],
    // Explicit worker sources (if future workers added they must come from self or blob)
    "worker-src": ["'self'", "blob:"],
    // App manifest (allow self if you later add it)
    "manifest-src": ["'self'"],
  };

  // Allow cloudinary and local dev host for images and connect
  // Known trusted hosts (Cloudinary for images/uploads). Add any CDN origins you use here.
  directives["img-src"].push("https://res.cloudinary.com");
  // Allow cloudinary for media as well (audio/video served from Cloudinary)
  directives["media-src"].push("https://res.cloudinary.com");
  directives["connect-src"].push("https://api.cloudflare.com", "https://res.cloudinary.com");
  // Optionally allow the deployed render domain explicitly via env var DEPLOY_PUBLIC_ORIGIN
  const publicOrigin = process.env.DEPLOY_PUBLIC_ORIGIN;
  if (publicOrigin) {
    try {
      const u = new URL(publicOrigin);
      directives["connect-src"].push(u.origin);
      directives["img-src"].push(u.origin);
      directives["media-src"].push(u.origin);
    } catch { /* ignore invalid */ }
  }

  // Include any additional hosts provided via CSP_ADDITIONAL_HOSTS env var
  if (additionalHosts.length) {
    for (const host of additionalHosts) {
      // Add to the common directives where it makes sense
      directives["img-src"].push(host);
      directives["connect-src"].push(host);
      directives["media-src"].push(host);
    }
  }

  // In development allow a few relaxations for HMR and quick prototyping.
  if (!isProd) {
    directives["script-src"].push("'unsafe-eval'", "'unsafe-inline'", "http://localhost:*");
    directives["style-src"].push("'unsafe-inline'", "http://localhost:*");
    directives["connect-src"].push("ws://localhost:*", "http://localhost:*");
  } else {
    // Production tightening: disallow unsafe-inline/eval and add upgrade directive
    // Consider adding nonces for inline scripts if you must allow them.
    directives["upgrade-insecure-requests"] = [];
    if (nonce) {
      directives["script-src"].push(`'nonce-${nonce}'`);
      directives["style-src"].push(`'nonce-${nonce}'`);
    }
    if (enableReportEndpoint) {
      // Report to our local endpoint; browsers will send JSON POSTs here when a
      // policy violation occurs. This should be protected in prod (rate-limited
      // and authenticated) if you enable it for public traffic.
      directives["report-uri"] = ["/csp-report"];
    }
    // Provide a report-uri (or report-to) for CSP violation reporting if you have an endpoint.
    // directives["report-uri"] = ["https://your-report-endpoint.example.com/csp-report"];
  }

  // Build header string
  return Object.entries(directives)
    .map(([k, vals]) => `${k} ${vals.join(" ")}`)
    .join("; ");
}

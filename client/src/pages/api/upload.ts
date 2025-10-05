// == IMPORTS & DEPENDENCIES ==
import type { IncomingMessage, ServerResponse } from "http";
import busboy, { BusboyConfig } from "busboy";
import type { Busboy as BusboyInstance } from "busboy";
import { v2 as cloudinary } from "cloudinary";
import crypto from "crypto";

// === SECURITY / HARDENING CONSTANTS ===
const DEFAULT_MAX_MB = 5;
const HARD_MAX_MB = 50; // absolute cap for uploads
const HARD_MAX_BYTES = HARD_MAX_MB * 1024 * 1024;
const ALLOWED_KINDS = new Set([
  "avatar",
  "book_cover",
  "page_image",
  "page_audio",
  "asset",
]);

function sanitizeFolderInput(f?: string): string | undefined {
  if (!f) return undefined;
  // allow alphanum, dash, underscore, slash only and prevent traversal
  if (/\.\.|(^\/)|(^\\\\)/.test(f)) return undefined;
  const sanitized = f.replace(/[^a-zA-Z0-9_\-\/]/g, "").replace(/\/+/g, "/");
  return sanitized || undefined;
}

function sanitizePublicIdInput(p?: string): string | undefined {
  if (!p) return undefined;
  // Cloudinary allows alphanumeric chars, underscores, hyphens, and forward slashes
  // Remove any invalid characters and trim length
  const s = p.replace(/[^a-zA-Z0-9_\-\/]/g, "_").slice(0, 100);
  return s || undefined;
}

function sanitizeFilenameInput(name?: string): string | undefined {
  if (!name) return undefined;
  // strip any path segments and control characters
  const base = name.replace(/\\\\/g, "/").split("/").pop() || name;
  // Remove hashtags, special characters, and control characters
  const s = base
    .replace(/#[a-zA-Z0-9_]+/g, "") // remove hashtags
    .replace(/[^\w\s\-\.]/g, "") // keep only word chars, spaces, hyphens, dots
    .replace(/\s+/g, "_") // replace spaces with underscores
    .replace(/[\x00-\x1F\x7F]/g, "") // remove control characters
    .slice(0, 120);
  return s || undefined;
}

// == API CONFIGURATION ==
// (Used by Next-like runtimes; harmless under Express passthrough)
export const config = {
  api: { bodyParser: false },
};

// == CLOUDINARY SETUP ==
if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  // eslint-disable-next-line no-console
  console.warn(
    "[upload.ts] Missing Cloudinary env vars. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  api_key: process.env.CLOUDINARY_API_KEY ?? "",
  api_secret: process.env.CLOUDINARY_API_SECRET ?? "",
});

// == TYPES ==
type MultipartResult = {
  fields: Record<string, string>;
  fileBuffer?: Buffer;
  filename?: string;
  mimetype?: string;
};

// == HELPERS ==
function parseMultipart(req: IncomingMessage, maxBytes = DEFAULT_MAX_MB * 1024 * 1024): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const bb: BusboyInstance = busboy({ headers: req.headers, limits: { fileSize: Math.min(maxBytes, HARD_MAX_BYTES) } } as BusboyConfig);
    const fields: Record<string, string> = {};

    let fileBuffer: Buffer | undefined;
    let filename: string | undefined;
    let mimetype: string | undefined;

    bb.on("file", (_name, file, info: { filename: string; mimeType: string }) => {
      // sanitize file meta
      filename = sanitizeFilenameInput(info.filename);
      mimetype = info.mimeType;

      const chunks: Buffer[] = [];
      let seenBytes = 0;
      file.on("data", (d: Buffer) => {
        seenBytes += d.length;
        if (seenBytes > Math.min(maxBytes, HARD_MAX_BYTES)) {
          // force close and reject
          file.unpipe();
          file.resume();
          return reject(new Error("File too large"));
        }
        chunks.push(d);
      });
      file.on("limit", () => reject(new Error("File too large")));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("field", (name: string, val: string) => {
      // simple normalization: treat field names as lower-case keys
      fields[name] = String(val);
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, fileBuffer, filename, mimetype }));

    req.pipe(bb);
  });
}

function pickFolder(kind?: string, customFolder?: string) {
  if (customFolder) return customFolder;
  switch ((kind || "").toLowerCase()) {
    case "avatar":
      return "ilaw/avatars";
    case "book_cover":
      return "ilaw/books/covers";
    case "page_image":
      return "ilaw/books/pages/images";
    case "page_audio":
      return "ilaw/books/pages/audio";
    default:
      return "ilaw/misc";
  }
}

function makePublicId(kind?: string, provided?: string, filename?: string) {
  if (provided) return provided;
  
  const cleanKind = (kind || "asset").toLowerCase().replace(/[^a-zA-Z0-9]/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  const timestamp = Date.now();
  
  // If filename is provided and clean, use it; otherwise use generic name
  let base = "upload";
  if (filename) {
    const cleanBase = filename
      .replace(/\.[^.]+$/, "") // strip extension
      .replace(/[^a-zA-Z0-9_\-]/g, "_") // replace invalid chars with underscore
      .replace(/_{2,}/g, "_") // collapse multiple underscores
      .slice(0, 20); // limit base length
    
    if (cleanBase && cleanBase.length > 0 && cleanBase !== "_") {
      base = cleanBase;
    }
  }
  
  return `${cleanKind}_${timestamp}_${rand}_${base}`.slice(0, 80);
}

function uploadToCloudinary(
  file: Buffer,
  folder: string,
  publicId: string
): Promise<{
  secure_url: string;
  public_id: string;
  asset_id?: string;
  bytes?: number;
  format?: string;
  resource_type?: string;
  original_filename?: string;
}> {
  return new Promise((resolve, reject) => {
    // Clean the folder and publicId one more time before sending to Cloudinary
    const cleanFolder = folder.replace(/[^a-zA-Z0-9_\-\/]/g, "").replace(/\/+/g, "/");
    const cleanPublicId = publicId.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_{2,}/g, "_");
    
    console.log("Cloudinary upload params:", { cleanFolder, cleanPublicId });
    
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: cleanFolder,
        public_id: cleanPublicId,
        overwrite: true,
        resource_type: "auto", // auto-detect image/audio/etc.
      },
      (err, result) => {
        if (err || !result) {
          console.error("Cloudinary upload error:", err);
          return reject(err || new Error("Upload failed"));
        }
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          asset_id: (result as any).asset_id,
          bytes: (result as any).bytes,
          format: (result as any).format,
          resource_type: (result as any).resource_type,
          original_filename: (result as any).original_filename,
        });
      }
    );
    stream.end(file);
  });
}

const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac"];

// == MAIN API HANDLER ==
export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any }
) {
  // Response helpers for plain Node types
  if (!res.status) {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = (data: any) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // Validate Cloudinary env
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return res.status(500).json({
      success: false,
      error:
        "Cloudinary not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
    });
  }

  try {
  // Allow client to suggest a max size via header or URL param; we'll parse the upload first
  // Use a non-routable dummy base instead of localhost when parsing relative URLs
  const rawMaxMb = Number((req.headers["x-max-mb"] as string) || (req.headers["max-mb"] as string) || (req.url && new URL(req.url, "http://internal.invalid").searchParams.get("maxMb")) || "") || undefined;

  // Parse multipart with a reasonable default; we'll enforce exact limits below after reading fields
  const { fields, fileBuffer, filename, mimetype } = await parseMultipart(req, DEFAULT_MAX_MB * 1024 * 1024);

  // Determine requested max from parsed fields or header/url, then clamp
  let requestedMaxMb = Number(fields?.maxMb || rawMaxMb || DEFAULT_MAX_MB);
  if (!Number.isFinite(requestedMaxMb) || requestedMaxMb <= 0) requestedMaxMb = DEFAULT_MAX_MB;
  requestedMaxMb = Math.min(requestedMaxMb, HARD_MAX_MB);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "No file received" });
    }

    // Validation: size + mime (gentle defaults)
    const MAX_MB = Math.min(Number(fields.maxMb || requestedMaxMb || DEFAULT_MAX_MB), HARD_MAX_MB);
    if (fileBuffer.length > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ success: false, error: `File too large (>${MAX_MB}MB)` });
    }

    const kind = ((fields.kind || "") as string).toLowerCase();
    // validate kind strictly
    const safeKind = ALLOWED_KINDS.has(kind) ? kind : "asset";
    if (safeKind === "avatar" || safeKind === "book_cover" || safeKind === "page_image") {
      if (mimetype && !IMAGE_MIMES.includes(mimetype)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid image type. Use JPEG, PNG, GIF, or WebP." });
      }
    } else if (kind === "page_audio") {
      if (mimetype && !AUDIO_MIMES.includes(mimetype)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid audio type. Use MP3, WAV, OGG, or AAC." });
      }
    }

    // sanitize folder/publicId/filename inputs
    const sanitizedFolder = sanitizeFolderInput(fields.folder) || pickFolder(safeKind, undefined);
    const sanitizedPublicId = sanitizePublicIdInput(fields.publicId) || undefined;
    const sanitizedFilename = sanitizeFilenameInput(filename) || undefined;

    const folder = pickFolder(safeKind, sanitizedFolder);
    const publicId = makePublicId(safeKind, sanitizedPublicId, sanitizedFilename);

    // Debug logging
    console.log("Upload parameters:", {
      kind: safeKind,
      folder,
      publicId,
      originalFilename: filename,
      fileSize: fileBuffer.length,
      mimetype
    });

    const uploaded = await uploadToCloudinary(fileBuffer, folder, publicId);

    return res.status(200).json({
      success: true,
      kind: kind || "asset",
      folder,
      filename,
      mimetype,
      // Persist these if needed:
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      // Extras:
      assetId: uploaded.asset_id,
      bytes: uploaded.bytes,
      format: uploaded.format,
      resourceType: uploaded.resource_type,
      originalFilename: uploaded.original_filename,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("Upload error:", {
      message: err?.message,
      code: err?.code,
      http_code: err?.http_code,
      error: err?.error,
      stack: err?.stack
    });
    return res.status(500).json({
      success: false,
      error: err?.message || err?.error?.message || "Error uploading file",
    });
  }
}
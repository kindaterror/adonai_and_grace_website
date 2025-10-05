// /pages/api/stories/[bookId]/checkpoint.ts

// == IMPORTS & DEPENDENCIES ==
import jwt from "jsonwebtoken";
import { db } from "@db";
import * as schema from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
// 👇 allow slug usage (e.g., "necklace-comb")
import { EXCLUSIVE_META, ensureExclusiveBook } from "@/pages/api/books/_exclusive";

// == CONSTANTS ==
const JWT_SECRET = process.env.JWT_SECRET || "adonai_grace_school_secret";

// == TYPES ==
interface JWTPayload {
  userId: number;
  role: "student" | "teacher" | "admin" | string;
  username: string;
  iat?: number;
  exp?: number;
}

// == UTILS ==
function getAuthUser(req: any): JWTPayload {
  const header = String(req.headers?.authorization ?? "");
  const parts = header.split(" ").filter(Boolean);
  const token = parts.length === 2 ? parts[1] : undefined;
  if (!token) throw new Error("Authentication required");
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (e) {
    throw new Error("Invalid or expired token");
  }
}

function toInt(v: any) {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// == API HANDLER ==
export default async function handler(req: any, res: any) {
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PUT", "POST", "OPTIONS"].includes(req.method)) {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // CORS preflight (optional)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(204).end();
  }

  try {
    const user = getAuthUser(req);
    if (!["student", "teacher", "admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Accept numeric id OR exclusive slug
    const rawId = String(req.query?.bookId ?? req.query?.id ?? "").trim();
    let bookId = toInt(rawId);

    if (!bookId) {
      const meta = EXCLUSIVE_META[rawId];
      if (!meta) {
        return res.status(400).json({ message: "Invalid or missing bookId/slug" });
      }
      bookId = await ensureExclusiveBook(meta);
    }

    if (req.method === "GET") return await handleGet(user, bookId, res);
    if (req.method === "PUT") return await handlePut(req, user, bookId, res);
    if (req.method === "POST") return await handlePost(req, user, bookId, res);

    return res.status(405).json({ message: "Method not allowed" });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Authentication required" || msg === "Invalid or expired token" ? 401 : 500;
    console.error("❌ /api/stories/[bookId]/checkpoint error:", msg);
    return res.status(status).json({ success: false, message: msg });
  }
}

// == GET: Read current user's checkpoint for a book ==
async function handleGet(user: JWTPayload, bookId: number, res: any) {
  const cp = await db.query.storyCheckpoints.findFirst({
    where: and(
      eq(schema.storyCheckpoints.userId, user.userId),
      eq(schema.storyCheckpoints.bookId, bookId)
    ),
  });

  return res.status(200).json({
    success: true,
    checkpoint: cp ?? null,
  });
}

// == PUT: Upsert checkpoint (self-only) ==
async function handlePut(req: any, user: JWTPayload, bookId: number, res: any) {
  const body = req.body || {};

  // Track which fields were actually provided (so we don't blank them by accident)
  const hasPageId = "pageId" in body || "page_id" in body;
  const hasPageNumber = "pageNumber" in body || "page_number" in body;
  const hasAnswers = "answersJson" in body || "answers_json" in body;
  const hasQuiz = "quizStateJson" in body || "quiz_state_json" in body;

  const pageId = hasPageId ? toInt(body.pageId ?? body.page_id) : undefined;
  const pageNumber = hasPageNumber
    ? toInt(body.pageNumber ?? body.page_number)
    : undefined;

  const answersJson = hasAnswers
    ? body.answersJson ?? body.answers_json
    : undefined;

  const quizStateJson = hasQuiz
    ? body.quizStateJson ?? body.quiz_state_json
    : undefined;

  const audioPositionRaw =
    body.audioPositionSec ?? body.audio_position_sec ?? 0;
  const percentRaw =
    body.percentComplete ?? body.percentage ?? body.percent ?? 0;

  const audioPositionSec = clamp(Number(audioPositionRaw) || 0, 0, 24 * 3600);
  const percentComplete = clamp(Math.round(Number(percentRaw) || 0), 0, 100);

  // Basic shape guards
  if (hasPageId && !Number.isFinite(pageId)) {
    return res.status(400).json({ message: "Invalid pageId" });
  }
  if (hasPageNumber && !Number.isFinite(pageNumber)) {
    return res.status(400).json({ message: "Invalid pageNumber" });
  }

  const now = new Date();

  // Insert or update; only bump provided fields and never reduce % complete
  await db
    .insert(schema.storyCheckpoints)
    .values({
      userId: user.userId,
      bookId,
      pageId: pageId ?? null,
      pageNumber: pageNumber ?? null,
      answersJson: answersJson ?? null,
      quizStateJson: quizStateJson ?? null,
      audioPositionSec,
      percentComplete,
      lastCheckpointAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.storyCheckpoints.userId, schema.storyCheckpoints.bookId],
      set: {
        ...(hasPageId ? { pageId: pageId ?? null } : {}),
        ...(hasPageNumber ? { pageNumber: pageNumber ?? null } : {}),
        ...(hasAnswers ? { answersJson: answersJson ?? null } : {}),
        ...(hasQuiz ? { quizStateJson: quizStateJson ?? null } : {}),
        audioPositionSec,
        // never decrease completion
        percentComplete: sql`GREATEST(${schema.storyCheckpoints.percentComplete}, ${percentComplete})`,
        lastCheckpointAt: now,
      },
    });

  // Keep progress in sync (only increase percentComplete)
  const existingProgress = await db.query.progress.findFirst({
    where: and(
      eq(schema.progress.userId, user.userId),
      eq(schema.progress.bookId, bookId)
    ),
  });

  if (!existingProgress) {
    await db.insert(schema.progress).values({
      userId: user.userId,
      bookId,
      percentComplete,
      totalReadingTime: 0,
      lastReadAt: now,
    });
  } else if ((existingProgress.percentComplete ?? 0) < percentComplete) {
    await db
      .update(schema.progress)
      .set({ percentComplete, lastReadAt: now })
      .where(eq(schema.progress.id, existingProgress.id));
  } else {
    await db
      .update(schema.progress)
      .set({ lastReadAt: now })
      .where(eq(schema.progress.id, existingProgress.id));
  }

  // Return the fresh row
  const updated = await db.query.storyCheckpoints.findFirst({
    where: and(
      eq(schema.storyCheckpoints.userId, user.userId),
      eq(schema.storyCheckpoints.bookId, bookId)
    ),
  });

  return res.status(200).json({
    success: true,
    message: "Checkpoint saved",
    checkpoint: updated,
  });
}

// == POST: { action: "reset" } -> delete user's checkpoint for this book ==
async function handlePost(req: any, user: JWTPayload, bookId: number, res: any) {
  const body = req.body || {};
  const action = String(body.action || "").toLowerCase();

  if (action !== "reset") {
    return res.status(400).json({
      success: false,
      message: 'Unsupported action. Use { action: "reset" }.',
    });
  }

  const del = await db
    .delete(schema.storyCheckpoints)
    .where(
      and(
        eq(schema.storyCheckpoints.userId, user.userId),
        eq(schema.storyCheckpoints.bookId, bookId)
      )
    )
    .returning();

  return res.status(200).json({
    success: true,
    message: del.length ? "Checkpoint cleared" : "No checkpoint to clear",
  });
}

// server/routes/stories.ts
import type { Request, Response } from "express";
import { db } from "@db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { ensureExclusiveBookForSlug } from "@/lib/ensureExclusiveBook";

const JWT_SECRET = process.env.JWT_SECRET || "adonai_grace_school_secret";

const authenticate = (req: Request) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new Error("Authentication required");
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error("Invalid or expired token");
  }
};

const clampPct = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return undefined;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
};

// Upsert progress (coarse stats)
async function upsertProgress(
  userId: number,
  bookId: number,
  payload: { percentComplete?: number }
) {
  const existing = await db.query.progress.findFirst({
    where: (p, { and, eq }) => and(eq(p.userId, userId), eq(p.bookId, bookId)),
  });

  const pct = typeof payload.percentComplete === "number"
    ? clampPct(payload.percentComplete)!
    : undefined;

  if (existing) {
    await db
      .update(schema.progress)
      .set({
        percentComplete:
          pct != null
            ? Math.max(existing.percentComplete ?? 0, pct)
            : existing.percentComplete,
        lastReadAt: new Date(),
      })
      .where(eq(schema.progress.id, existing.id));
  } else {
    await db.insert(schema.progress).values({
      userId,
      bookId,
      percentComplete: pct ?? 0,
      totalReadingTime: 0,
      lastReadAt: new Date(),
    });
  }
}

// Optional: award badges when finishing this book (if you mapped one)
async function maybeAwardBadgesOnComplete(userId: number, bookId: number) {
  const mappings = await db.query.bookBadges.findMany({
    where: (bb, { and, eq }) => and(eq(bb.bookId, bookId), eq(bb.isEnabled, true)),
    with: { badge: true },
  });

  if (!mappings.length) return;

  for (const m of mappings) {
    const has = await db.query.earnedBadges.findFirst({
      where: (eb, { and, eq }) =>
        and(eq(eb.userId, userId), eq(eb.badgeId, m.badgeId)),
    });
    if (!has) {
      await db.insert(schema.earnedBadges).values({
        userId,
        badgeId: m.badgeId,
        bookId,
        note: "Auto-awarded on completion",
      });
    }
  }
}

// GET checkpoint: /api/stories/:slug/checkpoint
export async function getCheckpoint(req: Request, res: Response) {
  try {
    const user = authenticate(req);
    const slug = req.params.slug;

    // ✅ ensure a book row exists for this slug (storybook by default)
    const book = await ensureExclusiveBookForSlug({
      slug,
      defaults: { type: "storybook" as const },
    });

    const row = await db.query.storyCheckpoints.findFirst({
      where: (sc, { and, eq }) =>
        and(eq(sc.userId, user.id), eq(sc.bookId, book.id)),
    });

    return res.status(200).json({ success: true, checkpoint: row ?? null });
  } catch (err: any) {
    const msg = err?.message || "Internal error";
    return res
      .status(msg.includes("Authentication") ? 401 : 500)
      .json({ message: msg });
  }
}

// PUT checkpoint: /api/stories/:slug/checkpoint
export async function putCheckpoint(req: Request, res: Response) {
  try {
    const user = authenticate(req);
    const slug = req.params.slug;

    // ✅ ensure a book row exists for this slug (storybook by default)
    const book = await ensureExclusiveBookForSlug({
      slug,
      defaults: { type: "storybook" as const },
    });

    const {
      pageNumber,
      answersJson,
      quizStateJson,
      audioPositionSec,
      percentComplete,
    } = req.body || {};

    const pct = clampPct(percentComplete);

    const existing = await db.query.storyCheckpoints.findFirst({
      where: (sc, { and, eq }) =>
        and(eq(sc.userId, user.id), eq(sc.bookId, book.id)),
    });

    if (existing) {
      await db
        .update(schema.storyCheckpoints)
        .set({
          pageNumber: pageNumber ?? existing.pageNumber,
          answersJson: answersJson ?? existing.answersJson,
          quizStateJson: quizStateJson ?? existing.quizStateJson,
          audioPositionSec: audioPositionSec ?? existing.audioPositionSec,
          percentComplete: pct ?? existing.percentComplete,
          lastCheckpointAt: new Date(),
        })
        .where(eq(schema.storyCheckpoints.id, existing.id));
    } else {
      await db.insert(schema.storyCheckpoints).values({
        userId: user.id,
        bookId: book.id,
        pageNumber: pageNumber ?? 1,
        answersJson: answersJson ?? null,
        quizStateJson: quizStateJson ?? null,
        audioPositionSec: audioPositionSec ?? 0,
        percentComplete: pct ?? 0,
        lastCheckpointAt: new Date(),
      });
    }

    // keep coarse progress in sync
    if (typeof pct === "number") {
      await upsertProgress(user.id, book.id, { percentComplete: pct });
      if (pct >= 100) {
        await maybeAwardBadgesOnComplete(user.id, book.id);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    const msg = err?.message || "Internal error";
    return res
      .status(msg.includes("Authentication") ? 401 : 500)
      .json({ message: msg });
  }
}

// POST complete: /api/stories/:slug/complete
export async function postComplete(req: Request, res: Response) {
  try {
    const user = authenticate(req);
    const slug = req.params.slug;

    // ✅ ensure a book row exists for this slug (storybook by default)
    const book = await ensureExclusiveBookForSlug({
      slug,
      defaults: { type: "storybook" as const },
    });

    // set 100% everywhere
    await upsertProgress(user.id, book.id, { percentComplete: 100 });

    const existing = await db.query.storyCheckpoints.findFirst({
      where: (sc, { and, eq }) =>
        and(eq(sc.userId, user.id), eq(sc.bookId, book.id)),
    });

    if (existing) {
      await db
        .update(schema.storyCheckpoints)
        .set({ percentComplete: 100, lastCheckpointAt: new Date() })
        .where(eq(schema.storyCheckpoints.id, existing.id));
    } else {
      await db.insert(schema.storyCheckpoints).values({
        userId: user.id,
        bookId: book.id,
        pageNumber: 999,
        percentComplete: 100,
        lastCheckpointAt: new Date(),
      });
    }

    await maybeAwardBadgesOnComplete(user.id, book.id);

    return res.status(200).json({ success: true });
  } catch (err: any) {
    const msg = err?.message || "Internal error";
    return res
      .status(msg.includes("Authentication") ? 401 : 500)
      .json({ message: msg });
  }
}

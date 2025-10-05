// /pages/api/books/[id]/complete.ts

// == IMPORTS & DEPENDENCIES ==
import jwt from "jsonwebtoken";
import { db } from "@db";
import * as schema from "@shared/schema";
import { and, eq, lte } from "drizzle-orm";

// 👇 Add this: lets us accept slugs too
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

// == API HANDLER ==
export default async function handler(req: any, res: any) {
  // Consistent headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  // CORS preflight (optional)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const user = getAuthUser(req);
    if (!["student", "teacher", "admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Accept either numeric ID or exclusive slug
    const raw = String(req.query.id ?? "").trim();
    let bookId = toInt(raw);

    if (!bookId) {
      // accept explicit exclusive slug
      const meta = EXCLUSIVE_META[raw];
      if (!meta) {
        return res.status(400).json({ message: "Invalid book id or slug" });
      }
      // ensure a minimal books row exists for this slug
      bookId = await ensureExclusiveBook(meta);
    }

    // == UPSERT/UPDATE PROGRESS TO 100% ==
    const now = new Date();
    const existing = await db.query.progress.findFirst({
      where: and(eq(schema.progress.userId, user.userId), eq(schema.progress.bookId, bookId)),
    });

    if (!existing) {
      await db.insert(schema.progress).values({
        userId: user.userId,
        bookId,
        percentComplete: 100,
        totalReadingTime: 0,
        lastReadAt: now,
      });
    } else if ((existing.percentComplete ?? 0) < 100) {
      await db
        .update(schema.progress)
        .set({ percentComplete: 100, lastReadAt: now })
        .where(eq(schema.progress.id, existing.id));
    } else {
      // refresh lastReadAt to reflect the finalization tap
      await db
        .update(schema.progress)
        .set({ lastReadAt: now })
        .where(eq(schema.progress.id, existing.id));
    }

    // == Mirror completion to checkpoint (nice for resume UX) ==
    await db
      .insert(schema.storyCheckpoints)
      .values({
        userId: user.userId,
        bookId,
        percentComplete: 100,
        lastCheckpointAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.storyCheckpoints.userId, schema.storyCheckpoints.bookId],
        set: { percentComplete: 100, lastCheckpointAt: now },
      });

    // == AUTO-AWARD BADGES FOR THIS BOOK ==
    const mappings = await db.query.bookBadges.findMany({
      where: and(
        eq(schema.bookBadges.bookId, bookId),
        eq(schema.bookBadges.isEnabled, true),
        eq(schema.bookBadges.awardMethod, "auto_on_book_complete"),
        lte(schema.bookBadges.completionThreshold, 100)
      ),
      with: { badge: { columns: { id: true, name: true } } },
    });

    for (const m of mappings) {
      if (!m.badge) continue;
      await db
        .insert(schema.earnedBadges)
        .values({
          userId: user.userId,
          badgeId: m.badge.id,
          bookId,
          note: "Auto-awarded on book completion",
        })
        .onConflictDoNothing({
          target: [schema.earnedBadges.userId, schema.earnedBadges.badgeId],
        });
    }

    return res.status(200).json({
      success: true,
      message: "Book marked as completed successfully",
      data: {
        userId: user.userId,
        bookId,
        percentComplete: 100,
        completedAt: now,
        badgesAutoAwarded: mappings.map((m) => m.badge?.id).filter(Boolean),
      },
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Authentication required" || msg === "Invalid or expired token" ? 401 : 500;
    console.error("❌ /api/books/[id]/complete error:", msg);
    return res.status(status).json({ success: false, message: msg });
  }
}

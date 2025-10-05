// src/server/services/awardExclusiveStoryBadge.ts
import { db } from "@db"; // adjust if your db export path is different
import { badges, earnedBadges, books } from "shared/schema";
import { eq } from "drizzle-orm";

/**
 * Exclusive 2D story slugs → badge names (must match your seed names exactly).
 */
const STORY_BADGE_BY_SLUG: Record<string, string> = {
  "necklace-comb": "Necklace & Comb Finisher",
  "sun-moon": "Sun & Moon Finisher",
  "bernardo-carpio": "Bernardo Carpio Finisher",
};

type AwardParams = {
  userId: number;
  bookId?: number;
  slug?: string;
};

/**
 * Award a story-exclusive finisher badge IF the slug is one of the 3
 * AND the user hasn't earned it yet. Safe to call multiple times;
 * uses ON CONFLICT DO NOTHING.
 *
 * Returns info about whether we awarded (or it already existed).
 */
export async function awardExclusiveStoryBadge({
  userId,
  bookId,
  slug,
}: AwardParams): Promise<{
  attempted: boolean;        // we recognized the slug and attempted to award
  awarded: boolean;          // a new row was inserted
  alreadyHad: boolean;       // user already had it
  badgeId?: number;
  badgeName?: string;
}> {
  // Resolve slug if not given (guard DB call)
  let storySlug = slug;
  try {
    if (!storySlug && bookId) {
      const [bk] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
      storySlug = bk?.slug ?? undefined;
    }
  } catch (err) {
    console.error("awardExclusiveStoryBadge: db lookup failed");
    return { attempted: false, awarded: false, alreadyHad: false };
  }

  if (!storySlug) {
    return { attempted: false, awarded: false, alreadyHad: false };
  }

  const badgeName = STORY_BADGE_BY_SLUG[storySlug];
  if (!badgeName) {
    // Not an exclusive 2D story → do nothing
    return { attempted: false, awarded: false, alreadyHad: false };
  }

  // Find badge by name
  let badgeRow: any = null;
  try {
    [badgeRow] = await db.select().from(badges).where(eq(badges.name, badgeName)).limit(1);
  } catch (err) {
    console.error("awardExclusiveStoryBadge: badge lookup failed");
    return { attempted: true, awarded: false, alreadyHad: false };
  }

  if (!badgeRow) {
    // Seed might be missing; we don't throw—just no-op.
    return { attempted: true, awarded: false, alreadyHad: false };
  }

  // Try to insert earned_badges; the unique (userId, badgeId) prevents dupes
  try {
    const insertResult = await db
      .insert(earnedBadges)
      .values({
        userId,
        badgeId: badgeRow.id,
        bookId: bookId ?? undefined,
        note: "Awarded for completing the exclusive 2D story.",
      })
      .onConflictDoNothing({ target: [earnedBadges.userId, earnedBadges.badgeId] })
      .returning();

    const awarded = insertResult.length > 0;
    return {
      attempted: true,
      awarded,
      alreadyHad: !awarded,
      badgeId: badgeRow.id,
      badgeName,
    };
  } catch (err) {
    console.error("awardExclusiveStoryBadge: insert failed");
    return { attempted: true, awarded: false, alreadyHad: false };
  }
}

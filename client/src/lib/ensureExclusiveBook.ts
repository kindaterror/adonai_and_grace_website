// src/server/lib/ensureExclusiveBook.ts
import { db } from "@db";
import { books } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type BookRow = InferSelectModel<typeof books>;
export type NewBook = InferInsertModel<typeof books>;

/** Known exclusive story titles by slug. */
export const EXCLUSIVE_STORY_TITLES: Record<string, string> = {
  "necklace-comb": "The Necklace and the Comb",
  // "another-slug": "Another Exclusive Story",
};

function toSlug(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function findBookBySlug(slug: string): Promise<BookRow | null> {
  try {
    const rows = await db.select().from(books).where(eq((books as any).slug, slug)).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.error("findBookBySlug: db error");
    return null;
  }
}

/**
 * Ensure there is a book row for a given slug.
 * - If present → returns it.
 * - If missing → inserts it with sensible defaults and returns the new row.
 */
export async function ensureExclusiveBookForSlug(input: {
  slug: string;
  title?: string;
  defaults?: Partial<NewBook>;
}): Promise<BookRow> {
  const slug = toSlug(String(input.slug || "").slice(0, 200));

  // 1) already exists?
  const existing = await findBookBySlug(slug);
  if (existing) return existing;

  // 2) title resolution
  const title =
    input.title ??
    EXCLUSIVE_STORY_TITLES[slug] ??
    slug.split("-").map(w => w[0]?.toUpperCase() + w.slice(1)).join(" ");

  // 3) minimal insert + caller defaults
  const insertValues: Partial<NewBook> = {
    // ts-expect-error: field exists in your schema
    slug,
    // ts-expect-error: field exists in your schema
    title,
    ...(input.defaults ?? {}),
  };

  // 4) conflict-safe insert (requires unique index on books.slug — you added `uniq_slug`)
  try {
    const inserted = await db
      .insert(books)
      .values(insertValues as NewBook)
      // @ts-ignore drizzle typing varies
      .onConflictDoNothing({ target: (books as any).slug })
      .returning();

    if (inserted.length) return inserted[0];
  } catch (err) {
    console.error("ensureExclusiveBookForSlug: insert failed");
  }

  // racing: someone else inserted it
  const after = await findBookBySlug(slug);
  if (!after) throw new Error(`Failed to ensure book for slug "${slug}".`);
  return after;
}

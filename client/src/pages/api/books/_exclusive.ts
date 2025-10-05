// src/server/_exclusive.ts
import { db } from "@db";
import * as schema from "@shared/schema";
import { and, sql, eq } from "drizzle-orm"; // eq is now used

// Register your exclusive story slugs here
export const EXCLUSIVE_META: Record<
  string,
  {
    title: string;
    description?: string;
    type?: "storybook" | "educational";
    grade?: string | null;
    subject?: string | null;
    coverImage?: string | null;
  }
> = {
  "necklace-comb": {
    title: "The Necklace and the Comb",
    description: "Exclusive story available in the student portal.",
    type: "storybook",
    grade: null,
    subject: null,
  },
  // add more slugs…
};

type Meta = {
  title: string;
  description?: string;
  type?: "storybook" | "educational";
  grade?: string | null;
  subject?: string | null;
  coverImage?: string | null;
};

/* -------------------------------
   Slug helpers
-------------------------------- */
const MAX_TITLE_LEN = 255;
const MAX_DESC_LEN = 2000;
const MAX_SLUG_LEN = 100;
const MAX_COVER_LEN = 1000;

function sanitizeText(v: string | undefined | null, max: number): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (t.length === 0) return null;
  return t.length <= max ? t : t.slice(0, max);
}

function slugify(input: string) {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return s.slice(0, MAX_SLUG_LEN);
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let s = base;
  let i = 2;
  // loop until slug is free
  // (drizzle: select one row by slug)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(eq(schema.books.slug, s))
      .limit(1);
    if (existing.length === 0) return s;
    s = `${base}-${i++}`;
  }
}

/* ----------------------------------------------------
   Return existing book.id for meta or create a minimal row.
   (kept original signature; now ALWAYS sets a slug)
   - Lookup still uses title/grade/subject as before
   - Insert now generates a unique slug (from title)
----------------------------------------------------- */
export async function ensureExclusiveBook(meta: Meta): Promise<number> {
  // try find (case-insensitive title; null-safe grade/subject)
  const found = await db.query.books.findFirst({
    where: and(
      sql`lower(${schema.books.title}) = lower(${meta.title})`,
      sql`${schema.books.grade} IS NOT DISTINCT FROM ${meta.grade ?? null}`,
      sql`${schema.books.subject} IS NOT DISTINCT FROM ${meta.subject ?? null}`
    ),
    columns: { id: true },
  });
  if (found) return found.id;

  // create minimal row WITH slug (handle possible race with unique index)
  const safeTitle = sanitizeText(meta.title, MAX_TITLE_LEN) ?? "Exclusive story";
  const baseSlug = slugify(safeTitle);
  const uniqueSlug = await ensureUniqueSlug(baseSlug);

  try {
    const inserted = await db
      .insert(schema.books)
      .values({
        slug: uniqueSlug, // NEW: required by schema
        title: safeTitle,
        description: sanitizeText(meta.description, MAX_DESC_LEN) ?? "Exclusive story.",
        type: meta.type ?? "storybook",
        grade: meta.grade ?? null,
        subject: meta.subject ?? null,
        coverImage: sanitizeText(meta.coverImage ?? null, MAX_COVER_LEN),
      })
      .returning({ id: schema.books.id });

    return inserted[0].id;
  } catch (err: any) {
    // unique violation (race) -> select again
    if (err?.code === "23505") {
      const again = await db.query.books.findFirst({
        where: and(
          sql`lower(${schema.books.title}) = lower(${meta.title})`,
          sql`${schema.books.grade} IS NOT DISTINCT FROM ${meta.grade ?? null}`,
          sql`${schema.books.subject} IS NOT DISTINCT FROM ${meta.subject ?? null}`
        ),
        columns: { id: true },
      });
      if (again) return again.id;
    }
    throw err;
  }
}

/* ----------------------------------------------------
   NEW: Ensure by explicit exclusive slug (preferred).
   - Checks DB by slug first.
   - If not found, inserts row with that exact slug
     (if taken, appends -2, -3, ... to keep unique).
----------------------------------------------------- */
export async function ensureExclusiveBySlug(slug: string): Promise<number> {
  const meta = EXCLUSIVE_META[slug];
  if (!meta) {
    throw new Error(`Unknown exclusive slug: ${slug}`);
  }

  // 1) Try find by slug
  const bySlug = await db.query.books.findFirst({
    where: eq(schema.books.slug, slug),
    columns: { id: true },
  });
  if (bySlug) return bySlug.id;

  // 2) Fallback: try find by (title,grade,subject) in case of legacy row
  const byMeta = await db.query.books.findFirst({
    where: and(
      sql`lower(${schema.books.title}) = lower(${meta.title})`,
      sql`${schema.books.grade} IS NOT DISTINCT FROM ${meta.grade ?? null}`,
      sql`${schema.books.subject} IS NOT DISTINCT FROM ${meta.subject ?? null}`
    ),
    columns: { id: true, slug: true },
  });
  if (byMeta?.id) {
    // if it exists without our slug, update slug safely
    const targetSlug = await ensureUniqueSlug(slug);
    await db
      .update(schema.books)
      .set({ slug: targetSlug })
      .where(eq(schema.books.id, byMeta.id));
    return byMeta.id;
  }

  // 3) Create a new row with the intended slug (or nearest unique)
  const finalSlug = await ensureUniqueSlug(slug);

  const inserted = await db
    .insert(schema.books)
    .values({
      slug: finalSlug,
      title: meta.title,
      description: meta.description ?? "Exclusive story.",
      type: meta.type ?? "storybook",
      grade: meta.grade ?? null,
      subject: meta.subject ?? null,
      coverImage: meta.coverImage ?? null,
    })
    .returning({ id: schema.books.id });

  return inserted[0].id;
}

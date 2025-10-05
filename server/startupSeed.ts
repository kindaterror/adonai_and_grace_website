import bcrypt from "bcrypt";
import { db } from "@db";
import * as schema from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { log } from "./vite";

/** Minimal safe idempotent startup seeding.
 *  - Creates initial admin user if none exists (based on ADMIN_EMAIL/USERNAME)
 *  - Seeds exclusive books (subset) if missing
 *  - Seeds exclusive story badges + mappings if books exist
 *
 *  This NEVER calls process.exit and will not throw fatally; errors are logged.
 */
export async function runStartupSeed() {
  if (process.env.DISABLE_STARTUP_SEED === "true") {
    log("Startup seed disabled via DISABLE_STARTUP_SEED", "seed");
    return;
  }

  try {
    await seedAdmin();
  } catch (e) {
    log(`Admin seed error: ${(e as Error).message}` ,"seed");
  }

  try {
    await seedExclusiveBooks();
  } catch (e) {
    log(`Exclusive books seed error: ${(e as Error).message}`, "seed");
  }

  try {
    await seedExclusiveBadges();
  } catch (e) {
    log(`Exclusive badges seed error: ${(e as Error).message}`, "seed");
  }
}

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !email || !password) {
    log("Skipping admin seed (missing ADMIN_* env vars)", "seed");
    return;
  }
  const emailLc = email.toLowerCase();
  const usernameLc = username.toLowerCase();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${emailLc} or lower(${schema.users.username}) = ${usernameLc}`)
    .limit(1);
  if (existing.length) {
    log(`Admin already exists (${email})`, "seed");
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const [inserted] = await db
      .insert(schema.users)
      .values({
        username,
        email,
        password: hash,
        firstName: process.env.ADMIN_FIRST_NAME || "System",
        lastName: process.env.ADMIN_LAST_NAME || "Administrator",
        role: "admin",
        emailVerified: true,
      })
      .returning({ id: schema.users.id });
    log(`Created initial admin user id=${inserted.id}`, "seed");
  } catch (e: any) {
    // Handle race condition or case variance duplicates gracefully
    if (e?.code === '23505') {
      log(`Admin already exists (caught duplicate) (${email})`, 'seed');
    } else {
      throw e;
    }
  }
}

const EXCLUSIVE_BOOKS: Array<{title: string; slug: string; description: string; type: 'storybook'}> = [
  { title: "The Necklace and the Comb", slug: "necklace-comb", description: "A Philippine folktale about sibling rivalry and transformation.", type: 'storybook' },
  { title: "The Sun and the Moon", slug: "sun-moon", description: "A Philippine folktale about the origins of day and night.", type: 'storybook' },
  { title: "The Man with the Coconuts", slug: "coconut-man", description: "A humorous Philippine folktale about greed and wisdom.", type: 'storybook' },
];

async function seedExclusiveBooks() {
  for (const b of EXCLUSIVE_BOOKS) {
    const exists = await db.query.books.findFirst({ where: eq(schema.books.slug, b.slug), columns: { id: true }});
    if (exists) { continue; }
    await db.insert(schema.books).values(b as any);
    log(`Seeded book: ${b.title}`, "seed");
  }
}

// Minimal port of exclusive_story_badges logic
async function seedExclusiveBadges() {
  // Only proceed if the three books exist
  const all = await Promise.all(EXCLUSIVE_BOOKS.map(b => db.query.books.findFirst({ where: eq(schema.books.slug, b.slug) })));
  const present = all.filter(Boolean) as {id: number; title: string}[];
  if (!present.length) { return; }

  const STORIES = [
    { slug: 'necklace-comb', badgeName: 'Necklace & Comb Finisher', description: 'Finished The Necklace and the Comb', themeColors: { primary: '#1A237E'} },
    { slug: 'sun-moon', badgeName: 'Sun & Moon Finisher', description: 'Finished The Sun and the Moon', themeColors: { primary: '#FF9800'} },
    { slug: 'bernardo-carpio', badgeName: 'Bernardo Carpio Finisher', description: 'Finished The Legend of Bernardo Carpio', themeColors: { primary: '#4CAF50'} },
  ];

  // dynamic imports to avoid circular issues
  const { badges, bookBadges } = await import("@shared/schema");
  for (const meta of STORIES) {
  const match = await db.query.books.findFirst({ where: eq(schema.books.slug, meta.slug) });
    if (!match) { continue; }

    const existingBadge = await db.select({ id: (badges as any).id }).from(badges as any).where(eq((badges as any).name, meta.badgeName)).limit(1);
    let badgeId: number;
    if (existingBadge.length) {
      badgeId = (existingBadge[0] as any).id;
    } else {
      const inserted = await db.insert(badges as any).values({ name: meta.badgeName, description: meta.description, isActive: true, isGeneric: false, themeColors: meta.themeColors }).returning({ id: (badges as any).id });
      badgeId = (inserted[0] as any).id;
      log(`Created badge '${meta.badgeName}'`, "seed");
    }

    const existingMap = await db.select({ id: (bookBadges as any).id }).from(bookBadges as any).where(eq((bookBadges as any).bookId, (match as any).id)).limit(1);
    if (!existingMap.length) {
      await db.insert(bookBadges as any).values({ bookId: (match as any).id, badgeId, awardMethod: 'auto_on_book_complete', completionThreshold: 100, isEnabled: true });
      log(`Mapped badge '${meta.badgeName}' to book '${match.title}'`, "seed");
    }
  }
}

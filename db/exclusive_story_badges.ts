/**
 * Seed: Exclusive story badges + book mappings
 */

import { eq, and } from "drizzle-orm";
import { db } from "@db";
import { books, badges, bookBadges } from "shared/schema";

type StoryMeta = {
  slug: string;
  badgeName: string;
  description: string;
  themeColors: { primary?: string; secondary?: string; accent?: string };
};

const STORIES: StoryMeta[] = [
  {
    slug: "necklace-comb",
    badgeName: "Necklace & Comb Finisher",
    description: "Thank you for reading ‘The Necklace and the Comb’. We appreciate your effort and hope you enjoyed the story!",
    themeColors: { primary: "#1A237E", secondary: "#F4B400", accent: "#7C3AED" },
  },
  {
    slug: "sun-moon",
    badgeName: "Sun & Moon Finisher",
    description: "We are grateful you completed ‘The Sun and the Moon’. Your time and curiosity mean a lot to us!",
    themeColors: { primary: "#FF9800", secondary: "#2196F3", accent: "#FDD835" },
  },
  {
    slug: "bernardo-carpio",
    badgeName: "Bernardo Carpio Finisher",
    description: "Thank you for finishing ‘The Legend of Bernardo Carpio’. We truly appreciate your dedication to exploring our stories!",
    themeColors: { primary: "#4CAF50", secondary: "#795548", accent: "#9E9E9E" },
  },
];

async function main() {
  for (const story of STORIES) {
    const [book] = await db
      .select({ id: books.id, title: books.title })
      .from(books)
      .where(eq(books.slug, story.slug))
      .limit(1);

    if (!book) {
      console.warn(`⚠️ Book with slug '${story.slug}' not found. Skipping.`);
      continue;
    }

    console.log(`📚 Found book: #${book.id} — ${book.title}`);

    // Upsert badge
    let badgeId: number;
    const [existingBadge] = await db
      .select({ id: badges.id })
      .from(badges)
      .where(eq(badges.name, story.badgeName))
      .limit(1);

    if (existingBadge) {
      badgeId = existingBadge.id;
      console.log(`✅ Badge exists: '${story.badgeName}' (#${badgeId})`);
    } else {
      const [inserted] = await db
        .insert(badges)
        .values({
          name: story.badgeName,
          description: story.description,
          isActive: true,
          isGeneric: false,
          themeColors: story.themeColors,
        })
        .returning({ id: badges.id });

      badgeId = inserted.id;
      console.log(`✨ Created badge '${story.badgeName}' (#${badgeId})`);
    }

    // Upsert mapping
    const [existingMap] = await db
      .select({ id: bookBadges.id })
      .from(bookBadges)
      .where(and(eq(bookBadges.bookId, book.id), eq(bookBadges.badgeId, badgeId)))
      .limit(1);

    if (existingMap) {
      console.log(`✅ Mapping exists: book #${book.id} → badge #${badgeId}`);
    } else {
      const [insertedMap] = await db
        .insert(bookBadges)
        .values({
          bookId: book.id,
          badgeId,
          awardMethod: "auto_on_book_complete",
          completionThreshold: 100,
          isEnabled: true,
        })
        .returning({ id: bookBadges.id });

      console.log(
        `🔗 Created mapping: book #${book.id} → badge #${badgeId} [row #${insertedMap.id}]`
      );
    }
  }

  console.log("✅ Exclusive story badges seed complete.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

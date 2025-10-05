// scripts/seed-exclusive-books.ts
import "dotenv/config";
import { db } from "@db";
import { books } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const exclusives = [
    {
      title: "The Necklace and the Comb",
      slug: "necklace-comb",
      description: "A Philippine folktale about sibling rivalry and transformation.",
      type: "storybook",
    },
    {
      title: "The Sun and the Moon",
      slug: "sun-moon",
      description: "A Philippine folktale about the origins of day and night.",
      type: "storybook",
    },
    {
      title: "The Man with the Coconuts",
      slug: "coconut-man",
      description: "A humorous Philippine folktale about greed and wisdom.",
      type: "storybook",
    },
  ];

  for (const b of exclusives) {
    const existing = await db.query.books.findFirst({
      where: eq(books.slug, b.slug),
    });

    if (existing) {
      console.log(`✅ Skipped, already exists: ${b.title}`);
      continue;
    }

    await db.insert(books).values(b as any);
    console.log(`🌱 Seeded: ${b.title}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

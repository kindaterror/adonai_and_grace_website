// db/migrations/20240928_add_slug_to_books.ts
import { sql } from "drizzle-orm";

export async function up() {
  await sql`
    ALTER TABLE books ADD COLUMN IF NOT EXISTS slug text;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_slug ON books (slug);
    ALTER TABLE books ALTER COLUMN slug SET NOT NULL;
  `;
}

export async function down() {
  await sql`
    ALTER TABLE books DROP COLUMN IF EXISTS slug;
    DROP INDEX IF EXISTS uniq_slug;
  `;
}

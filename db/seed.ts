// seed.ts
import dotenv from "dotenv";
dotenv.config();

import { db } from "./index";
import * as schema from "@shared/schema";
import bcrypt from "bcrypt";

/** Require env var (fail fast) */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function seed() {
  try {
    console.log("🌱 Seeding: creating admin user from .env ...");

    const adminUsername = required("ADMIN_USERNAME");
    const adminEmail = required("ADMIN_EMAIL");
    const adminPassword = required("ADMIN_PASSWORD");
    const adminFirstName = process.env.ADMIN_FIRST_NAME || "System";
    const adminLastName = process.env.ADMIN_LAST_NAME || "Administrator";

    // Hash password
    const hashed = await bcrypt.hash(adminPassword, 12);

    // Insert admin; do nothing if unique constraint hits (email/username)
    const [admin] = await db
      .insert(schema.users)
      .values({
        username: adminUsername,
        email: adminEmail,
        password: hashed,
        firstName: adminFirstName,
        lastName: adminLastName,
        role: "admin",
        emailVerified: true, // optional: mark verified on seed
      })
      .onConflictDoNothing()
      .returning();

    if (admin) {
      console.log("✅ Admin created:", adminEmail);
    } else {
      console.log("ℹ️ Admin already exists:", adminEmail);
    }

    console.log("🎉 Seed complete.");
  } catch (err) {
    console.error("❌ Seed failed:", (err as Error).message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

seed();
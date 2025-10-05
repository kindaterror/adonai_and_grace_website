// == IMPORTS & DEPENDENCIES ==
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import * as schema from "@shared/schema";
import { eq, desc, or, and } from "drizzle-orm";
import { db } from "@db";

// == CONSTANTS ==
const JWT_SECRET = process.env.JWT_SECRET || "adonai_grace_school_secret";

// == SLUG HELPERS ==
function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function ensureUniqueSlug(base: string) {
  let s = base;
  let i = 2;
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

// == UTILITY FUNCTIONS ==
const authenticate = (req: Request) => {
  let token: string | undefined;
  try { token = String(req.headers.authorization || "").split(" ")[1]; } catch { token = undefined; }
  if (!token) throw new Error("Authentication required");

  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};

// == GET HANDLER ==
export async function GET(req: Request, res: Response) {
  console.log("=== CLIENT API BOOKS GET ===");
  const { id, slug } = req.query as { id?: string; slug?: string };

  try {
    // get by id
    if (id) {
      const bookId = parseInt(id as string, 10);
      const book = await db.query.books.findFirst({
        where: eq(schema.books.id, bookId),
      });
      if (!book) return res.status(404).json({ message: "Book not found" });
      return res.status(200).json({ book });
    }

    // get by slug
    if (slug) {
      const book = await db.query.books.findFirst({
        where: eq(schema.books.slug, slug),
      });
      if (!book) return res.status(404).json({ message: "Book not found" });
      return res.status(200).json({ book });
    }

    // list (auth optional)
    let user: any = null;
    try {
      user = authenticate(req);
      console.log("Authenticated user id=", user?.id, "role=", user?.role);
    } catch {
      console.warn("Unauthenticated — showing all books");
      const books = await db
        .select()
        .from(schema.books)
        .orderBy(desc(schema.books.createdAt));
      return res.status(200).json({ books });
    }

    let books;
    if (user.role === "admin") {
      books = await db
        .select()
        .from(schema.books)
        .orderBy(desc(schema.books.createdAt));
    } else if (user.role === "teacher") {
      const teacherSettings = await db
        .select()
        .from(schema.teachingSettings)
        .where(eq(schema.teachingSettings.userId, user.id))
        .limit(1);

      if (teacherSettings.length === 0) {
        books = await db
          .select()
          .from(schema.books)
          .orderBy(desc(schema.books.createdAt));
        return res.status(200).json({ books });
      }

      const settings = teacherSettings[0];
      const gradeConds = (settings.preferredGrades || []).map((g: string) =>
        eq(schema.books.grade, g.replace("Grade ", ""))
      );
      const subjectConds = (settings.subjects || []).map((s: string) =>
        eq(schema.books.subject, s)
      );

      const where: any[] = [];
      if (gradeConds.length) where.push(or(...gradeConds));
      if (subjectConds.length) where.push(or(...subjectConds));

      books =
        where.length > 0
          ? await db
              .select()
              .from(schema.books)
              .where(and(...where))
              .orderBy(desc(schema.books.createdAt))
          : await db
              .select()
              .from(schema.books)
              .orderBy(desc(schema.books.createdAt));
    } else {
      books = await db
        .select()
        .from(schema.books)
        .orderBy(desc(schema.books.createdAt));
    }

    return res.status(200).json({ books });
  } catch (error) {
    console.error("Error fetching books:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// == PUT HANDLER ==
export async function PUT(req: Request, res: Response) {
  console.log("=== CLIENT API BOOKS PUT ===");

  try {
    const user = authenticate(req);
    if (user.role !== "admin" && user.role !== "teacher") {
      return res.status(403).json({ message: "Access denied" });
    }

    const bookId = parseInt(req.query.id as string, 10);
    const { title, description, type, grade, coverImage, musicUrl, quizMode } = req.body;

    if (!title || !description || !type || !grade) {
      return res.status(400).json({
        message: "Validation error",
        errors: "Title, description, type, and grade are required",
      });
    }

    const book = await db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
    });
    if (!book) return res.status(404).json({ message: "Book not found" });

    const safeQuizMode: "retry" | "straight" = quizMode === "straight" ? "straight" : "retry";

    // Update slug only if title changed
    let nextSlug = book.slug;
    if (title !== book.title) {
      const base = slugify(String(title).slice(0, 200));
      nextSlug = await ensureUniqueSlug(base);
    }

    const [updatedBook] = await db
      .update(schema.books)
      .set({
  slug: nextSlug,
  title: String(title).slice(0, 1000),
  description: String(description).slice(0, 4000),
  type,
  grade,
  coverImage: coverImage || null,
  musicUrl: musicUrl || null,
  quizMode: safeQuizMode,
      })
      .where(eq(schema.books.id, bookId))
      .returning();

    return res.status(200).json({
      message: "Book updated successfully",
      book: updatedBook,
    });
  } catch (error) {
    console.error("=== CLIENT API: Error updating book ===", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "Authentication required" || msg === "Invalid or expired token") {
      return res.status(401).json({ message: msg });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
}

// == POST HANDLER ==
export async function POST(req: Request, res: Response) {
  try {
    const user = authenticate(req);
    if (user.role !== "admin" && user.role !== "teacher") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { title, description, type, grade, coverImage, musicUrl, quizMode } = req.body;

    if (!title || !description || !type || !grade) {
      return res.status(400).json({
        message: "Validation error",
        errors: "Title, description, type, and grade are required",
      });
    }

    const safeQuizMode: "retry" | "straight" =
      quizMode === "straight" ? "straight" : "retry";

    // NEW: generate unique slug
    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(baseSlug);

    const [newBook] = await db
      .insert(schema.books)
      .values({
        slug, // REQUIRED
        title,
        description,
        type,
        grade,
        coverImage: coverImage || null,
        musicUrl: musicUrl || null,
        quizMode: safeQuizMode,
        addedById: user.id,
      })
      .returning();

    return res.status(201).json({
      message: "Book created successfully",
      book: newBook,
    });
  } catch (error) {
    console.error("Error creating book:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "Authentication required" || msg === "Invalid or expired token") {
      return res.status(401).json({ message: msg });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
}

// == DELETE HANDLER ==
export async function DELETE(req: Request, res: Response) {
  try {
    const user = authenticate(req);
    if (user.role !== "admin" && user.role !== "teacher") {
      return res.status(403).json({ message: "Access denied" });
    }

    const bookId = parseInt(req.query.id as string, 10);

    const book = await db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
    });
    if (!book) return res.status(404).json({ message: "Book not found" });

    await db.delete(schema.books).where(eq(schema.books.id, bookId));

    return res.status(200).json({
      message: "Book deleted successfully",
      id: bookId,
    });
  } catch (error) {
    console.error("Error deleting book:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "Authentication required" || msg === "Invalid or expired token") {
      return res.status(401).json({ message: msg });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
}

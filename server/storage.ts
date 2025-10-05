import { db } from "@db";
import * as schema from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import bcrypt from "bcrypt";

export const storage = {
  // User operations
  async getUserById(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true
      }
      });
    } catch (err) {
      console.error("storage.getUserById error:", err);
      throw new Error("Failed to fetch user");
    }
  },

  async getUserByEmail(email: string) {
    if (!email || typeof email !== "string") return null;
    try {
      return await db.query.users.findFirst({
        where: eq(schema.users.email, email)
      });
    } catch (err) {
      console.error("storage.getUserByEmail error:", err);
      throw new Error("Failed to fetch user by email");
    }
  },

  async createUser(user: schema.InsertUser) {
    try {
      const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
      const rounds = Number.isFinite(SALT_ROUNDS) ? Math.max(8, Math.min(16, SALT_ROUNDS)) : 10;
      const hashedPassword = await bcrypt.hash(user.password, rounds);

      const [newUser] = await db.insert(schema.users)
        .values({
          ...user,
          password: hashedPassword
        })
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          role: schema.users.role
        });

      return newUser;
    } catch (err) {
      console.error("storage.createUser error:", err);
      throw new Error("Failed to create user");
    }
  },

  // Book operations
  async getBooks(type?: string) {
    try {
      if (type && type !== 'all') {
        return await db.query.books.findMany({
          where: eq(schema.books.type, type as any),
          orderBy: desc(schema.books.createdAt)
        });
      }

      return await db.query.books.findMany({
        orderBy: desc(schema.books.createdAt)
      });
    } catch (err) {
      console.error("storage.getBooks error:", err);
      throw new Error("Failed to fetch books");
    }
  },

  async getBookById(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return await db.query.books.findFirst({
        where: eq(schema.books.id, id),
        with: {
          chapters: {
            orderBy: asc(schema.chapters.orderIndex)
          }
        }
      });
    } catch (err) {
      console.error("storage.getBookById error:", err);
      throw new Error("Failed to fetch book");
    }
  },

  async createBook(book: schema.InsertBook) {
    try {
      const [newBook] = await db.insert(schema.books)
        .values(book)
        .returning();
      return newBook;
    } catch (err) {
      console.error("storage.createBook error:", err);
      throw new Error("Failed to create book");
    }
  },

  // Chapter operations
  async getChaptersByBookId(bookId: number) {
    if (!Number.isFinite(bookId) || bookId <= 0) return [];
    try {
      return await db.query.chapters.findMany({
        where: eq(schema.chapters.bookId, bookId),
        orderBy: asc(schema.chapters.orderIndex)
      });
    } catch (err) {
      console.error("storage.getChaptersByBookId error:", err);
      throw new Error("Failed to fetch chapters");
    }
  },

  async createChapter(chapter: schema.InsertChapter) {
    try {
      const [newChapter] = await db.insert(schema.chapters)
        .values(chapter)
        .returning();
      return newChapter;
    } catch (err) {
      console.error("storage.createChapter error:", err);
      throw new Error("Failed to create chapter");
    }
  },

  // Progress operations
  async getProgressByUserId(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) return [];
    try {
      return await db.query.progress.findMany({
        where: eq(schema.progress.userId, userId),
        with: {
          book: true
        },
        orderBy: desc(schema.progress.lastReadAt)
      });
    } catch (err) {
      console.error("storage.getProgressByUserId error:", err);
      throw new Error("Failed to fetch progress");
    }
  },

  async getProgressByUserAndBookId(userId: number, bookId: number) {
    if (!Number.isFinite(userId) || !Number.isFinite(bookId)) return null;
    try {
      return await db.query.progress.findFirst({
        where: and(
          eq(schema.progress.userId, userId),
          eq(schema.progress.bookId, bookId)
        )
      });
    } catch (err) {
      console.error("storage.getProgressByUserAndBookId error:", err);
      throw new Error("Failed to fetch progress");
    }
  },

  async createOrUpdateProgress(progress: schema.InsertProgress) {
    try {
      const existingProgress = await this.getProgressByUserAndBookId(
        progress.userId,
        progress.bookId
      );

      if (existingProgress) {
        const [updatedProgress] = await db.update(schema.progress)
          .set({
            ...progress,
            lastReadAt: new Date()
          })
          .where(eq(schema.progress.id, existingProgress.id))
          .returning();

        return updatedProgress;
      }

      const [newProgress] = await db.insert(schema.progress)
        .values(progress)
        .returning();

      return newProgress;
    } catch (err) {
      console.error("storage.createOrUpdateProgress error:", err);
      throw new Error("Failed to create or update progress");
    }
  },

  // Student operations (for admin)
  async getAllStudents() {
    try {
      return await db.query.users.findMany({
        where: eq(schema.users.role, 'student'),
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          gradeLevel: true,
          approvalStatus: true,
          createdAt: true
        }
      });
    } catch (err) {
      console.error("storage.getAllStudents error:", err);
      throw new Error("Failed to fetch students");
    }
  },
  
  async getPendingStudents() {
    try {
      return await db.query.users.findMany({
        where: and(
          eq(schema.users.role, 'student'),
          eq(schema.users.approvalStatus, 'pending')
        ),
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          gradeLevel: true,
          approvalStatus: true,
          createdAt: true
        }
      });
    } catch (err) {
      console.error("storage.getPendingStudents error:", err);
      throw new Error("Failed to fetch pending students");
    }
  },
  
  async approveStudent(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      const [updatedUser] = await db.update(schema.users)
        .set({
          approvalStatus: 'approved'
        })
        .where(and(
          eq(schema.users.id, id),
          eq(schema.users.role, 'student')
        ))
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          role: schema.users.role,
          approvalStatus: schema.users.approvalStatus
        });

      return updatedUser;
    } catch (err) {
      console.error("storage.approveStudent error:", err);
      throw new Error("Failed to approve student");
    }
  },
  
  async rejectStudent(id: number, reason: string) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      const safeReason = typeof reason === 'string' ? reason.slice(0, 1000) : '';
      const [updatedUser] = await db.update(schema.users)
        .set({
          approvalStatus: 'rejected',
          rejectionReason: safeReason
        })
        .where(and(
          eq(schema.users.id, id),
          eq(schema.users.role, 'student')
        ))
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          role: schema.users.role,
          approvalStatus: schema.users.approvalStatus,
          rejectionReason: schema.users.rejectionReason
        });

      return updatedUser;
    } catch (err) {
      console.error("storage.rejectStudent error:", err);
      throw new Error("Failed to reject student");
    }
  },

  // Page operations
  async getPagesByBookId(bookId: number) {
    if (!Number.isFinite(bookId) || bookId <= 0) return [];
    try {
      return await db.query.pages.findMany({
        where: eq(schema.pages.bookId, bookId),
        orderBy: asc(schema.pages.pageNumber),
        with: {
          questions: true
        }
      });
    } catch (err) {
      console.error("storage.getPagesByBookId error:", err);
      throw new Error("Failed to fetch pages");
    }
  },

  async getPageById(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return await db.query.pages.findFirst({
        where: eq(schema.pages.id, id),
        with: {
          questions: true
        }
      });
    } catch (err) {
      console.error("storage.getPageById error:", err);
      throw new Error("Failed to fetch page");
    }
  },

  async createPage(page: schema.InsertPage) {
    try {
      const [newPage] = await db.insert(schema.pages)
        .values(page)
        .returning();
      return newPage;
    } catch (err) {
      console.error("storage.createPage error:", err);
      throw new Error("Failed to create page");
    }
  },

  async updatePage(id: number, page: Partial<schema.InsertPage>) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      const [updatedPage] = await db.update(schema.pages)
        .set(page)
        .where(eq(schema.pages.id, id))
        .returning();
      return updatedPage;
    } catch (err) {
      console.error("storage.updatePage error:", err);
      throw new Error("Failed to update page");
    }
  },

  async deletePage(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return await db.delete(schema.pages)
        .where(eq(schema.pages.id, id))
        .returning();
    } catch (err) {
      console.error("storage.deletePage error:", err);
      throw new Error("Failed to delete page");
    }
  },

  // Question operations
  async getQuestionsByPageId(pageId: number) {
    if (!Number.isFinite(pageId) || pageId <= 0) return [];
    try {
      return await db.query.questions.findMany({
        where: eq(schema.questions.pageId, pageId)
      });
    } catch (err) {
      console.error("storage.getQuestionsByPageId error:", err);
      throw new Error("Failed to fetch questions");
    }
  },

  async createQuestion(question: schema.InsertQuestion) {
    try {
      const [newQuestion] = await db.insert(schema.questions)
        .values(question)
        .returning();
      return newQuestion;
    } catch (err) {
      console.error("storage.createQuestion error:", err);
      throw new Error("Failed to create question");
    }
  },

  async updateQuestion(id: number, question: Partial<schema.InsertQuestion>) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      const [updatedQuestion] = await db.update(schema.questions)
        .set(question)
        .where(eq(schema.questions.id, id))
        .returning();
      return updatedQuestion;
    } catch (err) {
      console.error("storage.updateQuestion error:", err);
      throw new Error("Failed to update question");
    }
  },

  async deleteQuestion(id: number) {
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return await db.delete(schema.questions)
        .where(eq(schema.questions.id, id))
        .returning();
    } catch (err) {
      console.error("storage.deleteQuestion error:", err);
      throw new Error("Failed to delete question");
    }
  }
};

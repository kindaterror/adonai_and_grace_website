// src/server/db/schema.ts
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  json,
  pgEnum,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
// add these
import { uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* =========================
   ENUMS
========================= */
export const userRoleEnum = pgEnum("user_role", ["admin", "student", "teacher"]);
export const bookTypeEnum = pgEnum("book_type", ["storybook", "educational"]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const gradeLevelEnum = pgEnum("grade_level", ["K", "1", "2", "3", "4", "5", "6"]);
export const quizModeEnum = pgEnum("quiz_mode", ["retry", "straight"]);

// NEW: how a badge is awarded for a given book
export const badgeAwardMethodEnum = pgEnum("badge_award_method", [
  "auto_on_book_complete", // auto when student completes the book (percentage threshold)
  "manual",                // teacher/admin awards manually
]);

/* =========================
   USERS
========================= */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    password: text("password").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: userRoleEnum("role").notNull().default("student"),
    gradeLevel: gradeLevelEnum("grade_level"),
    approvalStatus: approvalStatusEnum("approval_status").default("pending"),
    rejectionReason: text("rejection_reason"),
    securityQuestion: text("security_question"),
    securityAnswer: text("security_answer"),
    loginAttempts: integer("login_attempts").notNull().default(0),
    lastFailedLoginAt: timestamp("last_failed_login_at", { mode: "date" }).defaultNow().notNull(),

    emailVerified: boolean("email_verified").default(false),
    emailVerificationToken: text("email_verification_token"),
    emailVerificationExpires: timestamp("email_verification_expires"),

    passwordResetToken: text("password_reset_token"),
    passwordResetExpires: timestamp("password_reset_expires"),

    avatar: varchar("avatar", { length: 255 }),
    avatarPublicId: varchar("avatar_public_id", { length: 191 }),
    bio: text("bio"),

    passwordChangedAt: timestamp("password_changed_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Case-insensitive uniqueness
    emailLowerIdx: uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    usernameLowerIdx: uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
  })
);

/* =========================
   BOOKS
========================= */
export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),

    // NOTE: normalized to snake in DB as 'cover_image'; app field is 'coverImage'
    coverImage: text("cover_image"),
    coverPublicId: varchar("cover_public_id", { length: 191 }),

    type: bookTypeEnum("type").notNull(),
    subject: text("subject"),
    grade: text("grade"),
    slug: text("slug").notNull(),
    rating: integer("rating").default(0),
    ratingCount: integer("rating_count").default(0),
    musicUrl: text("music_url"),
    quizMode: quizModeEnum("quiz_mode").notNull().default("retry"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    addedById: integer("added_by_id").references(() => users.id),
  },
  (t) => ({
    // Case-insensitive uniqueness on title + grade + subject
    uniq_title_grade_subject_ci: uniqueIndex("uniq_title_grade_subject_ci").on(
      sql`lower(${t.title})`,
      sql`coalesce(${t.grade}, '')`,
      sql`coalesce(${t.subject}, '')`
    ),
    uniq_slug: uniqueIndex("uniq_slug").on(t.slug),
  })
);

/* =========================
   PROGRESS (coarse stats)
========================= */
export const progress = pgTable(
  "progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    bookId: integer("book_id").references(() => books.id).notNull(),
    currentChapter: text("current_chapter"),
    percentComplete: integer("percent_complete").default(0),
    // Store SECONDS here for precision; keep the column name for now
    totalReadingTime: integer("total_reading_time").default(0),
    lastReadAt: timestamp("last_read_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq_progress_user_book: uniqueIndex("uniq_progress_user_book").on(t.userId, t.bookId),
    idx_progress_user_book_last: index("idx_progress_user_book_last").on(
      t.userId,
      t.bookId,
      t.lastReadAt
    ),
  })
);

/* =========================
   STORY CHECKPOINTS (precise resume)
========================= */
export const storyCheckpoints = pgTable(
  "story_checkpoints",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    bookId: integer("book_id").references(() => books.id).notNull(),
    // Choose either pageId or pageNumber (both optional; at least one should be used by app code)
    pageId: integer("page_id").references(() => pages.id),
    pageNumber: integer("page_number"),
    // Minimal state to resume reader exactly
    answersJson: json("answers_json").$type<Record<string, unknown> | null>().default(null),
    quizStateJson: json("quiz_state_json").$type<Record<string, unknown> | null>().default(null),
    audioPositionSec: integer("audio_position_sec").default(0), // narration head (optional)
    percentComplete: integer("percent_complete").default(0), // clamp 0..100 in API
    lastCheckpointAt: timestamp("last_checkpoint_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq_checkpoint_user_book: uniqueIndex("uniq_checkpoint_user_book").on(t.userId, t.bookId),
    idx_checkpoint_updated: index("idx_checkpoint_updated").on(t.lastCheckpointAt),
  })
);

/* =========================
   PAGES
========================= */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id").references(() => books.id).notNull(),
    pageNumber: integer("page_number").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    imagePublicId: varchar("image_public_id", { length: 191 }),
    audioUrl: text("audio_url"),
    audioPublicId: varchar("audio_public_id", { length: 191 }),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq_book_page_number: uniqueIndex("uniq_book_page_number").on(t.bookId, t.pageNumber),
    idx_pages_book: index("idx_pages_book").on(t.bookId),
  })
);

/* =========================
   QUESTIONS
========================= */
export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").references(() => pages.id).notNull(),
  questionText: text("question_text").notNull(),
  answerType: text("answer_type").default("text").notNull(), // "text" | "multiple_choice"
  correctAnswer: text("correct_answer"),
  options: text("options"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* =========================
   QUIZ ATTEMPTS
========================= */
export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    bookId: integer("book_id").references(() => books.id).notNull(),
    pageId: integer("page_id").references(() => pages.id),
    scoreCorrect: integer("score_correct").notNull(),
    scoreTotal: integer("score_total").notNull(),
    percentage: integer("percentage").notNull(), // 0–100
    mode: quizModeEnum("mode").notNull().default("retry"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    durationSec: integer("duration_sec").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    idx_attempts_user_book_time: index("idx_attempts_user_book_time").on(
      t.userId,
      t.bookId,
      t.createdAt
    ),
  })
);

/* =========================
   READING SESSIONS
========================= */
export const readingSessions = pgTable("reading_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  bookId: integer("book_id").references(() => books.id).notNull(),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  // NOTE: currently stores SECONDS (kept name for backward compat)
  totalMinutes: integer("total_minutes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* =========================
   CHAPTERS
========================= */
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").references(() => books.id).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  orderIndex: integer("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* =========================
   SYSTEM SETTINGS
========================= */
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  allowNewRegistrations: boolean("allow_new_registrations").default(true).notNull(),
  requireEmailVerification: boolean("require_email_verification").default(false).notNull(),
  autoApproveTeachers: boolean("auto_approve_teachers").default(false).notNull(),
  autoApproveStudents: boolean("auto_approve_students").default(false).notNull(),
  sessionTimeoutMinutes: integer("session_timeout_minutes").default(60).notNull(),
  maxLoginAttempts: integer("max_login_attempts").default(5).notNull(),
  requireStrongPasswords: boolean("require_strong_passwords").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* =========================
   TEACHING SETTINGS
========================= */
export const teachingSettings = pgTable("teaching_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  preferredGrades: json("preferred_grades").$type<string[]>().notNull(),
  subjects: json("subjects").$type<string[]>().notNull(),
  maxClassSize: integer("max_class_size").notNull().default(30),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/* =========================
   BADGES
========================= */
// Catalog of badge definitions (generic or custom)
export const badges = pgTable(
  "badges",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g., "Book Finisher", "Science Star"
    description: text("description"),
    iconUrl: text("icon_url"), // optional custom icon (Cloudinary URL)
    iconPublicId: varchar("icon_public_id", { length: 191 }),
    // NEW: theme colors for story-specific skinning
    themeColors: json("theme_colors").$type<
      | {
          primary?: string;
          secondary?: string;
          accent?: string;
        }
      | null
    >().default(null),
    isActive: boolean("is_active").notNull().default(true),
    isGeneric: boolean("is_generic").notNull().default(true), // true = fallback generic design
    createdById: integer("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Which badges are attached to which books (and how to award them)
export const bookBadges = pgTable(
  "book_badges",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id").references(() => books.id).notNull(),
    badgeId: integer("badge_id").references(() => badges.id).notNull(),

    // awarding rule for this (book, badge)
    awardMethod: badgeAwardMethodEnum("award_method")
      .notNull()
      .default("auto_on_book_complete"),
    completionThreshold: integer("completion_threshold").notNull().default(100), // % needed for auto
    isEnabled: boolean("is_enabled").notNull().default(true),

    // NEW: flexible criteria (e.g., quiz_pct, first_try, secret_path)
    criteriaJson: json("criteria_json").$type<Record<string, unknown> | null>().default(null),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq_book_badge: uniqueIndex("uniq_book_badge").on(t.bookId, t.badgeId),
    idx_book_badges_book: index("idx_book_badges_book").on(t.bookId),
  })
);

// Earned/awarded badges per student
export const earnedBadges = pgTable(
  "earned_badges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(), // student who earned it
    badgeId: integer("badge_id").references(() => badges.id).notNull(),
    bookId: integer("book_id").references(() => books.id), // book context (optional)
    awardedById: integer("awarded_by_id").references(() => users.id), // teacher/admin (manual)
    note: text("note"), // optional note
    awardedAt: timestamp("awarded_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq_user_badge: uniqueIndex("uniq_user_badge").on(t.userId, t.badgeId),
    idx_earned_badges_user_time: index("idx_earned_badges_user_time").on(t.userId, t.awardedAt),
  })
);

/* =========================
   RELATIONS
========================= */
export const usersRelations = relations(users, ({ many }) => ({
  progress: many(progress),
  books: many(books, { relationName: "addedBooks" }),
  readingSessions: many(readingSessions),
  teachingSettings: many(teachingSettings),
  quizAttempts: many(quizAttempts),
  // badges created by this user
  createdBadges: many(badges),
  // badges awarded by this user
  awardedBadges: many(earnedBadges, { relationName: "awardedBy" }),
  // badges earned by this user
  earnedBadges: many(earnedBadges, { relationName: "earnedBy" }),
  // checkpoints
  storyCheckpoints: many(storyCheckpoints),
}));

export const booksRelations = relations(books, ({ many, one }) => ({
  chapters: many(chapters),
  pages: many(pages),
  progress: many(progress),
  readingSessions: many(readingSessions),
  quizAttempts: many(quizAttempts),
  addedBy: one(users, {
    fields: [books.addedById],
    references: [users.id],
    relationName: "addedBooks",
  }),
  bookBadges: many(bookBadges),
  earnedBadges: many(earnedBadges),
  storyCheckpoints: many(storyCheckpoints),
}));

export const progressRelations = relations(progress, ({ one }) => ({
  user: one(users, { fields: [progress.userId], references: [users.id] }),
  book: one(books, { fields: [progress.bookId], references: [books.id] }),
}));

export const storyCheckpointsRelations = relations(storyCheckpoints, ({ one }) => ({
  user: one(users, { fields: [storyCheckpoints.userId], references: [users.id] }),
  book: one(books, { fields: [storyCheckpoints.bookId], references: [books.id] }),
}));

export const pagesRelations = relations(pages, ({ one, many }) => ({
  book: one(books, { fields: [pages.bookId], references: [books.id] }),
  questions: many(questions),
  quizAttempts: many(quizAttempts),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  page: one(pages, { fields: [questions.pageId], references: [pages.id] }),
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  book: one(books, { fields: [chapters.bookId], references: [books.id] }),
}));

export const readingSessionsRelations = relations(readingSessions, ({ one }) => ({
  user: one(users, { fields: [readingSessions.userId], references: [users.id] }),
  book: one(books, { fields: [readingSessions.bookId], references: [books.id] }),
}));

export const teachingSettingsRelations = relations(teachingSettings, ({ one }) => ({
  user: one(users, { fields: [teachingSettings.userId], references: [users.id] }),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one }) => ({
  user: one(users, { fields: [quizAttempts.userId], references: [users.id] }),
  book: one(books, { fields: [quizAttempts.bookId], references: [books.id] }),
  page: one(pages, { fields: [quizAttempts.pageId], references: [pages.id] }),
}));

// NEW relations for badges
export const badgesRelations = relations(badges, ({ one, many }) => ({
  createdBy: one(users, { fields: [badges.createdById], references: [users.id] }),
  bookBadges: many(bookBadges),
  earnedBadges: many(earnedBadges),
}));

export const bookBadgesRelations = relations(bookBadges, ({ one }) => ({
  book: one(books, { fields: [bookBadges.bookId], references: [books.id] }),
  badge: one(badges, { fields: [bookBadges.badgeId], references: [badges.id] }),
}));

export const earnedBadgesRelations = relations(earnedBadges, ({ one }) => ({
  badge: one(badges, { fields: [earnedBadges.badgeId], references: [badges.id] }),
  user: one(users, { fields: [earnedBadges.userId], references: [users.id], relationName: "earnedBy" }),
  book: one(books, { fields: [earnedBadges.bookId], references: [books.id] }),
  awardedBy: one(users, { fields: [earnedBadges.awardedById], references: [users.id], relationName: "awardedBy" }),
}));

/* =========================
   ZOD INSERT / UPDATE SCHEMAS
========================= */
export const insertUserSchema = createInsertSchema(users, {
  username: (s) => s.min(3, "Username must be at least 3 characters"),
  email: (s) => s.email("Please provide a valid email"),
  password: (s) => s.min(6, "Password must be at least 6 characters"),
  firstName: (s) => s.min(2, "First name must be at least 2 characters"),
  lastName: (s) => s.min(2, "Last name must be at least 2 characters"),
  securityQuestion: (s) => s.optional(),
  securityAnswer: (s) => s.optional(),
  emailVerified: (s) => s.optional(),
  emailVerificationToken: (s) => s.optional(),
  emailVerificationExpires: (s) => s.optional(),
  passwordResetToken: (s) => s.optional(),
  passwordResetExpires: (s) => s.optional(),
  avatar: (s) => s.optional(),
  avatarPublicId: (s) => s.optional(),
  bio: (s) => s.optional(),
  passwordChangedAt: (s) => s.optional(),
}).omit({ id: true, createdAt: true });

export const insertBookSchema = createInsertSchema(books, {
  title: (s) => s.min(2, "Title must be at least 2 characters"),
  description: (s) => s.min(10, "Description must be at least 10 characters"),
  subject: (s) => s.optional(),
  grade: (s) => s.optional(),
  coverImage: (s) => s.url("Cover image must be a valid URL").optional(),
  coverPublicId: (s) => s.optional(),
  musicUrl: (s) => s.url("Music URL must be a valid URL").optional(),
}).omit({ id: true, createdAt: true, rating: true, ratingCount: true });

export const insertProgressSchema = createInsertSchema(progress, {
  percentComplete: (s) => s.min(0).max(100),
}).omit({ id: true, createdAt: true });

export const insertStoryCheckpointSchema = createInsertSchema(storyCheckpoints, {
  pageId: (s) => s.optional(),
  pageNumber: (s) => s.optional(),
  answersJson: (s) => s.optional(),
  quizStateJson: (s) => s.optional(),
  audioPositionSec: (s) => s.min(0).optional(),
  percentComplete: (s) => s.min(0).max(100).optional(),
  lastCheckpointAt: (s) => s.optional(),
}).omit({ id: true, createdAt: true });

export const insertChapterSchema = createInsertSchema(chapters, {
  title: (s) => s.min(2, "Title must be at least 2 characters"),
  content: (s) => s.min(10, "Content must be at least 10 characters"),
}).omit({ id: true, createdAt: true });

export const insertPageSchema = createInsertSchema(pages, {
  content: (s) => s.min(1, "Content cannot be empty"),
  pageNumber: (s) => s.min(1, "Page number must be at least 1"),
  imageUrl: (s) => s.url("Image URL must be a valid URL").optional(),
  imagePublicId: (s) => s.optional(),
  audioUrl: (s) => s.url("Audio URL must be a valid URL").optional(),
  audioPublicId: (s) => s.optional(),
}).omit({ id: true, createdAt: true });

export const insertQuestionSchema = createInsertSchema(questions, {
  questionText: (s) => s.min(5, "Question must be at least 5 characters"),
}).omit({ id: true, createdAt: true });

export const insertQuizAttemptSchema = createInsertSchema(quizAttempts, {
  scoreCorrect: (s) => s.min(0),
  scoreTotal: (s) => s.min(1),
  percentage: (s) => s.min(0).max(100),
  durationSec: (s) => s.min(0),
  attemptNumber: (s) => s.min(1),
}).omit({ id: true, createdAt: true });

export const insertReadingSessionSchema = createInsertSchema(readingSessions).omit({
  id: true,
  createdAt: true,
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSystemSettingsSchema = z.object({
  allowNewRegistrations: z.boolean().optional(),
  requireEmailVerification: z.boolean().optional(),
  autoApproveTeachers: z.boolean().optional(),
  autoApproveStudents: z.boolean().optional(),
  sessionTimeoutMinutes: z.number().min(15).max(480).optional(),
  maxLoginAttempts: z.number().min(3).max(10).optional(),
  requireStrongPasswords: z.boolean().optional(),
});

export const insertTeachingSettingsSchema = createInsertSchema(teachingSettings, {
  preferredGrades: z.array(z.string()).min(1, "At least one grade must be selected"),
  subjects: z.array(z.string()).min(1, "At least one subject must be selected"),
  maxClassSize: z.number().min(10).max(50),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const updateTeachingSettingsSchema = insertTeachingSettingsSchema
  .partial()
  .extend({
    preferredGrades: z.array(z.string()).min(1, "At least one grade must be selected").optional(),
    subjects: z.array(z.string()).min(1, "At least one subject must be selected").optional(),
    maxClassSize: z.number().min(10).max(50).optional(),
  });

/* ===== ZOD for BADGES ===== */
export const insertBadgeSchema = createInsertSchema(badges, {
  name: (s) => s.min(2, "Badge name must be at least 2 characters"),
  description: (s) => s.optional(),
  iconUrl: (s) => s.url("Icon URL must be a valid URL").optional(),
  iconPublicId: (s) => s.optional(),
  themeColors: (s) => s.optional(),
  isActive: (s) => s.optional(),
  isGeneric: (s) => s.optional(),
  createdById: (s) => s.optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertBookBadgeSchema = createInsertSchema(bookBadges, {
  completionThreshold: (s) =>
    s.min(1, "Threshold must be at least 1%").max(100, "Threshold cannot exceed 100%"),
  isEnabled: (s) => s.optional(),
  criteriaJson: (s) => s.optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertEarnedBadgeSchema = createInsertSchema(earnedBadges, {
  note: (s) => s.optional(),
  awardedById: (s) => s.optional(),
  bookId: (s) => s.optional(),
}).omit({ id: true, createdAt: true, awardedAt: true });

/* =========================
   AUTH / MISC SCHEMAS
========================= */
export const loginSchema = z.object({
  email: z.string().email("Please provide a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const emailVerificationSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Please provide a valid email"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please provide a valid email"),
});

export const resetPasswordWithTokenSchema = z
  .object({
    token: z.string().min(1, "Reset token is required"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Confirm password is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Legacy
export const checkUsernameSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
});

export const verifySecuritySchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  securityAnswer: z.string().min(1, "Security answer is required"),
});

export const resetPasswordSchema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Confirm password is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/* =========================
   TYPES
========================= */
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Book = typeof books.$inferSelect;
export type InsertBook = z.infer<typeof insertBookSchema>;

export type Progress = typeof progress.$inferSelect;
export type InsertProgress = z.infer<typeof insertProgressSchema>;

// NEW types
export type StoryCheckpoint = typeof storyCheckpoints.$inferSelect;
export type InsertStoryCheckpoint = z.infer<typeof insertStoryCheckpointSchema>;

export type Chapter = typeof chapters.$inferSelect;
export type InsertChapter = z.infer<typeof insertChapterSchema>;

export type Page = typeof pages.$inferSelect;
export type InsertPage = z.infer<typeof insertPageSchema>;

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;

export type ReadingSession = typeof readingSessions.$inferSelect;
export type InsertReadingSession = z.infer<typeof insertReadingSessionSchema>;

export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type InsertQuizAttempt = z.infer<typeof insertQuizAttemptSchema>;

export type SystemSettings = typeof systemSettings.$inferSelect;
export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type UpdateSystemSettings = z.infer<typeof updateSystemSettingsSchema>;

export type TeachingSettings = typeof teachingSettings.$inferSelect;
export type InsertTeachingSettings = z.infer<typeof insertTeachingSettingsSchema>;
export type UpdateTeachingSettings = z.infer<typeof updateTeachingSettingsSchema>;

// Badge types
export type Badge = typeof badges.$inferSelect;
export type InsertBadge = z.infer<typeof insertBadgeSchema>;

export type BookBadge = typeof bookBadges.$inferSelect;
export type InsertBookBadge = z.infer<typeof insertBookBadgeSchema>;

export type EarnedBadge = typeof earnedBadges.$inferSelect;
export type InsertEarnedBadge = z.infer<typeof insertEarnedBadgeSchema>;

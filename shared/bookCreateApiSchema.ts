// shared/bookCreateApiSchema.ts
import { z } from "zod";

/**
 * Coerce empty string ("") and null to undefined so optional fields pass validation.
 */
const emptyToUndef = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), inner);

/**
 * Schema for POST /api/books and /api/teacher/books
 * - Strict: rejects unknown keys
 * - Trims strings
 * - Accepts "" for optional fields (coerced to undefined)
 * - Enforces business rules:
 *    • If type=educational → subject is required
 *    • coverImage and coverPublicId must be provided together
 */
export const BookCreateApiSchema = z
  .object({
    title: z.string().trim().min(2, "Title must be at least 2 characters").max(100),
    description: z
      .string()
      .trim()
      .min(10, "Description must be at least 10 characters")
      .max(1000),

    // enums aligned with your pgEnum() values
    type: z.enum(["storybook", "educational"]),
    quizMode: z.enum(["retry", "straight"]).optional().default("retry"),

    // optional fields commonly sent as ""
    subject: emptyToUndef(z.string().trim().min(1, "Subject cannot be empty").optional()),
    grade: emptyToUndef(z.string().trim().optional()), // DB allows free text; client uses K/1..6

    // media: allow blank → undefined; if provided, must be valid
    coverImage: emptyToUndef(z.string().url("Cover image must be a valid URL").optional()),
    coverPublicId: emptyToUndef(z.string().trim().max(191).optional()),
    musicUrl: emptyToUndef(z.string().url("Music URL must be a valid URL").optional()),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Business rule: educational requires subject
    if (data.type === "educational" && !data.subject) {
      ctx.addIssue({
        code: "custom",
        path: ["subject"],
        message: "Subject is required for educational books",
      });
    }

    // Pairing rule: coverImage & coverPublicId must be provided together
    const hasCover = !!data.coverImage;
    const hasPid = !!data.coverPublicId;
    if (hasCover !== hasPid) {
      ctx.addIssue({
        code: "custom",
        path: ["coverImage"],
        message: "Provide both coverImage and coverPublicId together.",
      });
      ctx.addIssue({
        code: "custom",
        path: ["coverPublicId"],
        message: "Provide both coverImage and coverPublicId together.",
      });
    }
  });

export type BookCreateApiInput = z.infer<typeof BookCreateApiSchema>;
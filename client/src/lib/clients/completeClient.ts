// lib/clients/completeClient.ts

// == IMPORTS ==
import { apiRequest } from "@/lib/queryClient";

// == TYPES (mirror server response shape) ==
export type CompleteResponse = {
  success?: boolean;           // some routes return { ok: true } instead
  ok?: boolean;                // /api/stories/:slug/complete uses this
  message?: string;

  // Generic data block (numeric route)
  data?: {
    userId: number;
    bookId?: number;           // present for numeric route
    percentComplete?: number;  // typically 100
    completedAt?: string;      // ISO
    badgesAutoAwarded?: number[];
  };

  // Extras returned by /api/stories/:slug/complete
  awardedBadge?: {
    badgeId: number;
    badgeName: string;
  } | null;
  badgeAttempted?: boolean;
  alreadyHad?: boolean;

  // keep flexible for any other props
  [key: string]: any;
};

// == URL HELPERS ==
/** Build the correct complete URL for either numeric ID or slug */
const completeUrl = (book: number | string) =>
  typeof book === "number"
    ? `/api/books/${book}/complete` // numeric ID → generic complete
    : `/api/stories/${encodeURIComponent(book)}/complete`; // slug → exclusive story flow

// == CLIENT FUNCTION ==
/** POST to mark a book as completed (supports numeric ID or slug) */
export async function markBookComplete(book: number | string) {
  // input hardening: normalize numeric IDs and truncate long slugs
  if (typeof book === "number") {
    const id = Number(book);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid book id");
    return apiRequest<CompleteResponse>("POST", completeUrl(id), {});
  }

  const s = String(book).slice(0, 200);
  return apiRequest<CompleteResponse>("POST", completeUrl(s), {});
}

// == OPTIONAL: convenience wrappers ==
export const markCompleteById = (bookId: number) => markBookComplete(bookId);
export const markCompleteBySlug = (slug: string) => markBookComplete(slug);

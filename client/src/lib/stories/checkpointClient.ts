// lib/clients/checkpointClient.ts
import { apiRequest } from "@/lib/queryClient";

/* ================= Types (server shape) ================= */
export type StoryCheckpoint = {
  id: number;
  userId: number;
  bookId: number;
  pageId: number | null;
  pageNumber: number | null;
  answersJson: any | null;
  quizStateJson: any | null;
  audioPositionSec: number;
  percentComplete: number; // 0–100
  lastCheckpointAt: string; // ISO
  createdAt: string; // ISO
} | null;

export type GetCheckpointResponse = {
  success: boolean;
  checkpoint: StoryCheckpoint;
};

export type SaveCheckpointPayload = {
  pageId?: number | null;
  page_id?: number | null;
  pageNumber?: number | null;
  page_number?: number | null;
  answersJson?: any | null;
  answers_json?: any | null;
  quizStateJson?: any | null;
  quiz_state_json?: any | null;
  audioPositionSec?: number;
  audio_position_sec?: number;
  percentComplete?: number;
  percentage?: number;
  percent?: number;
};

export type SaveCheckpointResponse = {
  success: boolean;
  message: string;
  checkpoint: StoryCheckpoint;
};

export type ResetCheckpointResponse = {
  success: boolean;
  message: string;
};

/* ================= URL builder ================= */
// Accepts either a numeric ID or a slug; always encodes safely.
const pathFor = (book: number | string) => {
  const s = String(book);
  // clamp slug length and encode
  const safe = encodeURIComponent(s.slice(0, 200));
  return `/api/stories/${safe}/checkpoint`;
};

/* ================= Client functions ================= */
export async function getCheckpoint(book: number | string): Promise<GetCheckpointResponse> {
  try {
    return await apiRequest<GetCheckpointResponse>("GET", pathFor(book));
  } catch (e: any) {
    // Treat 404 as "no checkpoint yet" instead of throwing
    if (e?.status === 404) {
      return { success: true, checkpoint: null };
    }
    throw e;
  }
}

export async function saveCheckpoint(
  book: number | string,
  payload: SaveCheckpointPayload
) {
  // sanitize numeric fields and known keys
  const p: SaveCheckpointPayload = {};
  if (payload.pageId !== undefined) p.pageId = payload.pageId == null ? null : Number(payload.pageId);
  if (payload.page_id !== undefined) p.page_id = payload.page_id == null ? null : Number(payload.page_id);
  if (payload.pageNumber !== undefined) p.pageNumber = payload.pageNumber == null ? null : Number(payload.pageNumber);
  if (payload.page_number !== undefined) p.page_number = payload.page_number == null ? null : Number(payload.page_number);
  if (payload.answersJson !== undefined) p.answersJson = payload.answersJson;
  if (payload.answers_json !== undefined) p.answers_json = payload.answers_json;
  if (payload.quizStateJson !== undefined) p.quizStateJson = payload.quizStateJson;
  if (payload.quiz_state_json !== undefined) p.quiz_state_json = payload.quiz_state_json;
  if (payload.audioPositionSec !== undefined) p.audioPositionSec = Math.max(0, Number(payload.audioPositionSec || 0));
  if (payload.audio_position_sec !== undefined) p.audio_position_sec = Math.max(0, Number(payload.audio_position_sec || 0));
  if (payload.percentComplete !== undefined) p.percentComplete = Math.min(100, Math.max(0, Number(payload.percentComplete || 0)));
  if (payload.percentage !== undefined) p.percentage = Math.min(100, Math.max(0, Number(payload.percentage || 0)));
  if (payload.percent !== undefined) p.percent = Math.min(100, Math.max(0, Number(payload.percent || 0)));

  return apiRequest<SaveCheckpointResponse>("PUT", pathFor(book), p);
}

export async function resetCheckpoint(book: number | string) {
  // If your API supports DELETE, prefer it; otherwise keep POST {action:"reset"}.
  // return apiRequest<ResetCheckpointResponse>("DELETE", pathFor(book));
  return apiRequest<ResetCheckpointResponse>("POST", pathFor(book), { action: "reset" });
}

/* ================= Helpers ================= */
export function toPercentDone(currentIdx: number, total: number) {
  if (!total || total <= 0) return 0;
  const pct = Math.round(((currentIdx + 1) / total) * 100);
  return Math.min(100, Math.max(0, pct));
}

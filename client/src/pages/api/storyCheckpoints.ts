// client/src/pages/api/storyCheckpoints.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** ============ Types ============ */
export type StoryCheckpointDTO = {
  id: number;
  userId: number;
  bookId: number;
  pageId?: number | null;
  pageNumber?: number | null;
  answersJson?: Record<string, unknown> | null;
  quizStateJson?: Record<string, unknown> | null;
  audioPositionSec?: number | null; // seconds, optional
  percentComplete?: number | null;  // 0..100
  lastCheckpointAt?: string;        // ISO
  createdAt?: string;               // ISO
};

export type SaveCheckpointInput = Partial<{
  pageId: number | null;
  page_id: number | null;
  pageNumber: number | null;
  page_number: number | null;
  answersJson: Record<string, unknown> | null;
  answers_json: Record<string, unknown> | null;
  quizStateJson: Record<string, unknown> | null;
  quiz_state_json: Record<string, unknown> | null;
  audioPositionSec: number | null;
  audio_position_sec: number | null;
  percentComplete: number | null; // will be clamped server-side
  percentage: number | null;      // alias
  percent: number | null;         // alias
}>;

/** ============ Low-level fetchers ============ */
const authHeaders = () => {
  let token: string | null = null;
  try { token = localStorage.getItem("token"); } catch { token = null; }
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export async function getCheckpoint(bookId: number): Promise<StoryCheckpointDTO | null> {
  const id = Number(bookId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid bookId");
  const res = await fetch(`/api/stories/${encodeURIComponent(String(id))}/checkpoint`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to get checkpoint (book ${bookId})`);
  }
  const data = await res.json();
  return (data?.checkpoint as StoryCheckpointDTO) ?? null;
}

export async function saveCheckpoint(
  bookId: number,
  input: SaveCheckpointInput
): Promise<StoryCheckpointDTO> {
  const id = Number(bookId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid bookId");
  const safeInput = { ...input } as SaveCheckpointInput;
  if (safeInput.percentComplete !== undefined && safeInput.percentComplete !== null) {
    safeInput.percentComplete = Math.min(100, Math.max(0, Number(safeInput.percentComplete)));
  }

  const res = await fetch(`/api/stories/${encodeURIComponent(String(id))}/checkpoint`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(safeInput ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to save checkpoint (book ${bookId})`);
  }
  const data = await res.json();
  return (data?.checkpoint as StoryCheckpointDTO) ?? null;
}

export async function resetCheckpoint(bookId: number): Promise<{ success: boolean; message?: string }> {
  const id = Number(bookId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid bookId");
  const res = await fetch(`/api/stories/${encodeURIComponent(String(id))}/checkpoint`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "reset" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to reset checkpoint (book ${bookId})`);
  }
  return res.json();
}

/** ============ React Query helpers (optional) ============ */
export function useCheckpoint(bookId: number) {
  const enabled = Number.isFinite(bookId) && !!localStorage.getItem("token");
  return useQuery({
    queryKey: ["story-checkpoint", bookId],
    queryFn: () => getCheckpoint(bookId),
    enabled,
    staleTime: 15_000, // a little caching is fine
  });
}

export function useSaveCheckpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { bookId: number; input: SaveCheckpointInput }) =>
      saveCheckpoint(args.bookId, args.input),
    onSuccess: (data, vars) => {
      qc.setQueryData(["story-checkpoint", vars.bookId], data);
    },
  });
}

export function useResetCheckpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bookId: number) => resetCheckpoint(bookId),
    onSuccess: (_data, bookId) => {
      qc.setQueryData(["story-checkpoint", bookId], null);
    },
  });
}

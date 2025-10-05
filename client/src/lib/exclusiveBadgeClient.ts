import { apiRequest } from "@/lib/queryClient";

export async function awardExclusiveBadge(slug: string) {
  // server route: POST /api/stories/:slug/award-exclusive-badge
  const s = encodeURIComponent(String(slug).slice(0, 200));
  return apiRequest<{ ok: boolean }>("POST", `/api/stories/${s}/award-exclusive-badge`, {});
}

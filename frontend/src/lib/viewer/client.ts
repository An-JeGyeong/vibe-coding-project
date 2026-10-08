import { isRecord } from "@/lib/auth/client";
import { fail, INVALID_RESPONSE, isInt } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { publicGet } from "@/lib/publication/client";

// Public translated page images (CONTRACTS 27.2): no token, no role; the answer is the same for everyone.

/** The page numbers of the currently published version that have a translated image, ascending. Empty: the text reader is used. */
export async function listPublicPages(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<number[]>> {
  const result = await publicGet(`/api/public/episodes/${encodeURIComponent(episodeId)}/pages`, signal);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const pages: number[] = [];
  for (const item of body.items) {
    if (!isRecord(item) || !isInt(item.pageNo)) return fail(INVALID_RESPONSE);
    pages.push(item.pageNo);
  }
  return { ok: true, value: [...pages].sort((a, b) => a - b) };
}

/** An <img> loads this directly (no header is needed for public images). `attempt` only defeats a cached failure on retry. */
export function publicImageUrl(episodeId: string, pageNo: number, attempt = 0): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const url = `${base}/api/public/episodes/${encodeURIComponent(episodeId)}/pages/${pageNo}/image`;
  return attempt > 0 ? `${url}?retry=${attempt}` : url;
}

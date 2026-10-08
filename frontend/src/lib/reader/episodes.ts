import type { EpisodeResult } from "@/lib/episodes/types";
import { listPublicEpisodes } from "@/lib/publication/client";
import type { PublicEpisode } from "@/lib/publication/types";

export const PAGE_LIMIT = 100;
export const MAX_PAGES = 10;
export type AllPublicEpisodes = { items: PublicEpisode[]; truncated: boolean };

/** Loads the public list page by page (limit 100, at most 10 requests = 1000 episodes) for search and neighbour links (CONTRACTS 23.3). */
export async function loadAllPublicEpisodes(signal?: AbortSignal): Promise<EpisodeResult<AllPublicEpisodes>> {
  const items: PublicEpisode[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listPublicEpisodes(PAGE_LIMIT, page * PAGE_LIMIT, signal);
    if (!result.ok) return result;
    items.push(...result.value.items);
    if (items.length >= result.value.total || result.value.items.length === 0) return { ok: true, value: { items, truncated: false } };
  }
  return { ok: true, value: { items, truncated: true } };
}

/** Case-insensitive substring match on the title; surrounding spaces of the query are ignored for matching only. */
export function filterByTitle(items: PublicEpisode[], query: string): PublicEpisode[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? items : items.filter((item) => item.title.toLowerCase().includes(needle));
}

export function neighbours(items: PublicEpisode[], episodeId: string): { previous: PublicEpisode | null; next: PublicEpisode | null } | null {
  const index = items.findIndex((item) => item.episodeId === episodeId);
  if (index < 0) return null;
  return { previous: items[index - 1] ?? null, next: items[index + 1] ?? null };
}

/** The newest public episodes, newest first. The public list is ordered by episode id ascending, so the last `count` entries are read and reversed. */
export async function loadLatestPublicEpisodes(count: number, signal?: AbortSignal): Promise<EpisodeResult<{ items: PublicEpisode[]; total: number }>> {
  const first = await listPublicEpisodes(count, 0, signal);
  if (!first.ok) return first;
  if (first.value.total <= count) return { ok: true, value: { items: [...first.value.items].reverse(), total: first.value.total } };
  const last = await listPublicEpisodes(count, first.value.total - count, signal);
  return last.ok ? { ok: true, value: { items: [...last.value.items].reverse(), total: last.value.total } } : last;
}

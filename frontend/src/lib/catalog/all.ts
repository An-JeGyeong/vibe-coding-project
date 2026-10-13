import type { EpisodeResult } from "@/lib/episodes/types";
import { listWorks } from "./client";
import type { WorkSort, WorkSummary } from "./types";

export const WORKS_PAGE = 50; // the largest page the API allows (CONTRACTS 28.4)
export const WORKS_MAX_PAGES = 4;
export type AllWorks = { items: WorkSummary[]; truncated: boolean };

/** All public works of a genre, page by page (at most 200). Searching by title and author happens on the screen (CONTRACTS 30.2). */
export async function loadAllWorks(query: { genre?: string; sort: WorkSort }, signal?: AbortSignal): Promise<EpisodeResult<AllWorks>> {
  const items: WorkSummary[] = [];
  for (let page = 0; page < WORKS_MAX_PAGES; page++) {
    const result = await listWorks({ genre: query.genre, sort: query.sort, limit: WORKS_PAGE, offset: page * WORKS_PAGE }, signal);
    if (!result.ok) return result;
    items.push(...result.value.items);
    if (items.length >= result.value.total || result.value.items.length === 0) return { ok: true, value: { items, truncated: false } };
  }
  return { ok: true, value: { items, truncated: true } };
}

/** Case-insensitive substring match on the title and the author; surrounding spaces of the query are ignored. */
export function filterWorks(works: WorkSummary[], query: string): WorkSummary[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? works : works.filter((work) => work.title.toLowerCase().includes(needle) || work.author.toLowerCase().includes(needle));
}

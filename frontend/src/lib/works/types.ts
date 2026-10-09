import type { ReadingDirection } from "@/lib/catalog/types";

// Operator-side works (CONTRACTS 28.3). Public catalog types live in lib/catalog.
export type AdminWork = {
  id: string; title: string; author: string; readingDirection: ReadingDirection; genres: string[];
  isPublic: boolean; isFeatured: boolean; isBanner: boolean; hasCover: boolean;
  episodeCount: number; publicEpisodeCount: number; revision: number; updatedAt: string;
};
export type AdminWorkEpisode = { episodeId: string; episodeNo: number; title: string; published: boolean };
export type AdminWorkDetail = AdminWork & { description: string; episodes: AdminWorkEpisode[] };
export type AdminWorkList = { items: AdminWork[]; total: number };
/** What the operator edits; the server answers 400 for anything outside CONTRACTS 28.3. */
export type WorkInput = {
  title: string; author: string; description: string; readingDirection: ReadingDirection; genres: string[];
  isPublic: boolean; isFeatured: boolean; isBanner: boolean;
};
export type EpisodeWorkLink = { workId: string; title: string; episodeNo: number };
export const MAX_GENRES = 3;

// Public catalog (CONTRACTS 28.2, 28.4): works, covers, the home bundle. Everything here is public data; no token is ever sent.

/** The fixed genre list, in display order (CONTRACTS 28.2). */
export const GENRES = ["판타지", "액션", "로맨스", "코미디", "일상", "미스터리", "스릴러", "SF", "스포츠", "드라마"] as const;
export type Genre = (typeof GENRES)[number];

export type ReadingDirection = "RTL" | "LTR";

export type WorkSummary = {
  workId: string; title: string; author: string; genres: string[]; hasCover: boolean;
  episodeCount: number; latestPublishedAt: string; views: number; recommendCount: number;
};
export type LatestEpisode = {
  episodeId: string; title: string; publishedAt: string; workId: string | null; workTitle: string | null; episodeNo: number | null;
};
export type HomeData = { banners: WorkSummary[]; latest: LatestEpisode[]; popular: WorkSummary[]; featured: WorkSummary[] };
export type WorkList = { items: WorkSummary[]; total: number };
export type WorkEpisode = { episodeId: string; episodeNo: number; title: string; publishedAt: string };
export type WorkDetail = WorkSummary & { description: string; readingDirection: ReadingDirection; episodes: WorkEpisode[] };
export type EpisodeWork = { workId: string; title: string; readingDirection: ReadingDirection; episodeNo: number };
export type WorkSort = "latest" | "popular";

import { isRecord, send } from "@/lib/auth/client";
import { fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { publicGet } from "@/lib/publication/client";
import type { EpisodeWork, HomeData, LatestEpisode, ReadingDirection, WorkDetail, WorkEpisode, WorkList, WorkSort, WorkSummary } from "./types";

const id = (value: string) => encodeURIComponent(value);
const direction = (value: unknown): value is ReadingDirection => value === "RTL" || value === "LTR";

function summary(value: unknown): WorkSummary | null {
  if (!isRecord(value) || !isStr(value.workId) || !isStr(value.title) || !isStr(value.author) || !Array.isArray(value.genres)
    || !value.genres.every(isStr) || typeof value.hasCover !== "boolean" || !isInt(value.episodeCount) || !isTime(value.latestPublishedAt) || !isInt(value.views)) return null;
  return { workId: value.workId, title: value.title, author: value.author, genres: value.genres as string[], hasCover: value.hasCover,
    episodeCount: value.episodeCount, latestPublishedAt: value.latestPublishedAt, views: value.views };
}
function summaries(value: unknown): WorkSummary[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(summary);
  return items.every((item): item is WorkSummary => item !== null) ? items : null;
}
function latest(value: unknown): LatestEpisode | null {
  if (!isRecord(value) || !isStr(value.episodeId) || !isStr(value.title) || !isTime(value.publishedAt)) return null;
  const workId = value.workId ?? null, workTitle = value.workTitle ?? null, episodeNo = value.episodeNo ?? null;
  if (!(workId === null || isStr(workId)) || !(workTitle === null || isStr(workTitle)) || !(episodeNo === null || isInt(episodeNo))) return null;
  return { episodeId: value.episodeId, title: value.title, publishedAt: value.publishedAt, workId, workTitle, episodeNo };
}
function workEpisode(value: unknown): WorkEpisode | null {
  return isRecord(value) && isStr(value.episodeId) && isInt(value.episodeNo) && isStr(value.title) && isTime(value.publishedAt)
    ? { episodeId: value.episodeId, episodeNo: value.episodeNo, title: value.title, publishedAt: value.publishedAt } : null;
}

export async function getHome(signal?: AbortSignal): Promise<EpisodeResult<HomeData>> {
  const result = await publicGet("/api/public/home", signal);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.latest)) return fail(INVALID_RESPONSE);
  const banners = summaries(body.banners), popular = summaries(body.popular), featured = summaries(body.featured);
  const items = body.latest.map(latest);
  if (!banners || !popular || !featured || !items.every((item): item is LatestEpisode => item !== null)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { banners, latest: items, popular, featured } };
}

export async function listWorks(query: { genre?: string; sort?: WorkSort; limit?: number; offset?: number }, signal?: AbortSignal): Promise<EpisodeResult<WorkList>> {
  const params = new URLSearchParams();
  if (query.genre) params.set("genre", query.genre);
  params.set("sort", query.sort ?? "latest");
  params.set("limit", String(query.limit ?? 20));
  params.set("offset", String(query.offset ?? 0));
  const result = await publicGet(`/api/public/works?${params.toString()}`, signal);
  if (!result.ok) return result;
  const body = result.value;
  const items = isRecord(body) ? summaries(body.items) : null;
  if (!isRecord(body) || !items || !isInt(body.total)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { items, total: body.total } };
}

export async function getWork(workId: string, signal?: AbortSignal): Promise<EpisodeResult<WorkDetail>> {
  const result = await publicGet(`/api/public/works/${id(workId)}`, signal);
  if (!result.ok) return result;
  const body = result.value;
  const head = summary(body);
  if (!head || !isRecord(body) || !isStr(body.description) || !direction(body.readingDirection) || !Array.isArray(body.episodes)) return fail(INVALID_RESPONSE);
  const episodes = body.episodes.map(workEpisode);
  if (!episodes.every((item): item is WorkEpisode => item !== null)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { ...head, description: body.description, readingDirection: body.readingDirection, episodes } };
}

/** The work a public episode belongs to; "not_found" means it belongs to no public work (the viewer then uses its plain behaviour). */
export async function getEpisodeWork(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<EpisodeWork>> {
  const result = await publicGet(`/api/public/episodes/${id(episodeId)}/work`, signal);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isStr(body.workId) || !isStr(body.title) || !direction(body.readingDirection) || !isInt(body.episodeNo)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { workId: body.workId, title: body.title, readingDirection: body.readingDirection, episodeNo: body.episodeNo } };
}

/** Counts one view (CONTRACTS 28.4). Fire and forget: whatever happens never shows on screen. */
export async function recordView(episodeId: string): Promise<void> {
  await send(`/api/public/episodes/${id(episodeId)}/views`, { method: "POST" });
}

/** An <img> loads this directly; the cover of a work that is not public (or has none) answers 404. */
export function coverUrl(workId: string): string {
  return `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/public/works/${id(workId)}/cover`;
}

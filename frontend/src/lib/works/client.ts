import { isRecord, parseJson } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeFailure, EpisodeResult } from "@/lib/episodes/types";
import { binary, statusFailure } from "@/lib/pages/client";
import type { AdminWork, AdminWorkDetail, AdminWorkEpisode, AdminWorkList, EpisodeWorkLink, WorkInput } from "./types";

const id = (value: string) => encodeURIComponent(value);
const direction = (value: unknown): value is "RTL" | "LTR" => value === "RTL" || value === "LTR";
const bool = (value: unknown): value is boolean => typeof value === "boolean";

// 409 bodies: REVISION_CONFLICT carries latestRevision, STATE_CONFLICT carries a reason (BANNER_LIMIT, COVER_REQUIRED, EPISODE_NO_TAKEN).
function onError(status: number, body: unknown): EpisodeFailure | null {
  if (status !== 409 || !isRecord(body) || !isRecord(body.error)) return null;
  if (body.error.code === "REVISION_CONFLICT") return { kind: "revision_conflict", latestRevision: isInt(body.error.latestRevision) ? body.error.latestRevision : null };
  if (body.error.code === "STATE_CONFLICT") return { kind: "state_conflict", currentStatus: isStr(body.error.reason) ? body.error.reason : null };
  return null;
}

function work(value: unknown): AdminWork | null {
  if (!isRecord(value) || !isStr(value.id) || !isStr(value.title) || !isStr(value.author) || !direction(value.readingDirection) || !Array.isArray(value.genres) || !value.genres.every(isStr)
    || !bool(value.isPublic) || !bool(value.isFeatured) || !bool(value.isBanner) || !bool(value.hasCover) || !isInt(value.episodeCount) || !isInt(value.publicEpisodeCount)
    || !isInt(value.revision) || !isTime(value.updatedAt)) return null;
  return { id: value.id, title: value.title, author: value.author, readingDirection: value.readingDirection, genres: value.genres as string[], isPublic: value.isPublic,
    isFeatured: value.isFeatured, isBanner: value.isBanner, hasCover: value.hasCover, episodeCount: value.episodeCount, publicEpisodeCount: value.publicEpisodeCount,
    revision: value.revision, updatedAt: value.updatedAt };
}

export async function listAdminWorks(limit: number, offset: number, signal?: AbortSignal): Promise<EpisodeResult<AdminWorkList>> {
  const result = await call({ path: `/api/works?limit=${limit}&offset=${offset}`, method: "GET", signal, ok: [200], onError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(work);
  return items.every((item): item is AdminWork => item !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

export async function getAdminWork(workId: string, signal?: AbortSignal): Promise<EpisodeResult<AdminWorkDetail>> {
  const result = await call({ path: `/api/works/${id(workId)}`, method: "GET", signal, ok: [200], onError });
  if (!result.ok) return result;
  const body = result.value;
  const head = work(body);
  if (!head || !isRecord(body) || !isStr(body.description) || !Array.isArray(body.episodes)) return fail(INVALID_RESPONSE);
  const episodes: AdminWorkEpisode[] = [];
  for (const item of body.episodes) {
    if (!isRecord(item) || !isStr(item.episodeId) || !isInt(item.episodeNo) || !isStr(item.title) || !bool(item.published)) return fail(INVALID_RESPONSE);
    episodes.push({ episodeId: item.episodeId, episodeNo: item.episodeNo, title: item.title, published: item.published });
  }
  return { ok: true, value: { ...head, description: body.description, episodes } };
}

/** A new work starts private, not featured and not a banner, so only the descriptive fields are sent. */
export async function createWork(input: WorkInput, signal?: AbortSignal): Promise<EpisodeResult<{ id: string; revision: number }>> {
  const body = { title: input.title, author: input.author, description: input.description, readingDirection: input.readingDirection, genres: input.genres };
  const result = await call({ path: "/api/works", method: "POST", body, signal, ok: [201], onError });
  if (!result.ok) return result;
  const value = result.value;
  return isRecord(value) && isStr(value.id) && isInt(value.revision) ? { ok: true, value: { id: value.id, revision: value.revision } } : fail(INVALID_RESPONSE);
}

export async function updateWork(workId: string, expectedRevision: number, input: WorkInput, signal?: AbortSignal): Promise<EpisodeResult<{ revision: number; changed: boolean }>> {
  const result = await call({ path: `/api/works/${id(workId)}`, method: "PUT", body: { expectedRevision, ...input }, signal, ok: [200], onError });
  if (!result.ok) return result;
  const value = result.value;
  return isRecord(value) && isInt(value.revision) && bool(value.changed) ? { ok: true, value: { revision: value.revision, changed: value.changed } } : fail(INVALID_RESPONSE);
}

/** The request body is the image itself (CONTRACTS 28.3); 201 when new, 200 when replaced. */
export async function uploadWorkCover(workId: string, file: Blob, signal?: AbortSignal): Promise<EpisodeResult<{ created: boolean }>> {
  const sent = await binary(`/api/works/${id(workId)}/cover`, { method: "PUT", body: file, contentType: file.type, signal });
  if (!sent.ok) return sent;
  const status = sent.response.status;
  if (status === 200 || status === 201) return { ok: true, value: { created: status === 201 } };
  const text = await sent.response.text().catch(() => "");
  return fail(onError(status, parseJson(text)) ?? statusFailure(status));
}

/** The operator's cover preview (a work that is not public has no public cover): bytes with the bearer header, shown from a Blob URL. */
export async function fetchAdminCover(workId: string, signal?: AbortSignal): Promise<EpisodeResult<Blob>> {
  const sent = await binary(`/api/works/${id(workId)}/cover`, { method: "GET", signal });
  if (!sent.ok) return sent;
  if (sent.response.status !== 200) return fail(statusFailure(sent.response.status));
  try { return { ok: true, value: await sent.response.blob() }; } catch { return fail({ kind: "network" }); }
}

export async function getEpisodeLink(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<EpisodeWorkLink | null>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/work`, method: "GET", signal, ok: [200], onError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !("work" in body)) return fail(INVALID_RESPONSE);
  if (body.work === null) return { ok: true, value: null };
  const w = body.work;
  return isRecord(w) && isStr(w.workId) && isStr(w.title) && isInt(w.episodeNo) ? { ok: true, value: { workId: w.workId, title: w.title, episodeNo: w.episodeNo } } : fail(INVALID_RESPONSE);
}

export async function linkEpisode(episodeId: string, workId: string, episodeNo: number, signal?: AbortSignal): Promise<EpisodeResult<{ workId: string; episodeNo: number }>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/work`, method: "PUT", body: { workId, episodeNo }, signal, ok: [200], onError });
  if (!result.ok) return result;
  const value = result.value;
  return isRecord(value) && isStr(value.workId) && isInt(value.episodeNo) ? { ok: true, value: { workId: value.workId, episodeNo: value.episodeNo } } : fail(INVALID_RESPONSE);
}

export async function unlinkEpisode(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<null>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/work`, method: "DELETE", signal, ok: [204], onError });
  return result.ok ? { ok: true, value: null } : result;
}

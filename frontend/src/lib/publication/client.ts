import { failureForStatus, isRecord, parseJson, send } from "@/lib/auth/client";
import { call, type CallResult, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { translationError } from "@/lib/translation/client";
import type { TranslationStatus } from "@/lib/translation/types";
import type {
  HoldOutcome, Publication, PublicationEntry, PublicBlock, PublicEpisode, PublicEpisodeList, PublicEpisodeView, PublishOutcome,
} from "./types";

const id = (value: string) => encodeURIComponent(value);

function entry(value: unknown): PublicationEntry | null {
  return isRecord(value) && isInt(value.versionNo) && isInt(value.sourceVersion) && isTime(value.publishedAt)
    ? { versionNo: value.versionNo, sourceVersion: value.sourceVersion, publishedAt: value.publishedAt } : null;
}

export async function getPublication(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<Publication>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/publication`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.history)) return fail(INVALID_RESPONSE);
  const current = body.current === null ? null : entry(body.current);
  const held = body.held === undefined || body.held === null ? null : entry(body.held); // absent in older responses
  const history = body.history.map(entry);
  if ((body.current !== null && current === null) || (body.held != null && held === null) || !history.every((item): item is PublicationEntry => item !== null)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { current, held, history } };
}

export async function publishTranslation(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<PublishOutcome>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/translations/${versionNo}/publish`, method: "POST", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.versionNo) || !isStr(body.status) || !isTime(body.publishedAt)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { versionNo: body.versionNo, status: body.status as TranslationStatus, publishedAt: body.publishedAt } };
}

export async function holdPublication(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<HoldOutcome>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/publication/hold`, method: "POST", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.versionNo) || !isStr(body.status) || !isTime(body.heldAt)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { versionNo: body.versionNo, status: body.status as TranslationStatus, heldAt: body.heldAt } };
}

export async function resumePublication(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<PublishOutcome>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/publication/resume`, method: "POST", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.versionNo) || !isStr(body.status) || !isTime(body.publishedAt)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { versionNo: body.versionNo, status: body.status as TranslationStatus, publishedAt: body.publishedAt } };
}

// Public reads never carry the login token: the reader sees the same thing logged in or not.
export async function publicGet(path: string, signal?: AbortSignal): Promise<CallResult> {
  const sent = await send(path, { method: "GET", signal });
  if (sent.kind === "failure") return fail(sent.failure);
  if (sent.status === 200) return { ok: true, value: parseJson(sent.text), status: 200 };
  if (sent.status === 404) return fail({ kind: "not_found" });
  return fail(failureForStatus(sent));
}

function publicEpisode(value: unknown): PublicEpisode | null {
  return isRecord(value) && isStr(value.episodeId) && isStr(value.title) && isTime(value.publishedAt)
    ? { episodeId: value.episodeId, title: value.title, publishedAt: value.publishedAt } : null;
}

export async function listPublicEpisodes(limit: number, offset: number, signal?: AbortSignal): Promise<EpisodeResult<PublicEpisodeList>> {
  const result = await publicGet(`/api/public/episodes?limit=${limit}&offset=${offset}`, signal);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(publicEpisode);
  return items.every((item): item is PublicEpisode => item !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

export async function getPublicEpisode(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<PublicEpisodeView>> {
  const result = await publicGet(`/api/public/episodes/${id(episodeId)}`, signal);
  if (!result.ok) return result;
  const body = result.value;
  const head = publicEpisode(body);
  if (!isRecord(body) || !head || !Array.isArray(body.blocks)) return fail(INVALID_RESPONSE);
  const blocks: PublicBlock[] = [];
  for (const item of body.blocks) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.text) || !(item.pageNo === null || isInt(item.pageNo))) return fail(INVALID_RESPONSE);
    blocks.push({ seq: item.seq, pageNo: item.pageNo as number | null, text: item.text }); // anything else the server might add is dropped
  }
  return { ok: true, value: { ...head, blocks } };
}

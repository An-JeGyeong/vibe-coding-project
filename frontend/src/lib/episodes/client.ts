import { errorCode, failureForStatus, isRecord, parseJson, send } from "@/lib/auth/client";
import { readToken } from "@/lib/auth/storage";
import type {
  DraftBlock, EpisodeDetail, EpisodeFailure, EpisodeList, EpisodeResult, EpisodeSummary, SaveOutcome, SavedBy,
  SourceBlock, SourceView, VersionSummary,
} from "./types";

const INVALID_RESPONSE: EpisodeFailure = { kind: "invalid_response" };
const fail = (failure: EpisodeFailure): { ok: false; failure: EpisodeFailure } => ({ ok: false, failure });

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const isTime = (value: unknown): value is string => isStr(value) && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && !Number.isNaN(Date.parse(value));

function savedBy(value: unknown): SavedBy | null {
  return isRecord(value) && isStr(value.id) && isStr(value.displayName) ? { id: value.id, displayName: value.displayName } : null;
}

function blocks(value: unknown): SourceBlock[] | null {
  if (!Array.isArray(value)) return null;
  const result: SourceBlock[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.text) || !(item.pageNo === null || isInt(item.pageNo))) return null;
    result.push({ seq: item.seq, pageNo: item.pageNo as number | null, text: item.text });
  }
  return result;
}

function source(value: unknown): SourceView | null {
  if (!isRecord(value) || !isInt(value.version) || !isTime(value.savedAt)) return null;
  const by = savedBy(value.savedBy);
  const list = blocks(value.blocks);
  return by && list ? { version: value.version, savedAt: value.savedAt, savedBy: by, blocks: list } : null;
}

function summary(value: unknown): EpisodeSummary | null {
  if (!isRecord(value) || !isStr(value.id) || !isStr(value.title) || !isInt(value.latestSourceVersion) || !isTime(value.updatedAt)) return null;
  return { id: value.id, title: value.title, latestSourceVersion: value.latestSourceVersion, updatedAt: value.updatedAt };
}

type Call = { path: string; method: string; body?: unknown; signal?: AbortSignal; ok: number[] };

// The bearer token is read from sessionStorage at call time; without one no request is sent.
async function call(request: Call): Promise<EpisodeResult<unknown>> {
  const stored = readToken();
  if (!stored.ok || stored.token === null) return fail({ kind: "unauthorized", code: "AUTH_REQUIRED" });
  const sent = await send(request.path, { method: request.method, token: stored.token, body: request.body, signal: request.signal });
  if (sent.kind === "failure") return fail(sent.failure);
  if (request.ok.includes(sent.status)) return { ok: true, value: parseJson(sent.text) };
  if (sent.status === 404) return fail({ kind: "not_found" });
  if (sent.status === 409) {
    const body = parseJson(sent.text);
    const latest = isRecord(body) && isRecord(body.error) && isInt(body.error.latestVersion) ? body.error.latestVersion : null;
    return fail(errorCode(body) === "VERSION_CONFLICT" ? { kind: "conflict", latestVersion: latest } : { kind: "server_error" });
  }
  return fail(failureForStatus(sent));
}

const id = (value: string) => encodeURIComponent(value);

export async function createEpisode(title: string, signal?: AbortSignal): Promise<EpisodeResult<EpisodeSummary>> {
  const result = await call({ path: "/api/episodes", method: "POST", body: { title }, signal, ok: [201] });
  if (!result.ok) return result;
  const created = isRecord(result.value) ? summary({ ...result.value, updatedAt: result.value.createdAt }) : null;
  return created ? { ok: true, value: created } : fail(INVALID_RESPONSE);
}

export async function listEpisodes(limit: number, offset: number, signal?: AbortSignal): Promise<EpisodeResult<EpisodeList>> {
  const result = await call({ path: `/api/episodes?limit=${limit}&offset=${offset}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(summary);
  return items.every((item): item is EpisodeSummary => item !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

export async function getEpisode(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<EpisodeDetail>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  const head = isRecord(body) ? summary(body) : null;
  if (!isRecord(body) || !head || !isTime(body.createdAt)) return fail(INVALID_RESPONSE);
  const current = body.source === null ? null : source(body.source);
  if (body.source !== null && current === null) return fail(INVALID_RESPONSE);
  return { ok: true, value: { ...head, createdAt: body.createdAt, source: current } };
}

export async function saveSource(episodeId: string, expectedVersion: number, draft: DraftBlock[], signal?: AbortSignal): Promise<EpisodeResult<SaveOutcome>> {
  const body = { expectedVersion, blocks: draft.map((block) => ({ pageNo: block.pageNo, text: block.text })) };
  const result = await call({ path: `/api/episodes/${id(episodeId)}/source`, method: "PUT", body, signal, ok: [200, 201] });
  if (!result.ok) return result;
  const out = result.value;
  return isRecord(out) && isInt(out.version) && typeof out.changed === "boolean"
    ? { ok: true, value: { version: out.version, changed: out.changed } } : fail(INVALID_RESPONSE);
}

export async function listVersions(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<VersionSummary[]>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/source/versions`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const items = isRecord(result.value) && Array.isArray(result.value.items) ? result.value.items : null;
  if (!items) return fail(INVALID_RESPONSE);
  const parsed: VersionSummary[] = [];
  for (const item of items) {
    const by = isRecord(item) ? savedBy(item.savedBy) : null;
    if (!isRecord(item) || !isInt(item.version) || !isTime(item.savedAt) || !isInt(item.blockCount) || !by) return fail(INVALID_RESPONSE);
    parsed.push({ version: item.version, savedAt: item.savedAt, savedBy: by, blockCount: item.blockCount });
  }
  return { ok: true, value: parsed };
}

export async function getVersion(episodeId: string, version: number, signal?: AbortSignal): Promise<EpisodeResult<SourceView>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/source/versions/${version}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const view = source(result.value);
  return view ? { ok: true, value: view } : fail(INVALID_RESPONSE);
}

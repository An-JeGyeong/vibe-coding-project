import { isRecord, parseJson } from "@/lib/auth/client";
import { readToken } from "@/lib/auth/storage";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeFailure, EpisodeResult } from "@/lib/episodes/types";
import type { PageImageMeta, PageImageScope } from "./types";

const TIMEOUT_MS = 30_000; // images are larger than JSON bodies
const id = (value: string) => encodeURIComponent(value);
const root = (scope: PageImageScope, episodeId: string) => (scope === "operator" ? `/api/episodes/${id(episodeId)}` : `/api/my/episodes/${id(episodeId)}`);

export function meta(value: unknown): PageImageMeta | null {
  return isRecord(value) && isInt(value.pageNo) && isStr(value.contentType) && isInt(value.byteSize) && isTime(value.updatedAt)
    ? { pageNo: value.pageNo, contentType: value.contentType, byteSize: value.byteSize, updatedAt: value.updatedAt } : null;
}

export function statusFailure(status: number): EpisodeFailure {
  switch (status) {
    case 400: return { kind: "invalid_request" };
    case 401: return { kind: "unauthorized", code: "AUTH_REQUIRED" };
    case 403: return { kind: "forbidden" };
    case 404: return { kind: "not_found" };
    case 503: return { kind: "unavailable" };
    default: return { kind: "server_error" };
  }
}

export async function listPageImages(scope: PageImageScope, episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<PageImageMeta[]>> {
  const result = await call({ path: `${root(scope, episodeId)}/pages`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items = body.items.map(meta);
  return items.every((item): item is PageImageMeta => item !== null) ? { ok: true, value: items } : fail(INVALID_RESPONSE);
}

// Binary requests: the bearer token goes in the header (an <img src> cannot send it), never in the URL.
export async function binary(path: string, init: { method: string; body?: Blob; contentType?: string; signal?: AbortSignal }): Promise<{ ok: true; response: Response } | { ok: false; failure: EpisodeFailure }> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { ok: false, failure: { kind: "misconfigured" } };
  const stored = readToken();
  if (!stored.ok || stored.token === null) return { ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } };
  if (init.signal?.aborted) return { ok: false, failure: { kind: "aborted" } };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const forward = () => controller.abort();
  init.signal?.addEventListener("abort", forward, { once: true });
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${stored.token}` };
    if (init.contentType) headers["Content-Type"] = init.contentType;
    const response = await fetch(`${base}${path}`, { method: init.method, headers, body: init.body, cache: "no-store", credentials: "omit", signal: controller.signal });
    return { ok: true, response };
  } catch {
    if (init.signal?.aborted) return { ok: false, failure: { kind: "aborted" } };
    return { ok: false, failure: { kind: timedOut ? "timeout" : "network" } };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forward);
  }
}

/** The bytes of one page image; the caller turns the Blob into an object URL and releases it again. */
export async function fetchPageImage(scope: PageImageScope, episodeId: string, pageNo: number, signal?: AbortSignal): Promise<EpisodeResult<Blob>> {
  const sent = await binary(`${root(scope, episodeId)}/pages/${pageNo}/image`, { method: "GET", signal });
  if (!sent.ok) return sent;
  if (sent.response.status !== 200) return fail(statusFailure(sent.response.status));
  try { return { ok: true, value: await sent.response.blob() }; } catch { return fail({ kind: "network" }); }
}

/** Operator only: the request body is the image itself (CONTRACTS 26.2). */
export async function uploadPageImage(episodeId: string, pageNo: number, file: Blob, signal?: AbortSignal): Promise<EpisodeResult<{ meta: PageImageMeta; created: boolean }>> {
  const sent = await binary(`/api/episodes/${id(episodeId)}/pages/${pageNo}/image`, { method: "PUT", body: file, contentType: file.type, signal });
  if (!sent.ok) return sent;
  const status = sent.response.status;
  if (status !== 200 && status !== 201) return fail(statusFailure(status));
  const saved = meta(parseJson(await sent.response.text()));
  return saved ? { ok: true, value: { meta: saved, created: status === 201 } } : fail(INVALID_RESPONSE);
}

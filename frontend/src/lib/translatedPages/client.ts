import { isRecord, parseJson } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { binary, meta, statusFailure } from "@/lib/pages/client";
import type { PageImageMeta, PageImageScope } from "@/lib/pages/types";

// Translated (typeset) page images of one translation version (CONTRACTS 27.2).
const id = (value: string | number) => encodeURIComponent(String(value));
const root = (scope: PageImageScope, episodeId: string, versionNo: number) =>
  `${scope === "operator" ? "/api/episodes" : "/api/my/episodes"}/${id(episodeId)}/translations/${id(versionNo)}/page-images`;

export async function listTranslatedImages(scope: PageImageScope, episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<PageImageMeta[]>> {
  const result = await call({ path: root(scope, episodeId, versionNo), method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items = body.items.map(meta);
  return items.every((item): item is PageImageMeta => item !== null) ? { ok: true, value: items } : fail(INVALID_RESPONSE);
}

/** The bytes of one translated page image; the bearer token goes in a header, so the caller shows it from a Blob URL. */
export async function fetchTranslatedImage(scope: PageImageScope, episodeId: string, versionNo: number, pageNo: number, signal?: AbortSignal): Promise<EpisodeResult<Blob>> {
  const sent = await binary(`${root(scope, episodeId, versionNo)}/${pageNo}`, { method: "GET", signal });
  if (!sent.ok) return sent;
  if (sent.response.status !== 200) return fail(statusFailure(sent.response.status));
  try { return { ok: true, value: await sent.response.blob() }; } catch { return fail({ kind: "network" }); }
}

/** Assigned translator only, DRAFT versions only; the request body is the image itself. */
export async function uploadTranslatedImage(episodeId: string, versionNo: number, pageNo: number, file: Blob, signal?: AbortSignal): Promise<EpisodeResult<{ meta: PageImageMeta; created: boolean }>> {
  const sent = await binary(`${root("mine", episodeId, versionNo)}/${pageNo}`, { method: "PUT", body: file, contentType: file.type, signal });
  if (!sent.ok) return sent;
  const status = sent.response.status;
  if (status === 409) {
    const body = parseJson(await sent.response.text().catch(() => ""));
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const current = error && typeof error.currentStatus === "string" ? error.currentStatus : null;
    return fail({ kind: "state_conflict", currentStatus: current });
  }
  if (status !== 200 && status !== 201) return fail(statusFailure(status));
  const saved = meta(parseJson(await sent.response.text()));
  return saved ? { ok: true, value: { meta: saved, created: status === 201 } } : fail(INVALID_RESPONSE);
}

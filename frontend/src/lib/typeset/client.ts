import { isRecord } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import type { TypesetBlock, TypesetVersion, TypesetVersionDetail } from "./types";

// The typesetter's read-only view of approved translations (CONTRACTS 29.5). Images are handled by lib/translatedPages.
const id = (value: string | number) => encodeURIComponent(String(value));

export async function listTypesettable(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<TypesetVersion[]>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/typesetting`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items: TypesetVersion[] = [];
  for (const item of body.items) {
    if (!isRecord(item) || !isInt(item.versionNo) || !isInt(item.sourceVersion) || !isTime(item.decidedAt)) return fail(INVALID_RESPONSE);
    items.push({ versionNo: item.versionNo, sourceVersion: item.sourceVersion, decidedAt: item.decidedAt });
  }
  return { ok: true, value: items };
}

export async function getTypesettable(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<TypesetVersionDetail>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/typesetting/${id(versionNo)}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.versionNo) || !isInt(body.sourceVersion) || !Array.isArray(body.blocks)) return fail(INVALID_RESPONSE);
  const blocks: TypesetBlock[] = [];
  for (const item of body.blocks) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.source) || !isStr(item.text) || !(item.pageNo === null || isInt(item.pageNo))) return fail(INVALID_RESPONSE);
    blocks.push({ seq: item.seq, pageNo: item.pageNo as number | null, source: item.source, text: item.text });
  }
  return { ok: true, value: { versionNo: body.versionNo, sourceVersion: body.sourceVersion, blocks } };
}

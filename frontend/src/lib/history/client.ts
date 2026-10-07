import { isRecord } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import type { HistoryItem, HistoryList, HistoryQuery, Person } from "./types";

function person(value: unknown): Person | null {
  return isRecord(value) && isStr(value.id) && isStr(value.displayName) ? { id: value.id, displayName: value.displayName } : null;
}

function item(value: unknown): HistoryItem | null {
  if (!isRecord(value) || !isStr(value.id) || !isTime(value.occurredAt) || !isStr(value.event) || !isStr(value.episodeId) || !isStr(value.episodeTitle)) return null;
  const actor = person(value.actor);
  const subject = value.subject === null || value.subject === undefined ? null : person(value.subject);
  const source = value.sourceVersion === null || value.sourceVersion === undefined ? null : value.sourceVersion;
  const version = value.translationVersionNo === null || value.translationVersionNo === undefined ? null : value.translationVersionNo;
  if (!actor || (value.subject != null && !subject) || !(source === null || isInt(source)) || !(version === null || isInt(version))) return null;
  // only the documented fields are kept; anything else the server might add is dropped
  return { id: value.id, occurredAt: value.occurredAt, event: value.event, actor, episodeId: value.episodeId, episodeTitle: value.episodeTitle, sourceVersion: source, translationVersionNo: version, subject };
}

export async function listHistory(query: HistoryQuery, signal?: AbortSignal): Promise<EpisodeResult<HistoryList>> {
  const params = new URLSearchParams();
  if (query.episodeId) params.set("episodeId", query.episodeId);
  if (query.event) params.set("event", query.event);
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  const result = await call({ path: `/api/history?${params.toString()}`, method: "GET", signal, ok: [200] });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(item);
  return items.every((entry): entry is HistoryItem => entry !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

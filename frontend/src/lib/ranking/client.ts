import { failureForStatus, isRecord, parseJson, send } from "@/lib/auth/client";
import { summary } from "@/lib/catalog/client";
import { fail, INVALID_RESPONSE, isInt } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { publicGet } from "@/lib/publication/client";
import type { Period, RankedWork, Ranking, RecommendState } from "./types";

const id = (value: string) => encodeURIComponent(value);

function ranked(value: unknown): RankedWork | null {
  const head = summary(value);
  if (!head || !isRecord(value) || !isInt(value.rank) || !isInt(value.score) || !isInt(value.periodViews) || !isInt(value.periodRecommends)) return null;
  return { ...head, rank: value.rank, score: value.score, periodViews: value.periodViews, periodRecommends: value.periodRecommends };
}

/** GET /api/public/rankings (CONTRACTS 31.4). Public data, no token. */
export async function getRanking(period: Period, limit = 10, signal?: AbortSignal): Promise<EpisodeResult<Ranking>> {
  const result = await publicGet(`/api/public/rankings?period=${period}&limit=${limit}`, signal);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || body.period !== period || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items = body.items.map(ranked);
  return items.every((item): item is RankedWork => item !== null) ? { ok: true, value: { period, items } } : fail(INVALID_RESPONSE);
}

/** Recommend or take the recommendation back (CONTRACTS 31.3). Both are idempotent; the answer carries the new count. */
export async function setRecommendation(workId: string, voterKey: string, on: boolean, signal?: AbortSignal): Promise<EpisodeResult<RecommendState>> {
  const sent = await send(`/api/public/works/${id(workId)}/${on ? "recommend" : "unrecommend"}`, { method: "POST", body: { voterKey }, signal });
  if (sent.kind === "failure") return fail(sent.failure);
  if (sent.status === 404) return fail({ kind: "not_found" });
  if (sent.status !== 200) return fail(failureForStatus(sent));
  const body = parseJson(sent.text);
  if (!isRecord(body) || typeof body.recommended !== "boolean" || !isInt(body.recommendCount) || body.recommendCount < 0) return fail(INVALID_RESPONSE);
  return { ok: true, value: { recommended: body.recommended, recommendCount: body.recommendCount } };
}

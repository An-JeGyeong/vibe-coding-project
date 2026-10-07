import { isRecord } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import type { EpisodeResult } from "@/lib/episodes/types";
import { parseBlockComments } from "@/lib/translation/comments";
import { parseDecision } from "@/lib/translation/decision";
import { translationError } from "@/lib/translation/client";
import type { TranslationBlock, TranslationStatus } from "@/lib/translation/types";
import type {
  DecideOutcome, DraftBlockComment, OperatorTranslationDetail, OperatorTranslationList, PendingReview, PendingReviewList, ReviewDetail,
  ReviewVersionList, ReviewVersionSummary,
} from "./types";

const STATUSES: readonly string[] = ["DRAFT", "REVIEW_PENDING", "REJECTED", "APPROVED", "PUBLISHED", "INVALIDATED", "ON_HOLD"];
const isStatus = (value: unknown): value is TranslationStatus => isStr(value) && STATUSES.includes(value);
const id = (value: string) => encodeURIComponent(value);

function blocks(value: unknown): TranslationBlock[] | null {
  if (!Array.isArray(value)) return null;
  const result: TranslationBlock[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.source) || !(item.pageNo === null || isInt(item.pageNo)) || !(item.text === null || isStr(item.text))) return null;
    result.push({ seq: item.seq, pageNo: item.pageNo as number | null, source: item.source, text: item.text as string | null });
  }
  return result;
}

function summary(value: unknown): ReviewVersionSummary | null {
  if (!isRecord(value) || !isInt(value.versionNo) || !isStatus(value.status) || !isInt(value.sourceVersion)
    || !(value.submittedAt === null || isTime(value.submittedAt))) return null;
  const decision = parseDecision(value.decision);
  if (!decision.ok) return null;
  return { versionNo: value.versionNo, status: value.status, sourceVersion: value.sourceVersion, submittedAt: value.submittedAt as string | null, decision: decision.value };
}

function pending(value: unknown): PendingReview | null {
  if (!isRecord(value) || !isStr(value.episodeId) || !isStr(value.title) || !isInt(value.versionNo) || !isInt(value.sourceVersion) || !isTime(value.submittedAt)) return null;
  return { episodeId: value.episodeId, title: value.title, versionNo: value.versionNo, sourceVersion: value.sourceVersion, submittedAt: value.submittedAt };
}

export async function listPendingReviews(limit: number, offset: number, signal?: AbortSignal): Promise<EpisodeResult<PendingReviewList>> {
  const result = await call({ path: `/api/my/reviews?limit=${limit}&offset=${offset}`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.items) || !isInt(body.total)) return fail(INVALID_RESPONSE);
  const items = body.items.map(pending);
  return items.every((item): item is PendingReview => item !== null) ? { ok: true, value: { items, total: body.total } } : fail(INVALID_RESPONSE);
}

export async function listEpisodeReviews(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<ReviewVersionList>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/reviews`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.latestSourceVersion) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items = body.items.map(summary);
  return items.every((item): item is ReviewVersionSummary => item !== null)
    ? { ok: true, value: { latestSourceVersion: body.latestSourceVersion, items } } : fail(INVALID_RESPONSE);
}

export async function getReview(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<ReviewDetail>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/reviews/${versionNo}`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  const head = summary(body);
  const list = isRecord(body) ? blocks(body.blocks) : null;
  if (!head || !isRecord(body) || typeof body.decidable !== "boolean" || !list) return fail(INVALID_RESPONSE);
  const blockComments = parseBlockComments(body.blockComments);
  if (!blockComments) return fail(INVALID_RESPONSE);
  return { ok: true, value: { ...head, decidable: body.decidable, blocks: list, blockComments } };
}

function outcome(value: unknown): DecideOutcome | null {
  return isRecord(value) && isInt(value.versionNo) && isStatus(value.status) && isTime(value.decidedAt)
    ? { versionNo: value.versionNo, status: value.status, decidedAt: value.decidedAt } : null;
}

export async function approveReview(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<DecideOutcome>> {
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/reviews/${versionNo}/approve`, method: "POST", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const done = outcome(result.value);
  return done ? { ok: true, value: done } : fail(INVALID_RESPONSE);
}

export async function rejectReview(episodeId: string, versionNo: number, reason: string, comments: DraftBlockComment[] = [], signal?: AbortSignal): Promise<EpisodeResult<DecideOutcome>> {
  // comments are optional (CONTRACTS 22.2): without any, the request is exactly the 18.1 one
  const body = comments.length > 0 ? { reason, comments: comments.map((comment) => ({ seq: comment.seq, text: comment.text })) } : { reason };
  const result = await call({ path: `/api/my/episodes/${id(episodeId)}/reviews/${versionNo}/reject`, method: "POST", body, signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const done = outcome(result.value);
  return done ? { ok: true, value: done } : fail(INVALID_RESPONSE);
}

export async function listOperatorTranslations(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<OperatorTranslationList>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/translations`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.latestSourceVersion) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items: OperatorTranslationList["items"] = [];
  for (const raw of body.items) {
    const head = summary(raw);
    if (!head || !isRecord(raw) || !isInt(raw.revision) || !isTime(raw.createdAt)) return fail(INVALID_RESPONSE);
    items.push({ ...head, revision: raw.revision, createdAt: raw.createdAt });
  }
  return { ok: true, value: { latestSourceVersion: body.latestSourceVersion, items } };
}

export async function getOperatorTranslation(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<OperatorTranslationDetail>> {
  const result = await call({ path: `/api/episodes/${id(episodeId)}/translations/${versionNo}`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  const head = summary(body);
  const list = isRecord(body) ? blocks(body.blocks) : null;
  if (!head || !isRecord(body) || !isTime(body.createdAt) || !list
    || !(body.invalidatedAt === null || body.invalidatedAt === undefined || isTime(body.invalidatedAt))) return fail(INVALID_RESPONSE);
  const blockComments = parseBlockComments(body.blockComments);
  if (!blockComments) return fail(INVALID_RESPONSE);
  return { ok: true, value: { versionNo: head.versionNo, status: head.status, sourceVersion: head.sourceVersion, createdAt: body.createdAt,
    submittedAt: head.submittedAt, decision: head.decision, invalidatedAt: (body.invalidatedAt as string | null | undefined) ?? null, blocks: list, blockComments } };
}

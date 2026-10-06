import { errorCode, isRecord } from "@/lib/auth/client";
import { call, fail, INVALID_RESPONSE, isInt, isStr, isTime } from "@/lib/episodes/client";
import { parseDecision } from "./decision";
import type { EpisodeFailure, EpisodeResult } from "@/lib/episodes/types";
import type {
  CreatedTranslation, SaveTranslationOutcome, SubmitOutcome, TranslationDetail, TranslationDraftBlock, TranslationList,
  TranslationStatus, TranslationSummary,
} from "./types";

const STATUSES: readonly string[] = ["DRAFT", "REVIEW_PENDING", "REJECTED", "APPROVED", "PUBLISHED", "INVALIDATED", "ON_HOLD"];
const isStatus = (value: unknown): value is TranslationStatus => isStr(value) && STATUSES.includes(value);

// Translation-specific error bodies (CONTRACTS 17.3): extra fields live inside the error object.
export function translationError(status: number, body: unknown): EpisodeFailure | null {
  const code = errorCode(body);
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  if (status === 400 && code === "INCOMPLETE_TRANSLATION") {
    const seqs = Array.isArray(error.missingSeqs) && error.missingSeqs.every(isInt) ? (error.missingSeqs as number[]) : [];
    return { kind: "incomplete", missingSeqs: seqs };
  }
  if (status === 409 && code === "VERSION_CONFLICT") return { kind: "revision_conflict", latestRevision: isInt(error.latestRevision) ? error.latestRevision : null };
  if (status === 409 && code === "STATE_CONFLICT") return { kind: "state_conflict", currentStatus: isStr(error.currentStatus) ? error.currentStatus : null };
  return null;
}

function summary(value: unknown): TranslationSummary | null {
  if (!isRecord(value) || !isInt(value.versionNo) || !isStatus(value.status) || !isInt(value.sourceVersion) || !isInt(value.revision)
    || !isTime(value.createdAt) || !(value.submittedAt === null || isTime(value.submittedAt))) return null;
  const decision = parseDecision(value.decision);
  if (!decision.ok) return null;
  return { versionNo: value.versionNo, status: value.status, sourceVersion: value.sourceVersion, revision: value.revision,
    createdAt: value.createdAt, submittedAt: value.submittedAt as string | null, decision: decision.value };
}

const base = (episodeId: string) => `/api/my/episodes/${encodeURIComponent(episodeId)}/translations`;

export async function listTranslations(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<TranslationList>> {
  const result = await call({ path: base(episodeId), method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.latestSourceVersion) || !Array.isArray(body.items)) return fail(INVALID_RESPONSE);
  const items = body.items.map(summary);
  return items.every((item): item is TranslationSummary => item !== null)
    ? { ok: true, value: { latestSourceVersion: body.latestSourceVersion, items } } : fail(INVALID_RESPONSE);
}

export async function createTranslation(episodeId: string, signal?: AbortSignal): Promise<EpisodeResult<CreatedTranslation>> {
  const result = await call({ path: base(episodeId), method: "POST", signal, ok: [201], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isInt(body.versionNo) || !isStatus(body.status) || !isInt(body.sourceVersion) || !isInt(body.revision)) return fail(INVALID_RESPONSE);
  return { ok: true, value: { versionNo: body.versionNo, status: body.status, sourceVersion: body.sourceVersion, revision: body.revision } };
}

export async function getTranslation(episodeId: string, versionNo: number, signal?: AbortSignal): Promise<EpisodeResult<TranslationDetail>> {
  const result = await call({ path: `${base(episodeId)}/${versionNo}`, method: "GET", signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const body = result.value;
  const head = summary(body);
  if (!head || !isRecord(body) || typeof body.editable !== "boolean" || !Array.isArray(body.blocks)) return fail(INVALID_RESPONSE);
  const blocks: TranslationDetail["blocks"] = [];
  for (const item of body.blocks) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.source) || !(item.pageNo === null || isInt(item.pageNo)) || !(item.text === null || isStr(item.text))) return fail(INVALID_RESPONSE);
    blocks.push({ seq: item.seq, pageNo: item.pageNo as number | null, source: item.source, text: item.text as string | null });
  }
  return { ok: true, value: { ...head, editable: body.editable, blocks } };
}

export async function saveTranslation(episodeId: string, versionNo: number, expectedRevision: number, blocks: TranslationDraftBlock[], signal?: AbortSignal): Promise<EpisodeResult<SaveTranslationOutcome>> {
  const body = { expectedRevision, blocks: blocks.map((block) => ({ seq: block.seq, text: block.text })) };
  const result = await call({ path: `${base(episodeId)}/${versionNo}`, method: "PUT", body, signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const out = result.value;
  return isRecord(out) && isInt(out.revision) && typeof out.changed === "boolean"
    ? { ok: true, value: { revision: out.revision, changed: out.changed } } : fail(INVALID_RESPONSE);
}

export async function submitTranslation(episodeId: string, versionNo: number, expectedRevision: number, signal?: AbortSignal): Promise<EpisodeResult<SubmitOutcome>> {
  const result = await call({ path: `${base(episodeId)}/${versionNo}/submit`, method: "POST", body: { expectedRevision }, signal, ok: [200], onError: translationError });
  if (!result.ok) return result;
  const out = result.value;
  return isRecord(out) && isInt(out.versionNo) && isStatus(out.status) && isTime(out.submittedAt)
    ? { ok: true, value: { versionNo: out.versionNo, status: out.status, submittedAt: out.submittedAt } } : fail(INVALID_RESPONSE);
}

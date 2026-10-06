export type TranslationStatus = "DRAFT" | "REVIEW_PENDING" | "REJECTED" | "APPROVED" | "PUBLISHED" | "INVALIDATED" | "ON_HOLD";

export type TranslationSummary = {
  versionNo: number; status: TranslationStatus; sourceVersion: number; revision: number; createdAt: string; submittedAt: string | null;
};
export type TranslationList = { latestSourceVersion: number; items: TranslationSummary[] };
export type TranslationBlock = { seq: number; pageNo: number | null; source: string; text: string | null };
export type TranslationDetail = TranslationSummary & { editable: boolean; blocks: TranslationBlock[] };

export type CreatedTranslation = { versionNo: number; status: TranslationStatus; sourceVersion: number; revision: number };
export type SaveTranslationOutcome = { revision: number; changed: boolean };
export type SubmitOutcome = { versionNo: number; status: TranslationStatus; submittedAt: string };
/** A block as sent to the server: only blocks that have a translation, identified by their source seq. */
export type TranslationDraftBlock = { seq: number; text: string };

export const STATUS_LABEL: Record<TranslationStatus, string> = {
  DRAFT: "작성 중", REVIEW_PENDING: "검수 대기", REJECTED: "반려됨", APPROVED: "승인됨",
  PUBLISHED: "발행됨", INVALIDATED: "무효화됨", ON_HOLD: "보류",
};

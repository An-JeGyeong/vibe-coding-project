import type { BlockComment } from "@/lib/translation/comments";
import type { Decision } from "@/lib/translation/decision";
import type { TranslationBlock, TranslationStatus } from "@/lib/translation/types";

export type PendingReview = { episodeId: string; title: string; versionNo: number; sourceVersion: number; submittedAt: string };
export type PendingReviewList = { items: PendingReview[]; total: number };

export type ReviewVersionSummary = {
  versionNo: number; status: TranslationStatus; sourceVersion: number; submittedAt: string | null; decision: Decision | null;
};
export type ReviewVersionList = { latestSourceVersion: number; items: ReviewVersionSummary[] };
export type ReviewDetail = ReviewVersionSummary & { decidable: boolean; blocks: TranslationBlock[]; blockComments: BlockComment[] };
/** What the reviewer sends with a rejection: a remark on one block of the version. */
export type DraftBlockComment = { seq: number; text: string };
export type DecideOutcome = { versionNo: number; status: TranslationStatus; decidedAt: string };

export type OperatorTranslationList = {
  latestSourceVersion: number;
  items: (ReviewVersionSummary & { revision: number; createdAt: string })[];
};
export type OperatorTranslationDetail = {
  versionNo: number; status: TranslationStatus; sourceVersion: number; createdAt: string; submittedAt: string | null;
  decision: Decision | null; invalidatedAt: string | null; blocks: TranslationBlock[]; blockComments: BlockComment[];
};

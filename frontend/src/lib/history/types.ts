// Work history (CONTRACTS 24): the operator's read-only view of the business audit trail.
export const HISTORY_EVENTS = [
  "EPISODE_CREATED", "SOURCE_SAVED", "ASSIGNED", "TRANSLATION_CREATED", "TRANSLATION_SUBMITTED", "REVIEW_APPROVED",
  "REVIEW_REJECTED", "APPROVAL_INVALIDATED", "TRANSLATION_PUBLISHED", "PUBLICATION_HELD", "PUBLICATION_RESUMED",
] as const;

export type Person = { id: string; displayName: string };
export type HistoryItem = {
  id: string; occurredAt: string; event: string; actor: Person; episodeId: string; episodeTitle: string;
  sourceVersion: number | null; translationVersionNo: number | null; subject: Person | null;
};
export type HistoryList = { items: HistoryItem[]; total: number };
export type HistoryQuery = { episodeId?: string; event?: string; limit: number; offset: number };

export const EPISODE_ID_PATTERN = /^[1-9][0-9]{0,17}$/;

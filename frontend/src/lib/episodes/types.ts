import type { ApiFailure } from "@/lib/auth/types";

export type EpisodeFailure =
  | ApiFailure
  | { kind: "not_found" }
  | { kind: "conflict"; latestVersion: number | null }
  | { kind: "revision_conflict"; latestRevision: number | null }
  | { kind: "state_conflict"; currentStatus: string | null }
  | { kind: "incomplete"; missingSeqs: number[] };
export type EpisodeResult<T> = { ok: true; value: T } | { ok: false; failure: EpisodeFailure };

export type SavedBy = { id: string; displayName: string };
export type SourceBlock = { seq: number; pageNo: number | null; text: string };
export type SourceView = { version: number; savedAt: string; savedBy: SavedBy; blocks: SourceBlock[] };
export type EpisodeSummary = { id: string; title: string; latestSourceVersion: number; updatedAt: string };
export type EpisodeList = { items: EpisodeSummary[]; total: number };
export type EpisodeDetail = {
  id: string; title: string; latestSourceVersion: number; createdAt: string; updatedAt: string; source: SourceView | null;
};
export type VersionSummary = { version: number; savedAt: string; savedBy: SavedBy; blockCount: number };
export type SaveOutcome = { version: number; changed: boolean };
/** A block as sent to the server: the array order defines seq, the client never sends seq. */
export type DraftBlock = { pageNo: number | null; text: string };

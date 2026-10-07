import type { TranslationStatus } from "@/lib/translation/types";

export type PublicationEntry = { versionNo: number; sourceVersion: number; publishedAt: string };
export type Publication = { current: PublicationEntry | null; held: PublicationEntry | null; history: PublicationEntry[] };
export type HoldOutcome = { versionNo: number; status: TranslationStatus; heldAt: string };
export type PublishOutcome = { versionNo: number; status: TranslationStatus; publishedAt: string };

// Public (reader) shapes: only translated text, order, page and the publish time ever reach the reader UI.
export type PublicEpisode = { episodeId: string; title: string; publishedAt: string };
export type PublicEpisodeList = { items: PublicEpisode[]; total: number };
export type PublicBlock = { seq: number; pageNo: number | null; text: string };
export type PublicEpisodeView = PublicEpisode & { blocks: PublicBlock[] };

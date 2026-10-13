import { readJson, removeKey, writeJson } from "./storage";

// Recently opened episodes, newest first, one entry per episode (CONTRACTS 30.1). Browser only.
export const RECENT_KEY = "mangabridge.recent.v1";
export const RECENT_MAX = 20;
export type RecentEpisode = {
  episodeId: string; title: string; workId: string | null; workTitle: string | null; episodeNo: number | null; readAt: string;
};

const ID = /^[1-9][0-9]{0,17}$/;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function loadRecent(): RecentEpisode[] {
  const raw = readJson(RECENT_KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: RecentEpisode[] = [];
  for (const item of raw) {
    const entry = item as Partial<RecentEpisode> | null;
    if (!entry || typeof entry.episodeId !== "string" || !ID.test(entry.episodeId) || seen.has(entry.episodeId) || !text(entry.title, 200) || typeof entry.readAt !== "string") continue;
    const workId = typeof entry.workId === "string" && ID.test(entry.workId) ? entry.workId : null;
    const workTitle = workId !== null && text(entry.workTitle, 200) ? entry.workTitle : null;
    const episodeNo = typeof entry.episodeNo === "number" && Number.isInteger(entry.episodeNo) ? entry.episodeNo : null;
    seen.add(entry.episodeId);
    items.push({ episodeId: entry.episodeId, title: entry.title, workId, workTitle, episodeNo, readAt: entry.readAt });
  }
  return items.slice(0, RECENT_MAX);
}

export function recordRecent(entry: Omit<RecentEpisode, "readAt">) {
  if (!ID.test(entry.episodeId) || !text(entry.title, 200)) return;
  const next = [{ ...entry, readAt: new Date().toISOString() }, ...loadRecent().filter((item) => item.episodeId !== entry.episodeId)].slice(0, RECENT_MAX);
  writeJson(RECENT_KEY, next);
}

export function clearRecent() { removeKey(RECENT_KEY); }

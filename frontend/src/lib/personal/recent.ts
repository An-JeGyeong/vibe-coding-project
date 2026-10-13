import { touchRecent } from "@/lib/account/client";
import { readJson, removeKey, writeJson } from "./storage";
import { currentToken, dropToken } from "./stores";

// Recently opened episodes, newest first, one entry per episode (CONTRACTS 30.1). In the browser while nobody is signed in; for a
// signed-in account the server keeps the order (CONTRACTS 32.4) and this module keeps only the titles it needs to show them.
export const RECENT_KEY = "mangabridge.recent.v1";
export const TITLES_KEY = "mangabridge.recent-titles.v1";
export const RECENT_MAX = 20;
export const TITLES_MAX = 100;
export type RecentEpisode = {
  episodeId: string; title: string; workId: string | null; workTitle: string | null; episodeNo: number | null; readAt: string;
};
export type EpisodeTitle = Omit<RecentEpisode, "readAt">;

const ID = /^[1-9][0-9]{0,17}$/;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

function titleOf(entry: Partial<EpisodeTitle> | null): EpisodeTitle | null {
  if (!entry || typeof entry.episodeId !== "string" || !ID.test(entry.episodeId) || !text(entry.title, 200)) return null;
  const workId = typeof entry.workId === "string" && ID.test(entry.workId) ? entry.workId : null;
  const workTitle = workId !== null && text(entry.workTitle, 200) ? entry.workTitle : null;
  const episodeNo = typeof entry.episodeNo === "number" && Number.isInteger(entry.episodeNo) ? entry.episodeNo : null;
  return { episodeId: entry.episodeId, title: entry.title, workId, workTitle, episodeNo };
}

export function loadRecent(): RecentEpisode[] {
  const raw = readJson(RECENT_KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: RecentEpisode[] = [];
  for (const item of raw) {
    const entry = item as Partial<RecentEpisode> | null;
    const title = titleOf(entry);
    if (!title || seen.has(title.episodeId) || typeof entry?.readAt !== "string") continue;
    seen.add(title.episodeId);
    items.push({ ...title, readAt: entry.readAt });
  }
  return items.slice(0, RECENT_MAX);
}

/** The titles seen so far, by episode id (a cache: losing it only means looking a title up again). */
export function loadTitles(): Record<string, EpisodeTitle> {
  const raw = readJson(TITLES_KEY);
  const found: Record<string, EpisodeTitle> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return found;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const title = titleOf(value as Partial<EpisodeTitle> | null);
    if (title) found[title.episodeId] = title;
  }
  return found;
}

export function rememberTitle(title: EpisodeTitle) {
  const known = loadTitles();
  delete known[title.episodeId];
  const kept = Object.values(known).slice(-(TITLES_MAX - 1));
  const next: Record<string, EpisodeTitle> = {};
  for (const item of kept) next[item.episodeId] = item;
  next[title.episodeId] = title;
  writeJson(TITLES_KEY, next);
}

/**
 * Records that an episode was opened. The browser always keeps the entry (it carries the titles); a signed-in account also tells the server.
 * The server call never shows on screen: if it fails the next visit simply records again.
 */
export function recordRecent(entry: Omit<RecentEpisode, "readAt">) {
  if (!ID.test(entry.episodeId) || !text(entry.title, 200)) return;
  const next = [{ ...entry, readAt: new Date().toISOString() }, ...loadRecent().filter((item) => item.episodeId !== entry.episodeId)].slice(0, RECENT_MAX);
  writeJson(RECENT_KEY, next);
  rememberTitle(entry);
  const token = currentToken();
  if (token !== null) void touchRecent(token, entry.episodeId).then((result) => { if (!result.ok && result.failure.kind === "unauthorized") dropToken(); });
}

export function clearRecent() { removeKey(RECENT_KEY); }

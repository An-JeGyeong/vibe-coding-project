"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { clearRecentOnServer, getLibrary, getRecent, getRecommendedWorks, putLibrary } from "@/lib/account/client";
import { getEpisodeWork } from "@/lib/catalog/client";
import { getPublicEpisode } from "@/lib/publication/client";
import { addToLibrary, clearLibrary, loadLibrary, removeFromLibrary, type LibraryEntry } from "./library";
import { clearRecent, loadRecent, loadTitles, rememberTitle, type RecentEpisode } from "./recent";
import { PERSONAL_EVENT } from "./storage";
import { EMPTY_PROFILE, loadProfile } from "./profile";
import { createStore, currentToken, dropToken, notifyPersonalChange, type ServerRead } from "./stores";
import { loadRecommended } from "./voter";
import { loadTheme, saveTheme, type Theme } from "./theme";

/** Re-reads whenever any screen of this tab (or another tab) changes the browser data. Starts empty so the server-rendered page matches. */
function useStored<T>(read: () => T, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const update = () => setValue(read());
    update();
    window.addEventListener(PERSONAL_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(PERSONAL_EVENT, update); window.removeEventListener("storage", update); };
  }, [read]);
  return value;
}

function useShared<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.server);
}

const EMPTY_LIBRARY: LibraryEntry[] = [];
const EMPTY_RECENT: RecentEpisode[] = [];
const EMPTY_IDS: string[] = [];

// ---- library: the browser's while nobody is signed in, the account's (server) after that ----
export const libraryStore = createStore<LibraryEntry[]>(loadLibrary, async (token): Promise<ServerRead<LibraryEntry[]>> => {
  const result = await getLibrary(token);
  if (result.ok) return result.value;
  return result.failure.kind === "unauthorized" ? "unauthorized" : null;
}, EMPTY_LIBRARY);

async function setBookmark(workId: string, on: boolean) {
  const token = currentToken();
  if (token === null) { if (on) addToLibrary(workId); else removeFromLibrary(workId); return; }
  const result = await putLibrary(token, workId, on);
  if (!result.ok && result.failure.kind === "unauthorized") { dropToken(); return; }
  notifyPersonalChange();      // the shared store asks the server again
}

export function useLibrary() {
  const entries = useShared(libraryStore);
  const toggle = useCallback((workId: string) => {
    const present = libraryStore.get().some((entry) => entry.workId === workId);
    return setBookmark(workId, !present);
  }, []);
  const remove = useCallback((workId: string) => setBookmark(workId, false), []);
  return { entries, has: (workId: string) => entries.some((entry) => entry.workId === workId), toggle, remove };
}

// ---- recent episodes ----
async function titleFor(episodeId: string): Promise<RecentEpisode | null> {
  const known = loadTitles()[episodeId];
  if (known) return { ...known, readAt: "" };
  const [episode, work] = await Promise.all([getPublicEpisode(episodeId), getEpisodeWork(episodeId)]);
  if (!episode.ok) return null;                                    // gone or not public any more: not shown
  const title = { episodeId, title: episode.value.title, workId: work.ok ? work.value.workId : null, workTitle: work.ok ? work.value.title : null, episodeNo: work.ok ? work.value.episodeNo : null };
  rememberTitle(title);
  return { ...title, readAt: "" };
}

export const recentStore = createStore<RecentEpisode[]>(loadRecent, async (token): Promise<ServerRead<RecentEpisode[]>> => {
  const result = await getRecent(token);
  if (!result.ok) return result.failure.kind === "unauthorized" ? "unauthorized" : null;
  const shown: RecentEpisode[] = [];
  for (const item of await Promise.all(result.value.map(async (entry) => { const found = await titleFor(entry.episodeId); return found && { ...found, readAt: entry.readAt }; })))
    if (item) shown.push(item);
  return shown;
}, EMPTY_RECENT);

export function useRecent() {
  return useShared(recentStore);
}

/** "Clear my record" of the recent episodes: the account's list on the server when signed in, the browser's otherwise. */
export async function clearRecentEpisodes() {
  const token = currentToken();
  if (token === null) { clearRecent(); return; }
  const result = await clearRecentOnServer(token);
  if (!result.ok && result.failure.kind === "unauthorized") dropToken();
  clearRecent();
  notifyPersonalChange();
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useStored(loadTheme, "light" as Theme);
  return [theme, saveTheme];
}

// ---- recommendations ----
export const recommendedStore = createStore<string[]>(loadRecommended, async (token): Promise<ServerRead<string[]>> => {
  const result = await getRecommendedWorks(token);
  if (result.ok) return result.value;
  return result.failure.kind === "unauthorized" ? "unauthorized" : null;
}, EMPTY_IDS);

/** The works this reader recommended: the account's when signed in, this browser's otherwise (CONTRACTS 31.6, 32.7). */
export function useRecommended() {
  const ids = useShared(recommendedStore);
  return { has: (workId: string) => ids.includes(workId) };
}

/** The browser-only profile (D-063). */
export function useProfile() {
  return useStored(loadProfile, EMPTY_PROFILE);
}

/** "Clear my record" of the library: every work of the account on the server when signed in, the browser's list otherwise. */
export async function clearLibraryEntries() {
  const token = currentToken();
  if (token === null) { clearLibrary(); return; }
  for (const entry of libraryStore.get()) {
    const result = await putLibrary(token, entry.workId, false);
    if (!result.ok && result.failure.kind === "unauthorized") { dropToken(); break; }
  }
  clearLibrary();
  notifyPersonalChange();
}

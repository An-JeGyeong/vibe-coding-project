"use client";

import { useCallback, useEffect, useState } from "react";
import { addToLibrary, loadLibrary, removeFromLibrary, type LibraryEntry } from "./library";
import { loadRecent, type RecentEpisode } from "./recent";
import { PERSONAL_EVENT } from "./storage";
import { EMPTY_PROFILE, loadProfile } from "./profile";
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

const EMPTY_LIBRARY: LibraryEntry[] = [];
const EMPTY_RECENT: RecentEpisode[] = [];

export function useLibrary() {
  const entries = useStored(loadLibrary, EMPTY_LIBRARY);
  const toggle = useCallback((workId: string) => {
    if (loadLibrary().some((entry) => entry.workId === workId)) removeFromLibrary(workId); else addToLibrary(workId);
  }, []);
  return { entries, has: (workId: string) => entries.some((entry) => entry.workId === workId), toggle, remove: removeFromLibrary };
}

export function useRecent() {
  return useStored(loadRecent, EMPTY_RECENT);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useStored(loadTheme, "light" as Theme);
  return [theme, saveTheme];
}

const EMPTY_IDS: string[] = [];
/** The works this browser recommended (CONTRACTS 31.6). */
export function useRecommended() {
  const ids = useStored(loadRecommended, EMPTY_IDS);
  return { has: (workId: string) => ids.includes(workId) };
}

/** The browser-only profile (D-063). */
export function useProfile() {
  return useStored(loadProfile, EMPTY_PROFILE);
}

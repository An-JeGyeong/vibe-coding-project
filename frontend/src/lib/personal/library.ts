import { readJson, removeKey, writeJson } from "./storage";

// "My library": works the reader bookmarked, newest first (CONTRACTS 30.1). Browser only.
export const LIBRARY_KEY = "mangabridge.library.v1";
export const LIBRARY_MAX = 200;
export type LibraryEntry = { workId: string; addedAt: string };

const ID = /^[1-9][0-9]{0,17}$/;

export function loadLibrary(): LibraryEntry[] {
  const raw = readJson(LIBRARY_KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const item of raw) {
    const entry = item as Partial<LibraryEntry> | null;
    if (!entry || typeof entry.workId !== "string" || !ID.test(entry.workId) || typeof entry.addedAt !== "string" || seen.has(entry.workId)) continue;
    seen.add(entry.workId);
    entries.push({ workId: entry.workId, addedAt: entry.addedAt });
  }
  return entries.slice(0, LIBRARY_MAX);
}

export function isBookmarked(workId: string): boolean {
  return loadLibrary().some((entry) => entry.workId === workId);
}

export function addToLibrary(workId: string): LibraryEntry[] {
  if (!ID.test(workId)) return loadLibrary();
  const next = [{ workId, addedAt: new Date().toISOString() }, ...loadLibrary().filter((entry) => entry.workId !== workId)].slice(0, LIBRARY_MAX);
  writeJson(LIBRARY_KEY, next);
  return next;
}

export function removeFromLibrary(workId: string): LibraryEntry[] {
  const next = loadLibrary().filter((entry) => entry.workId !== workId);
  writeJson(LIBRARY_KEY, next);
  return next;
}

export function clearLibrary() { removeKey(LIBRARY_KEY); }

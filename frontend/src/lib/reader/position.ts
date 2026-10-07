// "Where I stopped reading" (CONTRACTS 23.3). A per-browser convenience in localStorage: episode id -> {seq, publishedAt}.
// Nothing else is stored (no account, token or text) and every failure (blocked storage, bad JSON) is silently ignored.
export const POSITION_KEY = "mangabridge.reader.position.v1";
export type ReadPosition = { seq: number; publishedAt: string };
type Stored = Record<string, ReadPosition>;

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const clean: Stored = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<ReadPosition> | null;
      if (entry && Number.isInteger(entry.seq) && typeof entry.publishedAt === "string") clean[id] = { seq: entry.seq as number, publishedAt: entry.publishedAt };
    }
    return clean;
  } catch { return {}; }
}

function writeAll(value: Stored) {
  try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(value)); } catch { /* storage unavailable: reading still works */ }
}

/** The saved position, only if it belongs to the publication the reader is looking at now (a replaced publication discards it). */
export function loadPosition(episodeId: string, publishedAt: string): ReadPosition | null {
  const all = readAll();
  const found = all[episodeId];
  if (!found) return null;
  if (found.publishedAt !== publishedAt) {
    delete all[episodeId];
    writeAll(all);
    return null;
  }
  return found;
}

export function savePosition(episodeId: string, seq: number, publishedAt: string) {
  const all = readAll();
  all[episodeId] = { seq, publishedAt };
  writeAll(all);
}

/** For the list: whether a saved position still matches the current publication time. */
export function hasPosition(episodeId: string, publishedAt: string): boolean {
  const found = readAll()[episodeId];
  return !!found && found.publishedAt === publishedAt;
}

import type { Direction, ViewMode } from "./navigation";

// Per-browser conveniences in localStorage (CONTRACTS 27.4). Every failure (blocked storage, bad JSON) is silently ignored.
export const SETTINGS_KEY = "mangabridge.viewer.settings.v1";
export const POSITION_KEY = "mangabridge.viewer.position.v1";

export type ViewerSettings = { mode: ViewMode; spread: boolean; direction: Direction };
export const DEFAULT_SETTINGS: ViewerSettings = { mode: "page", spread: false, direction: "rtl" };

/** `fallbackDirection` is the work's reading direction: it only applies while the reader has not chosen one (CONTRACTS 28.6). */
export function loadSettings(fallbackDirection: Direction = DEFAULT_SETTINGS.direction): ViewerSettings {
  const defaults: ViewerSettings = { ...DEFAULT_SETTINGS, direction: fallbackDirection };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const value = parsed as Record<string, unknown>;
    return {
      mode: value.mode === "scroll" || value.mode === "page" ? value.mode : defaults.mode,
      spread: typeof value.spread === "boolean" ? value.spread : defaults.spread,
      direction: value.direction === "ltr" || value.direction === "rtl" ? value.direction : defaults.direction,
    };
  } catch { return defaults; }
}

export function saveSettings(settings: ViewerSettings) {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable: the viewer still works */ }
}

type StoredPosition = { pageNo: number; publishedAt: string };
function readPositions(): Record<string, StoredPosition> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(POSITION_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const clean: Record<string, StoredPosition> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const item = entry as Partial<StoredPosition> | null;
      if (item && Number.isInteger(item.pageNo) && typeof item.publishedAt === "string") clean[id] = { pageNo: item.pageNo as number, publishedAt: item.publishedAt };
    }
    return clean;
  } catch { return {}; }
}
function writePositions(value: Record<string, StoredPosition>) {
  try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(value)); } catch { /* ignored */ }
}

/** The saved page, only if it belongs to the publication shown now (a replaced publication discards it). */
export function loadViewerPosition(episodeId: string, publishedAt: string): number | null {
  const all = readPositions();
  const found = all[episodeId];
  if (!found) return null;
  if (found.publishedAt !== publishedAt) { delete all[episodeId]; writePositions(all); return null; }
  return found.pageNo;
}

export function saveViewerPosition(episodeId: string, pageNo: number, publishedAt: string) {
  const all = readPositions();
  all[episodeId] = { pageNo, publishedAt };
  writePositions(all);
}

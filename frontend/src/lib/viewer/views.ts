// A view is counted once per browser session and episode (CONTRACTS 28.6). The server does not de-duplicate, so this guard is the only one.
export const COUNTED_KEY = "mangabridge.viewer.counted.v1";
const MAX_REMEMBERED = 500;

/** True when this episode has not been counted in this session yet (and remembers it). Blocked storage: always true. */
export function shouldCountView(episodeId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(COUNTED_KEY) ?? "[]");
    const seen = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    if (seen.includes(episodeId)) return false;
    window.sessionStorage.setItem(COUNTED_KEY, JSON.stringify([...seen, episodeId].slice(-MAX_REMEMBERED)));
    return true;
  } catch { return true; }
}

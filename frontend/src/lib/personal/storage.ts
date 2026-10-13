// The reader's own data lives in this browser only (CONTRACTS 30.1): no account, no server. Every read and write ignores failures,
// so blocked storage or a corrupted value never breaks a screen; it only means nothing is remembered.
export const PERSONAL_EVENT = "mangabridge:personal";

export function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}

export function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event(PERSONAL_EVENT)); } catch { /* no window */ }
}

export function removeKey(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event(PERSONAL_EVENT)); } catch { /* no window */ }
}

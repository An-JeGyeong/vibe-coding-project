// The bearer token lives only in sessionStorage (approved contract). If the storage is unavailable
// this module reports the failure; it never falls back to localStorage, cookies or other stores.
export const TOKEN_STORAGE_KEY = "mangabridge.demoAuth.accessToken";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export type TokenRead = { ok: true; token: string | null } | { ok: false };

export function readToken(): TokenRead {
  try {
    const value = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (value === null || value === "") return { ok: true, token: null };
    if (!TOKEN_PATTERN.test(value)) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return { ok: true, token: null };
    }
    return { ok: true, token: value };
  } catch {
    return { ok: false };
  }
}

export function writeToken(token: string): boolean {
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) === token;
  } catch {
    return false;
  }
}

export function clearToken(): boolean {
  try {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

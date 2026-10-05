import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { TOKEN_STORAGE_KEY } from "@/lib/auth/storage";
import type { AuthUser, Role } from "@/lib/auth/types";

// Opaque test token (43 characters of base64url). Not a real credential.
export const TOKEN = "dGVzdC1vcGFxdWUtdG9rZW4tbm90LWEtcmVhbC1vbmU";
export const NEW_TOKEN = "bmV3LXRlc3Qtb3BhcXVlLXRva2VuLW5vdC1yZWFsLTE";

export const USERS: Record<Role, AuthUser> = {
  OPERATOR: { id: "1", displayName: "데모 운영자", role: "OPERATOR" },
  TRANSLATOR: { id: "2", displayName: "데모 번역가", role: "TRANSLATOR" },
  REVIEWER: { id: "3", displayName: "데모 감수자", role: "REVIEWER" },
  READER: { id: "4", displayName: "데모 독자", role: "READER" },
};

export const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export const noContent = () => new Response(null, { status: 204 });
export const meBody = (role: Role = "OPERATOR", ttlMs = 3_600_000) => ({ user: USERS[role], expiresAt: inFuture(ttlMs) });
export const loginBody = (role: Role = "OPERATOR", token = NEW_TOKEN, ttlMs = 3_600_000) =>
  ({ user: USERS[role], accessToken: token, tokenType: "Bearer", expiresAt: inFuture(ttlMs) });
export const errorBody = (code: string) => ({ error: { code, message: "fixed" } });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export type FetchCall = { url: string; path: string; method: string; headers: Record<string, string>; body: string | undefined; init: RequestInit };

export function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      path: new URL(String(url)).pathname,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? init.body : undefined,
      init: init ?? {},
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export const storeToken = (token = TOKEN) => window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
export const storedToken = () => window.sessionStorage.getItem(TOKEN_STORAGE_KEY);

export function renderWithAuth(ui: ReactElement) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

export function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

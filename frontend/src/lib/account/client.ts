import { errorCode, failureForStatus, isRecord, parseJson, send } from "@/lib/auth/client";
import { TOKEN_PATTERN } from "@/lib/auth/storage";
import type { ApiFailure, Role } from "@/lib/auth/types";

// Sign-up and the account's own data (CONTRACTS 32). Every call carries the bearer token except the sign-up itself.
export type AccountFailure =
  | ApiFailure
  | { kind: "not_found" }
  | { kind: "taken" }                  // 409 LOGIN_ID_TAKEN
  | { kind: "wrong_current_password" } // 400 INVALID_CURRENT_PASSWORD
  | { kind: "invalid_response" };
export type AccountResult<T> = { ok: true; value: T } | { ok: false; failure: AccountFailure };

const ROLES: readonly string[] = ["OPERATOR", "TRANSLATOR", "REVIEWER", "TYPESETTER", "READER"];
const id = (value: string) => encodeURIComponent(value);
const bad = <T>(): AccountResult<T> => ({ ok: false, failure: { kind: "invalid_response" } });
const fail = <T>(failure: AccountFailure): AccountResult<T> => ({ ok: false, failure });

type Raw = { ok: true; json: unknown } | { ok: false; failure: AccountFailure };

async function call(method: string, path: string, token: string | null, body?: unknown, signal?: AbortSignal): Promise<Raw> {
  const sent = await send(path, { method, token: token ?? undefined, body, signal });
  if (sent.kind === "failure") return { ok: false, failure: sent.failure };
  if (sent.status === 200 || sent.status === 201) return { ok: true, json: parseJson(sent.text) };
  if (sent.status === 204) return { ok: true, json: null };
  const code = errorCode(parseJson(sent.text));
  if (sent.status === 404) return { ok: false, failure: { kind: "not_found" } };
  if (sent.status === 409 && code === "LOGIN_ID_TAKEN") return { ok: false, failure: { kind: "taken" } };
  if (sent.status === 400 && code === "INVALID_CURRENT_PASSWORD") return { ok: false, failure: { kind: "wrong_current_password" } };
  return { ok: false, failure: failureForStatus(sent) };
}

export type Session = { user: { id: string; displayName: string; role: Role }; accessToken: string; expiresAt: string };

export async function registerAccount(loginId: string, password: string, displayName: string, signal?: AbortSignal): Promise<AccountResult<Session>> {
  const raw = await call("POST", "/api/auth/register", null, { loginId, password, displayName }, signal);
  if (!raw.ok) return fail(raw.failure);
  const body = raw.json;
  const user = isRecord(body) && isRecord(body.user) ? body.user : null;
  if (!isRecord(body) || !user || typeof user.id !== "string" || typeof user.displayName !== "string" || typeof user.role !== "string" || !ROLES.includes(user.role)
    || body.tokenType !== "Bearer" || typeof body.accessToken !== "string" || !TOKEN_PATTERN.test(body.accessToken) || typeof body.expiresAt !== "string") return bad();
  return { ok: true, value: { user: { id: user.id, displayName: user.displayName, role: user.role as Role }, accessToken: body.accessToken, expiresAt: body.expiresAt } };
}

export type ServerProfile = { loginId: string; displayName: string; bio: string; role: string };

export async function getProfile(token: string, signal?: AbortSignal): Promise<AccountResult<ServerProfile>> {
  const raw = await call("GET", "/api/me/profile", token, undefined, signal);
  if (!raw.ok) return fail(raw.failure);
  const b = raw.json;
  if (!isRecord(b) || typeof b.loginId !== "string" || typeof b.displayName !== "string" || typeof b.bio !== "string" || typeof b.role !== "string") return bad();
  return { ok: true, value: { loginId: b.loginId, displayName: b.displayName, bio: b.bio, role: b.role } };
}

export async function saveProfile(token: string, displayName: string, bio: string, signal?: AbortSignal): Promise<AccountResult<{ displayName: string; bio: string }>> {
  const raw = await call("PATCH", "/api/me/profile", token, { displayName, bio }, signal);
  if (!raw.ok) return fail(raw.failure);
  const b = raw.json;
  if (!isRecord(b) || typeof b.displayName !== "string" || typeof b.bio !== "string") return bad();
  return { ok: true, value: { displayName: b.displayName, bio: b.bio } };
}

export async function changePassword(token: string, currentPassword: string, newPassword: string, signal?: AbortSignal): Promise<AccountResult<null>> {
  const raw = await call("POST", "/api/me/password", token, { currentPassword, newPassword }, signal);
  return raw.ok ? { ok: true, value: null } : fail(raw.failure);
}

// ---- library, recent episodes, recommendations ----
const stringIds = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;

export type ServerLibraryItem = { workId: string; addedAt: string };
function libraryItems(json: unknown): ServerLibraryItem[] | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const items: ServerLibraryItem[] = [];
  for (const item of json.items) {
    if (!isRecord(item) || typeof item.workId !== "string" || typeof item.addedAt !== "string") return null;
    items.push({ workId: item.workId, addedAt: item.addedAt });
  }
  return items;
}
export async function getLibrary(token: string, signal?: AbortSignal): Promise<AccountResult<ServerLibraryItem[]>> {
  const raw = await call("GET", "/api/me/library", token, undefined, signal);
  if (!raw.ok) return fail(raw.failure);
  const items = libraryItems(raw.json);
  return items ? { ok: true, value: items } : bad();
}
export async function putLibrary(token: string, workId: string, on: boolean): Promise<AccountResult<null>> {
  const raw = await call(on ? "PUT" : "DELETE", `/api/me/library/${id(workId)}`, token);
  return raw.ok ? { ok: true, value: null } : fail(raw.failure);
}
export async function mergeLibrary(token: string, workIds: string[]): Promise<AccountResult<ServerLibraryItem[]>> {
  const raw = await call("POST", "/api/me/library/merge", token, { workIds });
  if (!raw.ok) return fail(raw.failure);
  const items = libraryItems(raw.json);
  return items ? { ok: true, value: items } : bad();
}

export type ServerRecentItem = { episodeId: string; readAt: string };
function recentItems(json: unknown): ServerRecentItem[] | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const items: ServerRecentItem[] = [];
  for (const item of json.items) {
    if (!isRecord(item) || typeof item.episodeId !== "string" || typeof item.readAt !== "string") return null;
    items.push({ episodeId: item.episodeId, readAt: item.readAt });
  }
  return items;
}
export async function getRecent(token: string, signal?: AbortSignal): Promise<AccountResult<ServerRecentItem[]>> {
  const raw = await call("GET", "/api/me/recent", token, undefined, signal);
  if (!raw.ok) return fail(raw.failure);
  const items = recentItems(raw.json);
  return items ? { ok: true, value: items } : bad();
}
export async function touchRecent(token: string, episodeId: string): Promise<AccountResult<null>> {
  const raw = await call("PUT", `/api/me/recent/${id(episodeId)}`, token);
  return raw.ok ? { ok: true, value: null } : fail(raw.failure);
}
export async function clearRecentOnServer(token: string): Promise<AccountResult<null>> {
  const raw = await call("DELETE", "/api/me/recent", token);
  return raw.ok ? { ok: true, value: null } : fail(raw.failure);
}
export async function mergeRecent(token: string, items: ServerRecentItem[]): Promise<AccountResult<ServerRecentItem[]>> {
  const raw = await call("POST", "/api/me/recent/merge", token, { items });
  if (!raw.ok) return fail(raw.failure);
  const merged = recentItems(raw.json);
  return merged ? { ok: true, value: merged } : bad();
}

export async function getRecommendedWorks(token: string, signal?: AbortSignal): Promise<AccountResult<string[]>> {
  const raw = await call("GET", "/api/me/recommendations", token, undefined, signal);
  if (!raw.ok) return fail(raw.failure);
  const ids = isRecord(raw.json) ? stringIds(raw.json.workIds) : null;
  return ids ? { ok: true, value: ids } : bad();
}
/** The account's own vote (CONTRACTS 32.5); the answer carries the new total. */
export async function setAccountRecommendation(token: string, workId: string, on: boolean, signal?: AbortSignal): Promise<AccountResult<{ recommended: boolean; recommendCount: number }>> {
  const raw = await call("POST", `/api/me/works/${id(workId)}/${on ? "recommend" : "unrecommend"}`, token, undefined, signal);
  if (!raw.ok) return fail(raw.failure);
  const b = raw.json;
  if (!isRecord(b) || typeof b.recommended !== "boolean" || typeof b.recommendCount !== "number" || !Number.isInteger(b.recommendCount) || b.recommendCount < 0) return bad();
  return { ok: true, value: { recommended: b.recommended, recommendCount: b.recommendCount } };
}

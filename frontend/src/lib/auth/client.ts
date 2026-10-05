import { ROLES, type ApiFailure, type ApiResult, type AuthUser, type LoginSuccess, type MeSuccess } from "./types";
import { TOKEN_PATTERN } from "./storage";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 86_400;

type Sent = { kind: "response"; status: number; retryAfter: string | null; text: string } | { kind: "failure"; failure: ApiFailure };

// Credentials are never sent as cookies (credentials: "omit"); the bearer token is the only credential.
async function send(path: string, init: { method: string; token?: string; body?: unknown; signal?: AbortSignal }): Promise<Sent> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) return { kind: "failure", failure: { kind: "misconfigured" } };
  if (init.signal?.aborted) return { kind: "failure", failure: { kind: "aborted" } };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  init.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const text = await response.text();
    return { kind: "response", status: response.status, retryAfter: response.headers.get("Retry-After"), text };
  } catch {
    if (init.signal?.aborted) return { kind: "failure", failure: { kind: "aborted" } };
    return { kind: "failure", failure: { kind: timedOut ? "timeout" : "network" } };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()), MAX_RETRY_AFTER_SECONDS);
}

function failureForStatus(sent: Extract<Sent, { kind: "response" }>): ApiFailure {
  const code = errorCode(parseJson(sent.text));
  switch (sent.status) {
    case 400: return { kind: "invalid_request" };
    case 401: return { kind: "unauthorized", code: code === "INVALID_CREDENTIALS" || code === "AUTH_REQUIRED" ? code : "UNKNOWN" };
    case 403: return { kind: "forbidden" };
    case 429: return { kind: "rate_limited", retryAfterSeconds: parseRetryAfter(sent.retryAfter) };
    case 503: return { kind: "unavailable" };
    default: return { kind: "server_error" };
  }
}

function parseExpiresAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function parseUser(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null;
  const { id, displayName, role } = value;
  if (typeof id !== "string" || id === "" || typeof displayName !== "string") return null;
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return null;
  return { id, displayName, role: role as AuthUser["role"] };
}

const INVALID_RESPONSE: ApiFailure = { kind: "invalid_response" };

export async function requestLogin(loginId: string, password: string, signal?: AbortSignal): Promise<ApiResult<LoginSuccess>> {
  const sent = await send("/api/auth/login", { method: "POST", body: { loginId, password }, signal });
  if (sent.kind === "failure") return { ok: false, failure: sent.failure };
  if (sent.status !== 200) {
    const failure = failureForStatus(sent);
    // On login every 401 means "wrong credentials"; the server uses one response for all causes.
    return { ok: false, failure: failure.kind === "unauthorized" ? { kind: "unauthorized", code: "INVALID_CREDENTIALS" } : failure };
  }
  const body = parseJson(sent.text);
  const user = isRecord(body) ? parseUser(body.user) : null;
  const expiresAt = isRecord(body) ? parseExpiresAt(body.expiresAt) : null;
  const token = isRecord(body) ? body.accessToken : null;
  if (!user || !expiresAt || !isRecord(body) || body.tokenType !== "Bearer" || typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return { ok: false, failure: INVALID_RESPONSE };
  }
  return { ok: true, value: { user, accessToken: token, expiresAt } };
}

export async function requestMe(token: string, signal?: AbortSignal): Promise<ApiResult<MeSuccess>> {
  const sent = await send("/api/auth/me", { method: "GET", token, signal });
  if (sent.kind === "failure") return { ok: false, failure: sent.failure };
  if (sent.status !== 200) return { ok: false, failure: failureForStatus(sent) };
  const body = parseJson(sent.text);
  const user = isRecord(body) ? parseUser(body.user) : null;
  const expiresAt = isRecord(body) ? parseExpiresAt(body.expiresAt) : null;
  if (!user || !expiresAt) return { ok: false, failure: INVALID_RESPONSE };
  return { ok: true, value: { user, expiresAt } };
}

export async function requestLogout(token: string, signal?: AbortSignal): Promise<ApiResult<null>> {
  const sent = await send("/api/auth/logout", { method: "POST", token, signal });
  if (sent.kind === "failure") return { ok: false, failure: sent.failure };
  if (sent.status === 204) return { ok: true, value: null };
  return { ok: false, failure: sent.status === 200 ? INVALID_RESPONSE : failureForStatus(sent) };
}

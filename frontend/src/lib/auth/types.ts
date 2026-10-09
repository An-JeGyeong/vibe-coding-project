export const ROLES = ["OPERATOR", "TRANSLATOR", "REVIEWER", "TYPESETTER", "READER"] as const;
export type Role = (typeof ROLES)[number];

export type AuthUser = { id: string; displayName: string; role: Role };

export type ApiFailure =
  | { kind: "invalid_request" }
  | { kind: "unauthorized"; code: "INVALID_CREDENTIALS" | "AUTH_REQUIRED" | "UNKNOWN" }
  | { kind: "forbidden" }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable" }
  | { kind: "server_error" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "invalid_response" }
  | { kind: "misconfigured" }
  | { kind: "aborted" };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export type LoginSuccess = { user: AuthUser; accessToken: string; expiresAt: string };
export type MeSuccess = { user: AuthUser; expiresAt: string };

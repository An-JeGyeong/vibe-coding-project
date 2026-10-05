"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { requestLogin, requestLogout, requestMe } from "./client";
import type { AuthNotice } from "./messages";
import { clearToken, readToken, writeToken } from "./storage";
import type { ApiFailure, AuthUser } from "./types";

export type AuthStatus = "initializing" | "authenticated" | "unauthenticated" | "check_failed";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  /** Epoch milliseconds of the server-issued expiry. The server's own check remains authoritative. */
  expiresAt: number | null;
  notice: AuthNotice | null;
  /** Why the stored token could not be verified (status "check_failed"); the token is kept for a retry. */
  failure: ApiFailure | null;
  loggingOut: boolean;
};

export type LoginOutcome = { ok: true } | { ok: false; failure: ApiFailure | { kind: "storage" } };

export type AuthContextValue = AuthState & {
  login(loginId: string, password: string): Promise<LoginOutcome>;
  logout(): Promise<void>;
  /** Re-verify the stored token after a transient failure; never signs the user out by itself. */
  retry(): void;
  /** For protected API calls that receive 401: clears the token, user and protected state. */
  handleUnauthorized(): void;
};

const MAX_TIMER_MS = 2_147_483_647;
const INITIAL: AuthState = { status: "initializing", user: null, expiresAt: null, notice: null, failure: null, loggingOut: false };
const SIGNED_OUT: AuthState = { ...INITIAL, status: "unauthenticated" };

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL);
  const stateRef = useRef(state);
  // The identity of the latest /me request. Responses of any other (older or cancelled) request are ignored,
  // so a late /me response can never restore a state that logout, login or expiry has already replaced.
  const verifyRef = useRef<AbortController | null>(null);
  const actionRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);

  const cancelVerify = useCallback(() => {
    verifyRef.current?.abort();
    verifyRef.current = null;
  }, []);

  const signOutLocally = useCallback((notice: AuthNotice | null) => {
    cancelVerify();
    const cleared = clearToken();
    setState({ ...SIGNED_OUT, notice: cleared ? notice : "storage_error" });
  }, [cancelVerify]);

  const verify = useCallback(async (mode: "initial" | "silent") => {
    if (actionRef.current) return;
    const read = readToken();
    if (!read.ok) { cancelVerify(); setState({ ...SIGNED_OUT, notice: "storage_error" }); return; }
    if (read.token === null) { signOutLocally(null); return; }

    cancelVerify();
    const request = new AbortController();
    verifyRef.current = request;
    const result = await requestMe(read.token, request.signal);
    if (verifyRef.current !== request) return;
    verifyRef.current = null;

    if (result.ok) {
      setState({ ...INITIAL, status: "authenticated", user: result.value.user, expiresAt: Date.parse(result.value.expiresAt) });
      return;
    }
    const { failure } = result;
    if (failure.kind === "aborted") return;
    if (failure.kind === "unauthorized") { signOutLocally("unauthorized"); return; }
    // 503, timeouts and network errors are not proof that the token is invalid: keep it and offer a retry.
    if (mode === "initial") setState({ ...INITIAL, status: "check_failed", failure });
  }, [cancelVerify, signOutLocally]);

  const login = useCallback(async (loginId: string, password: string): Promise<LoginOutcome> => {
    if (actionRef.current) return { ok: false, failure: { kind: "aborted" } };
    actionRef.current = true;
    cancelVerify();
    setState((previous) => ({ ...previous, notice: null }));
    try {
      const result = await requestLogin(loginId, password);
      if (!result.ok) return result;
      const { accessToken, user, expiresAt } = result.value;
      if (!writeToken(accessToken)) {
        // No alternative store is used. Revoke the token the server just issued, best effort, and fail the login.
        void requestLogout(accessToken);
        return { ok: false, failure: { kind: "storage" } };
      }
      setState({ ...INITIAL, status: "authenticated", user, expiresAt: Date.parse(expiresAt) });
      return { ok: true };
    } finally {
      actionRef.current = false;
    }
  }, [cancelVerify]);

  const logout = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    cancelVerify();
    setState((previous) => ({ ...previous, loggingOut: true }));
    try {
      const read = readToken();
      const confirmed = read.ok && read.token !== null ? (await requestLogout(read.token)).ok : read.ok;
      const cleared = clearToken();
      setState({ ...SIGNED_OUT, notice: !confirmed ? "logout_unconfirmed" : cleared ? "logged_out" : "storage_error" });
    } finally {
      actionRef.current = false;
    }
  }, [cancelVerify]);

  const retry = useCallback(() => {
    setState((previous) => ({ ...previous, status: "initializing", failure: null }));
    void verify("initial");
  }, [verify]);

  const handleUnauthorized = useCallback(() => signOutLocally("unauthorized"), [signOutLocally]);

  useEffect(() => {
    void verify("initial");
    return cancelVerify;
  }, [verify, cancelVerify]);

  // Local cleanup when the server-issued expiry is reached. The timer is re-armed for very long delays
  // and re-checked against the clock when it fires; there is no polling.
  useEffect(() => {
    if (state.status !== "authenticated" || state.expiresAt === null) return;
    const expiresAt = state.expiresAt;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) signOutLocally("expired");
      else timer = setTimeout(check, Math.min(remaining, MAX_TIMER_MS));
    };
    check();
    return () => clearTimeout(timer);
  }, [state.status, state.expiresAt, signOutLocally]);

  // When the tab becomes visible again re-check the expiry locally and ask the server, which has the last word.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const current = stateRef.current;
      if (current.status !== "authenticated" || current.expiresAt === null) return;
      if (Date.now() >= current.expiresAt) signOutLocally("expired");
      else void verify("silent");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [signOutLocally, verify]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, retry, handleUnauthorized }),
    [state, login, logout, retry, handleUnauthorized],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

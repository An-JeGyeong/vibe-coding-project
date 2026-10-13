"use client";

import { useCallback, useEffect, useState } from "react";
import { requestLogout, requestMe } from "./client";
import { clearToken, readToken } from "./storage";
import type { AuthUser } from "./types";

export const AUTH_EVENT = "mangabridge:auth";
export type Account = { state: "checking" } | { state: "none" } | { state: "user"; user: AuthUser } | { state: "unreachable" };

/**
 * The sign-in state for screens that are not inside the signed-in app (the public header and the my page; CONTRACTS 30.2, D-063).
 * The server is asked only when a token exists; a rejected token is dropped; every user of this hook in the tab follows a logout.
 */
export function useAccount() {
  const [account, setAccount] = useState<Account>({ state: "checking" });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let request: AbortController | null = null;
    const check = () => {
      request?.abort();
      const stored = readToken();
      if (!stored.ok || stored.token === null) { setAccount({ state: "none" }); return; }
      const mine = new AbortController();
      request = mine;
      void requestMe(stored.token, mine.signal).then((result) => {
        if (mine.signal.aborted) return;
        if (result.ok) { setAccount({ state: "user", user: result.value.user }); return; }
        if (result.failure.kind === "unauthorized") { clearToken(); setAccount({ state: "none" }); return; }
        setAccount({ state: "unreachable" });
      });
    };
    check();
    window.addEventListener(AUTH_EVENT, check);
    return () => { request?.abort(); window.removeEventListener(AUTH_EVENT, check); };
  }, []);

  const logout = useCallback(async () => {
    const stored = readToken();
    setLeaving(true);
    if (stored.ok && stored.token !== null) await requestLogout(stored.token);
    clearToken();
    setLeaving(false);
    try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* no window */ }
  }, []);

  return { account, leaving, logout };
}

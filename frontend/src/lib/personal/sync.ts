"use client";

import { mergeLibrary, mergeRecent, setAccountRecommendation } from "@/lib/account/client";
import { loadLibrary } from "./library";
import { loadRecent } from "./recent";
import { readJson, writeJson } from "./storage";
import { notifyPersonalChange } from "./stores";
import { setRecommendation } from "@/lib/ranking/client";
import { getVoterKey, loadRecommended, setRecommended } from "./voter";

// After the first sign-in (or sign-up) of an account in this browser, what the browser kept is merged into the account once (CONTRACTS 32.7).
export const SYNCED_KEY = "mangabridge.synced.v1";
const SYNCED_MAX = 50;

const running = new Map<string, Promise<void>>();

function alreadySynced(accountId: string): boolean {
  const raw = readJson(SYNCED_KEY);
  return Array.isArray(raw) && raw.includes(accountId);
}
function markSynced(accountId: string) {
  const raw = readJson(SYNCED_KEY);
  const list = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item !== accountId) : [];
  writeJson(SYNCED_KEY, [accountId, ...list].slice(0, SYNCED_MAX));
}

const reachable = (kind: string) => kind !== "network" && kind !== "timeout" && kind !== "unavailable" && kind !== "server_error" && kind !== "rate_limited" && kind !== "aborted";

/**
 * Merges the browser's library, recent episodes and recommendations into the account, once per account and browser. The browser's own
 * data stays where it is. A server that cannot be reached leaves the account unmarked, so the merge is tried again on the next visit.
 */
export function syncAfterSignIn(token: string, accountId: string): Promise<void> {
  if (alreadySynced(accountId)) return Promise.resolve();
  const active = running.get(accountId);
  if (active) return active;
  const job = (async () => {
    let complete = true;
    const library = loadLibrary().map((entry) => entry.workId);
    if (library.length > 0) {
      const result = await mergeLibrary(token, library);
      if (!result.ok && reachable(result.failure.kind) === false) complete = false;
      if (!result.ok && result.failure.kind === "unauthorized") return;
    }
    const recent = loadRecent().map((item) => ({ episodeId: item.episodeId, readAt: item.readAt }));
    if (recent.length > 0) {
      const result = await mergeRecent(token, recent);
      if (!result.ok && reachable(result.failure.kind) === false) complete = false;
      if (!result.ok && result.failure.kind === "unauthorized") return;
    }
    for (const workId of loadRecommended()) {
      // the same reader must not count twice: the anonymous vote of this browser is taken back before the account votes
      await setRecommendation(workId, getVoterKey(), false);
      const result = await setAccountRecommendation(token, workId, true);
      if (result.ok) setRecommended(workId, false);
      if (!result.ok && reachable(result.failure.kind) === false) complete = false;
      if (!result.ok && result.failure.kind === "unauthorized") return;
    }
    if (complete) markSynced(accountId);
    notifyPersonalChange();
  })().finally(() => { running.delete(accountId); });
  running.set(accountId, job);
  return job;
}

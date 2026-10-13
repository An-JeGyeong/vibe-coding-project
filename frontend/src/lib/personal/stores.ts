"use client";

import { AUTH_EVENT } from "@/lib/auth/events";
import { clearToken, readToken } from "@/lib/auth/storage";
import { PERSONAL_EVENT } from "./storage";

/** What a server reader answers: the data, "unauthorized" when the token is no longer valid, or null when the server could not be reached. */
export type ServerRead<T> = T | "unauthorized" | null;

export function currentToken(): string | null {
  const stored = readToken();
  return stored.ok ? stored.token : null;
}

/** A token the server refused is dropped, so every screen of the tab falls back to the browser's own data. */
export function dropToken() {
  clearToken();
  try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* no window */ }
}

export function notifyPersonalChange() {
  try { window.dispatchEvent(new Event(PERSONAL_EVENT)); } catch { /* no window */ }
}

export type Store<T> = { subscribe(listener: () => void): () => void; get(): T; server(): T; reset(): void };

const registry: Array<() => void> = [];
/** Forgets what every store holds (tests start each case from nothing). */
export function resetPersonalStores() { for (const reset of registry) reset(); }

/**
 * One shared copy of a piece of personal data for the whole tab (CONTRACTS 32.7): the browser's own value while nobody is signed in,
 * the account's value from the server once a token exists. Every screen that shows it subscribes here, so a page full of heart
 * buttons asks the server once, not once per button. It refreshes whenever the browser data or the sign-in state changes.
 */
export function createStore<T>(readLocal: () => T, readServer: (token: string) => Promise<ServerRead<T>>, initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  let started = false, running = false, again = false, loadedAt = 0;

  async function once() {
    const token = currentToken();
    let next = value;
    if (token === null) next = readLocal();
    else {
      const result = await readServer(token);
      if (result === "unauthorized") { dropToken(); next = readLocal(); }
      else if (result !== null) next = result;     // unreachable server: what is shown stays
    }
    // an equal value keeps its identity, so screens that depend on it do not start their work over for nothing
    if (JSON.stringify(next) !== JSON.stringify(value)) value = next;
  }
  async function refresh() {
    if (running) { again = true; return; }
    running = true;
    try { do { again = false; await once(); loadedAt = Date.now(); listeners.forEach((listener) => listener()); } while (again); }
    finally { running = false; }
  }
  function start() {
    if (started) return;
    started = true;
    for (const name of [PERSONAL_EVENT, AUTH_EVENT, "storage"]) window.addEventListener(name, () => void refresh());
  }
  registry.push(() => { value = initial; loadedAt = 0; });
  return {
    // a screen that mounts while a load runs, or right after one, shares its result instead of asking again
    subscribe(listener) { listeners.add(listener); start(); if (!running && Date.now() - loadedAt > 1000) void refresh(); return () => { listeners.delete(listener); }; },
    get: () => value,
    server: () => initial,
    reset() { value = initial; loadedAt = 0; },
  };
}

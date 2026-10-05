import { describe, expect, test, vi } from "vitest";
import { requestLogin, requestLogout, requestMe } from "@/lib/auth/client";
import { errorBody, json, loginBody, meBody, mockFetch, noContent, NEW_TOKEN, TOKEN } from "./helpers";

describe("request shape follows the approved contract", () => {
  test("login: POST JSON body, no Authorization, credentials omitted, uncached", async () => {
    const { calls } = mockFetch(() => json(200, loginBody()));
    const result = await requestLogin("demo.operator", "  pass word  ");
    expect(result).toMatchObject({ ok: true, value: { accessToken: NEW_TOKEN, user: { role: "OPERATOR" } } });
    const [call] = calls;
    expect(call.path).toBe("/api/auth/login");
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers.Authorization).toBeUndefined();
    expect(JSON.parse(call.body!)).toEqual({ loginId: "demo.operator", password: "  pass word  " });
    expect(call.init.credentials).toBe("omit");
    expect(call.init.cache).toBe("no-store");
  });

  test("me and logout send the bearer token and no body", async () => {
    const { calls } = mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : noContent()));
    expect((await requestMe(TOKEN)).ok).toBe(true);
    expect((await requestLogout(TOKEN)).ok).toBe(true);
    expect(calls.map((call) => [call.method, call.path])).toEqual([["GET", "/api/auth/me"], ["POST", "/api/auth/logout"]]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.body).toBeUndefined();
      expect(call.init.credentials).toBe("omit");
    }
  });
});

describe("failure classification", () => {
  test.each([
    [400, errorBody("INVALID_REQUEST"), {}, { kind: "invalid_request" }],
    [403, errorBody("FORBIDDEN"), {}, { kind: "forbidden" }],
    [429, errorBody("LOGIN_RATE_LIMITED"), { "Retry-After": "90" }, { kind: "rate_limited", retryAfterSeconds: 90 }],
    [429, errorBody("LOGIN_RATE_LIMITED"), {}, { kind: "rate_limited", retryAfterSeconds: null }],
    [429, errorBody("LOGIN_RATE_LIMITED"), { "Retry-After": "soon" }, { kind: "rate_limited", retryAfterSeconds: null }],
    [503, errorBody("AUTH_UNAVAILABLE"), {}, { kind: "unavailable" }],
    [500, errorBody("INTERNAL_ERROR"), {}, { kind: "server_error" }],
    [502, null, {}, { kind: "server_error" }],
  ])("me %i is classified without trusting server text", async (status, body, headers, expected) => {
    mockFetch(() => json(status, body, headers));
    expect(await requestMe(TOKEN)).toEqual({ ok: false, failure: expected });
  });

  test("me 401 AUTH_REQUIRED is unauthorized", async () => {
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    expect(await requestMe(TOKEN)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
  });

  test("any login 401 means wrong credentials", async () => {
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    expect(await requestLogin("demo.operator", "x")).toEqual({ ok: false, failure: { kind: "unauthorized", code: "INVALID_CREDENTIALS" } });
  });

  test("a logout that is not 204 is not a confirmed logout", async () => {
    for (const status of [400, 500, 503]) {
      mockFetch(() => json(status, errorBody("X")));
      expect((await requestLogout(TOKEN)).ok).toBe(false);
    }
    mockFetch(() => json(200, {}));
    expect(await requestLogout(TOKEN)).toEqual({ ok: false, failure: { kind: "invalid_response" } });
  });

  test("malformed success bodies are rejected", async () => {
    const bad = [
      { ...loginBody(), tokenType: "Basic" },
      { ...loginBody(), accessToken: "has space\r\n" },
      { ...loginBody(), expiresAt: "tomorrow" },
      { ...loginBody(), user: { id: 1, displayName: "x", role: "OPERATOR" } },
      { ...loginBody(), user: { id: "1", displayName: "x", role: "ADMIN" } },
      "not an object",
    ];
    for (const body of bad) {
      mockFetch(() => json(200, body));
      expect(await requestLogin("demo.operator", "x"), JSON.stringify(body)).toEqual({ ok: false, failure: { kind: "invalid_response" } });
    }
    mockFetch(() => new Response("<html>", { status: 200 }));
    expect(await requestMe(TOKEN)).toEqual({ ok: false, failure: { kind: "invalid_response" } });
  });

  test("network error and missing configuration are distinct and never leak details", async () => {
    mockFetch(() => { throw new TypeError("private detail http://internal:3306"); });
    const result = await requestMe(TOKEN);
    expect(result).toEqual({ ok: false, failure: { kind: "network" } });

    const { fn } = mockFetch(() => json(200, meBody()));
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(await requestMe(TOKEN)).toEqual({ ok: false, failure: { kind: "misconfigured" } });
    expect(fn).not.toHaveBeenCalled();
  });

  test("a hanging request times out after 10 seconds, a cancelled one reports aborted", async () => {
    vi.useFakeTimers();
    mockFetch(({ init }) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = requestMe(TOKEN);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, failure: { kind: "timeout" } });

    const controller = new AbortController();
    const cancelled = requestMe(TOKEN, controller.signal);
    controller.abort();
    expect(await cancelled).toEqual({ ok: false, failure: { kind: "aborted" } });
  });
});

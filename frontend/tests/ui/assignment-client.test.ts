import { describe, expect, test } from "vitest";
import { getAssignments, getMyEpisode, listAssignableAccounts, listMyEpisodes, setAssignment } from "@/lib/assignment/client";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-06T01:00:00.123456Z";
const person = { account: { id: "2", displayName: "데모 번역가" }, assignedAt: T };

describe("assignment API requests follow CONTRACTS 15.2", () => {
  test("every call sends the bearer token, no cookies, and the documented method, path and body", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/assignable-accounts") return json(200, { items: [{ id: "2", displayName: "데모 번역가", role: "TRANSLATOR" }] });
      if (call.method === "PUT") return json(201, { role: "TRANSLATOR", account: person.account, assignedAt: T, changed: true });
      if (call.path.endsWith("/assignments")) return json(200, { translator: person, reviewer: null });
      if (call.path === "/api/my/episodes") return json(200, { items: [{ id: "7", title: "1화", assignedRole: "REVIEWER", latestSourceVersion: 2, assignedAt: T, updatedAt: T }], total: 1 });
      return json(200, { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 1,
        source: { version: 1, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } });
    });
    expect(await listAssignableAccounts("TRANSLATOR")).toEqual({ ok: true, value: [{ id: "2", displayName: "데모 번역가", role: "TRANSLATOR" }] });
    expect(await getAssignments("7")).toEqual({ ok: true, value: { translator: person, reviewer: null } });
    expect(await setAssignment("7", "translator", "2")).toEqual({ ok: true, value: { role: "TRANSLATOR", person, changed: true, created: true } });
    expect((await listMyEpisodes(20, 40)).ok).toBe(true);
    expect((await getMyEpisode("7")).ok).toBe(true);

    expect(calls.map((call) => `${call.method} ${call.url.replace("http://localhost:8080", "")}`)).toEqual([
      "GET /api/assignable-accounts?role=TRANSLATOR", "GET /api/episodes/7/assignments", "PUT /api/episodes/7/assignments/translator",
      "GET /api/my/episodes?limit=20&offset=40", "GET /api/my/episodes/7",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
    expect(JSON.parse(calls[2].body!)).toEqual({ accountId: "2" });
  });

  test("201 means created, 200 means replaced or unchanged", async () => {
    storeToken();
    mockFetch(() => json(200, { role: "REVIEWER", account: { id: "3", displayName: "데모 감수자" }, assignedAt: T, changed: false }));
    expect(await setAssignment("7", "reviewer", "3")).toMatchObject({ ok: true, value: { changed: false, created: false } });
  });

  test("without a stored token nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, {}));
    expect(await listMyEpisodes(20, 0)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("failure classification and response checks", () => {
  test.each([
    [400, errorBody("INVALID_REQUEST"), { kind: "invalid_request" }],
    [403, errorBody("FORBIDDEN"), { kind: "forbidden" }],
    [404, errorBody("NOT_FOUND"), { kind: "not_found" }],
    [503, errorBody("SERVICE_UNAVAILABLE"), { kind: "unavailable" }],
    [500, errorBody("INTERNAL_ERROR"), { kind: "server_error" }],
  ])("status %i", async (status, body, expected) => {
    storeToken();
    mockFetch(() => json(status, body));
    expect(await setAssignment("7", "translator", "2")).toEqual({ ok: false, failure: expected });
    expect(await getMyEpisode("7")).toEqual({ ok: false, failure: expected });
  });

  test("malformed bodies are rejected", async () => {
    storeToken();
    for (const body of [{}, { items: [{ id: "2", displayName: "x", role: "READER" }] }, { items: "x" }]) {
      mockFetch(() => json(200, body));
      expect((await listAssignableAccounts("TRANSLATOR")).ok, JSON.stringify(body)).toBe(false);
    }
    mockFetch(() => json(200, { translator: { account: { id: 1 }, assignedAt: T }, reviewer: null }));
    expect((await getAssignments("7")).ok).toBe(false);
    mockFetch(() => json(201, { role: "TRANSLATOR", account: person.account, assignedAt: "soon", changed: true }));
    expect((await setAssignment("7", "translator", "2")).ok).toBe(false);
    mockFetch(() => json(200, { id: "7", title: "x", assignedRole: "OPERATOR", latestSourceVersion: 0, source: null }));
    expect((await getMyEpisode("7")).ok).toBe(false);
    mockFetch(() => json(200, { id: "7", title: "x", assignedRole: "REVIEWER", latestSourceVersion: 0, source: null }));
    expect(await getMyEpisode("7")).toMatchObject({ ok: true, value: { source: null } });
  });

  test("a network error is reported without leaking details", async () => {
    storeToken();
    mockFetch(() => { throw new TypeError("private detail"); });
    expect(await getAssignments("7")).toEqual({ ok: false, failure: { kind: "network" } });
  });
});

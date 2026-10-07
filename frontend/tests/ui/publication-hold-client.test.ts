import { describe, expect, test } from "vitest";
import { getPublication, holdPublication, resumePublication } from "@/lib/publication/client";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-07T01:00:00.123456Z";
const entry = { versionNo: 2, sourceVersion: 3, publishedAt: T };

describe("hold and resume requests follow CONTRACTS 21.2", () => {
  test("hold and resume are body-less POSTs with the token; held is parsed", async () => {
    storeToken();
    const { calls } = mockFetch((call) => call.path.endsWith("/hold") ? json(200, { versionNo: 2, status: "ON_HOLD", heldAt: T })
      : call.path.endsWith("/resume") ? json(200, { versionNo: 2, status: "PUBLISHED", publishedAt: T })
      : json(200, { current: null, held: entry, history: [entry] }));
    expect(await holdPublication("7")).toEqual({ ok: true, value: { versionNo: 2, status: "ON_HOLD", heldAt: T } });
    expect(await resumePublication("7")).toEqual({ ok: true, value: { versionNo: 2, status: "PUBLISHED", publishedAt: T } });
    expect(await getPublication("7")).toEqual({ ok: true, value: { current: null, held: entry, history: [entry] } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/episodes/7/publication/hold", "POST /api/episodes/7/publication/resume", "GET /api/episodes/7/publication"]);
    for (const call of calls) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].body).toBeUndefined();
    expect(calls[1].body).toBeUndefined();
  });

  test("a state conflict (with or without currentStatus), 403, 404 and a malformed held are handled", async () => {
    storeToken();
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x" } }));
    expect(await holdPublication("7")).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: null } });
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "ON_HOLD" } }));
    expect(await holdPublication("7")).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "ON_HOLD" } });
    for (const [status, body, kind] of [[403, errorBody("FORBIDDEN"), "forbidden"], [404, errorBody("NOT_FOUND"), "not_found"]] as const) {
      mockFetch(() => json(status, body));
      expect(await resumePublication("7")).toEqual({ ok: false, failure: { kind } });
    }
    mockFetch(() => json(200, { current: null, held: {}, history: [] }));
    expect((await getPublication("7")).ok).toBe(false);
  });

  test("an older response without held is read as no held version", async () => {
    storeToken();
    mockFetch(() => json(200, { current: entry, history: [entry] }));
    expect(await getPublication("7")).toEqual({ ok: true, value: { current: entry, held: null, history: [entry] } });
  });
});

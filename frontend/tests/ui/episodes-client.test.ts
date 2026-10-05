import { describe, expect, test } from "vitest";
import { createEpisode, getEpisode, getVersion, listEpisodes, listVersions, saveSource } from "@/lib/episodes/client";
import { parsePageNo, validateBlockText, validateTitle } from "@/lib/episodes/validation";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-06T01:00:00.123456Z";
const by = { id: "1", displayName: "데모 운영자" };

describe("episode API requests follow CONTRACTS 13.2", () => {
  test("every call sends the bearer token, no cookies, and the documented method, path and body", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.method === "POST") return json(201, { id: "7", title: "1화", latestSourceVersion: 0, createdAt: T });
      if (call.path.endsWith("/versions")) return json(200, { items: [{ version: 1, savedAt: T, savedBy: by, blockCount: 1 }] });
      if (call.method === "PUT") return json(201, { version: 3, changed: true, savedAt: T });
      if (call.path.includes("/versions/")) return json(200, { version: 1, savedAt: T, savedBy: by, blocks: [{ seq: 1, pageNo: null, text: "a" }] });
      if (call.path === "/api/episodes") return json(200, { items: [{ id: "7", title: "1화", latestSourceVersion: 1, updatedAt: T }], total: 1 });
      return json(200, { id: "7", title: "1화", latestSourceVersion: 1, createdAt: T, updatedAt: T, source: null });
    });
    expect((await createEpisode("1화")).ok).toBe(true);
    expect((await listEpisodes(20, 40)).ok).toBe(true);
    expect((await getEpisode("7")).ok).toBe(true);
    expect(await saveSource("7", 2, [{ pageNo: 1, text: "가" }, { pageNo: null, text: "나" }])).toEqual({ ok: true, value: { version: 3, changed: true } });
    expect((await listVersions("7")).ok).toBe(true);
    expect((await getVersion("7", 1)).ok).toBe(true);

    expect(calls.map((call) => `${call.method} ${new URL(call.path, "http://x").pathname}`)).toEqual([
      "POST /api/episodes", "GET /api/episodes", "GET /api/episodes/7", "PUT /api/episodes/7/source",
      "GET /api/episodes/7/source/versions", "GET /api/episodes/7/source/versions/1",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
    expect(JSON.parse(calls[0].body!)).toEqual({ title: "1화" });
    expect(JSON.parse(calls[3].body!)).toEqual({ expectedVersion: 2, blocks: [{ pageNo: 1, text: "가" }, { pageNo: null, text: "나" }] });
  });

  test("the list query carries limit and offset", async () => {
    storeToken();
    const { calls } = mockFetch(() => json(200, { items: [], total: 0 }));
    await listEpisodes(20, 40);
    expect(calls[0].url).toBe("http://localhost:8080/api/episodes?limit=20&offset=40");
  });

  test("without a stored token nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, {}));
    expect(await getEpisode("7")).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("failure classification", () => {
  test("404 is not_found and 409 carries the latest version", async () => {
    storeToken();
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    expect(await getEpisode("9")).toEqual({ ok: false, failure: { kind: "not_found" } });
    mockFetch(() => json(409, { error: { code: "VERSION_CONFLICT", message: "x", latestVersion: 5 } }));
    expect(await saveSource("7", 1, [{ pageNo: null, text: "a" }])).toEqual({ ok: false, failure: { kind: "conflict", latestVersion: 5 } });
    mockFetch(() => json(409, { error: { code: "VERSION_CONFLICT", message: "x" } }));
    expect(await saveSource("7", 1, [{ pageNo: null, text: "a" }])).toEqual({ ok: false, failure: { kind: "conflict", latestVersion: null } });
  });

  test.each([
    [400, errorBody("INVALID_REQUEST"), { kind: "invalid_request" }],
    [401, errorBody("AUTH_REQUIRED"), { kind: "unauthorized", code: "AUTH_REQUIRED" }],
    [403, errorBody("FORBIDDEN"), { kind: "forbidden" }],
    [503, errorBody("SERVICE_UNAVAILABLE"), { kind: "unavailable" }],
    [500, errorBody("INTERNAL_ERROR"), { kind: "server_error" }],
  ])("status %i", async (status, body, expected) => {
    storeToken();
    mockFetch(() => json(status, body));
    expect(await listEpisodes(20, 0)).toEqual({ ok: false, failure: expected });
  });

  test("network errors and malformed bodies are separate and leak nothing", async () => {
    storeToken();
    mockFetch(() => { throw new TypeError("private detail"); });
    expect(await getEpisode("7")).toEqual({ ok: false, failure: { kind: "network" } });
    for (const body of [{}, { id: "7" }, { items: "x", total: 1 }, { items: [{ id: 1 }], total: 1 }]) {
      mockFetch(() => json(200, body));
      expect((await listEpisodes(20, 0)).ok).toBe(false);
      expect((await getEpisode("7")).ok).toBe(false);
    }
    mockFetch(() => json(200, { version: 1, savedAt: T, savedBy: by, blocks: [{ seq: 1, pageNo: "1", text: "a" }] }));
    expect(await getVersion("7", 1)).toEqual({ ok: false, failure: { kind: "invalid_response" } });
  });
});

describe("input rules mirror CONTRACTS 13.3 without normalising anything", () => {
  test("title", () => {
    expect(validateTitle("1화")).toBeNull();
    expect(validateTitle("가".repeat(100))).toBeNull();
    for (const bad of ["", "   ", "가".repeat(101), "a\nb", "a\u0000b"]) expect(validateTitle(bad), JSON.stringify(bad)).not.toBeNull();
    expect(validateTitle(" padded ")).toBeNull();
  });

  test("block text allows tab and line breaks but no other control characters", () => {
    expect(validateBlockText("한 줄\n두 줄\t탭")).toBeNull();
    expect(validateBlockText("가".repeat(2000))).toBeNull();
    for (const bad of ["", " \n ", "가".repeat(2001), "a\u0007b", "a\u0085b"]) expect(validateBlockText(bad), JSON.stringify(bad)).not.toBeNull();
    expect(validateBlockText("😀".repeat(2000))).toBeNull(); // counted in code points, not UTF-16 units
  });

  test("page number: empty means none, otherwise an integer from 1 to 9999", () => {
    expect(parsePageNo("")).toEqual({ value: null, error: null });
    expect(parsePageNo("1").value).toBe(1);
    expect(parsePageNo("9999").value).toBe(9999);
    for (const bad of ["0", "10000", "01", "1.5", "-1", "a", " 1"]) expect(parsePageNo(bad).error, bad).not.toBeNull();
  });
});

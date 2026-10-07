import { describe, expect, test } from "vitest";
import { getPublicEpisode, getPublication, listPublicEpisodes, publishTranslation } from "@/lib/publication/client";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-07T01:00:00.123456Z";
const entry = { versionNo: 2, sourceVersion: 3, publishedAt: T };

describe("operator publication requests follow CONTRACTS 20.1", () => {
  test("publish and publication use the bearer token, no body, and the documented paths", async () => {
    storeToken();
    const { calls } = mockFetch((call) => call.path.endsWith("/publish")
      ? json(200, { versionNo: 2, status: "PUBLISHED", publishedAt: T })
      : json(200, { current: entry, history: [entry, { versionNo: 1, sourceVersion: 2, publishedAt: T }] }));
    expect(await getPublication("7")).toEqual({ ok: true, value: { current: entry, held: null, history: [entry, { versionNo: 1, sourceVersion: 2, publishedAt: T }] } });
    expect(await publishTranslation("7", 2)).toEqual({ ok: true, value: { versionNo: 2, status: "PUBLISHED", publishedAt: T } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /api/episodes/7/publication", "POST /api/episodes/7/translations/2/publish"]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe("omit");
    }
    expect(calls[1].body).toBeUndefined();
  });

  test("no current publication is a valid answer; a malformed one is refused", async () => {
    storeToken();
    mockFetch(() => json(200, { current: null, history: [] }));
    expect(await getPublication("7")).toEqual({ ok: true, value: { current: null, held: null, history: [] } });
    for (const body of [{}, { current: {}, history: [] }, { current: null, history: [{ versionNo: "2" }] }]) {
      mockFetch(() => json(200, body));
      expect((await getPublication("7")).ok, JSON.stringify(body)).toBe(false);
    }
  });

  test("a state conflict carries the current status; other statuses map as usual", async () => {
    storeToken();
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "PUBLISHED" } }));
    expect(await publishTranslation("7", 2)).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "PUBLISHED" } });
    for (const [status, body, kind] of [[403, errorBody("FORBIDDEN"), "forbidden"], [404, errorBody("NOT_FOUND"), "not_found"], [503, errorBody("SERVICE_UNAVAILABLE"), "unavailable"], [500, errorBody("INTERNAL_ERROR"), "server_error"]] as const) {
      mockFetch(() => json(status, body));
      expect(await publishTranslation("7", 2)).toEqual({ ok: false, failure: { kind } });
    }
  });

  test("without a stored token nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, {}));
    expect(await publishTranslation("7", 2)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("public reads never carry the login token", () => {
  test("even with a token in sessionStorage the public requests have no Authorization header", async () => {
    storeToken();
    const { calls } = mockFetch((call) => call.path === "/api/public/episodes"
      ? json(200, { items: [{ episodeId: "7", title: "1화", publishedAt: T }], total: 1 })
      : json(200, { episodeId: "7", title: "1화", publishedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "번역" }, { seq: 2, pageNo: null, text: "둘째" }] }));
    expect(await listPublicEpisodes(20, 40)).toEqual({ ok: true, value: { items: [{ episodeId: "7", title: "1화", publishedAt: T }], total: 1 } });
    expect(await getPublicEpisode("7")).toMatchObject({ ok: true, value: { title: "1화", blocks: [{ seq: 1, pageNo: 1, text: "번역" }, { seq: 2, pageNo: null, text: "둘째" }] } });
    expect(calls.map((call) => `${call.method} ${call.url.replace("http://localhost:8080", "")}`)).toEqual([
      "GET /api/public/episodes?limit=20&offset=40", "GET /api/public/episodes/7",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBeUndefined();
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
  });

  test("works without any stored token and drops fields the contract does not define", async () => {
    mockFetch(() => json(200, { episodeId: "7", title: "1화", publishedAt: T, status: "PUBLISHED", source: "비밀 원문",
      blocks: [{ seq: 1, pageNo: null, text: "번역", source: "원문", createdBy: "3" }] }));
    const result = await getPublicEpisode("7");
    expect(result).toEqual({ ok: true, value: { episodeId: "7", title: "1화", publishedAt: T, blocks: [{ seq: 1, pageNo: null, text: "번역" }] } });
  });

  test("404 is one neutral failure; other failures and malformed bodies are refused", async () => {
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    expect(await getPublicEpisode("9")).toEqual({ ok: false, failure: { kind: "not_found" } });
    mockFetch(() => json(503, errorBody("SERVICE_UNAVAILABLE")));
    expect(await listPublicEpisodes(20, 0)).toEqual({ ok: false, failure: { kind: "unavailable" } });
    mockFetch(() => { throw new TypeError("private detail"); });
    expect(await getPublicEpisode("7")).toEqual({ ok: false, failure: { kind: "network" } });
    for (const body of [{}, { items: [{ episodeId: 7 }], total: 1 }]) {
      mockFetch(() => json(200, body));
      expect((await listPublicEpisodes(20, 0)).ok, JSON.stringify(body)).toBe(false);
    }
    mockFetch(() => json(200, { episodeId: "7", title: "1화", publishedAt: T, blocks: [{ seq: 1, pageNo: null, text: 5 }] }));
    expect((await getPublicEpisode("7")).ok).toBe(false);
  });
});

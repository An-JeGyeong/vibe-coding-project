import { describe, expect, test } from "vitest";
import { createTranslation, getTranslation, listTranslations, saveTranslation, submitTranslation } from "@/lib/translation/client";
import { validateTranslationText } from "@/lib/translation/validation";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-06T01:00:00.123456Z";
const summary = { versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 4, createdAt: T, submittedAt: null };

describe("translation API requests follow CONTRACTS 17.2", () => {
  test("every call sends the bearer token, no cookies, and the documented method, path and body", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.method === "POST" && call.path.endsWith("/submit")) return json(200, { versionNo: 2, status: "REVIEW_PENDING", submittedAt: T });
      if (call.method === "POST") return json(201, { versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 1 });
      if (call.method === "PUT") return json(200, { revision: 5, changed: true });
      if (call.path.endsWith("/translations")) return json(200, { latestSourceVersion: 3, items: [summary] });
      return json(200, { ...summary, editable: true, blocks: [{ seq: 1, pageNo: 1, source: "원문", text: null }, { seq: 2, pageNo: null, source: "둘", text: "번역" }] });
    });
    expect((await listTranslations("7")).ok).toBe(true);
    expect(await createTranslation("7")).toEqual({ ok: true, value: { versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 1 } });
    expect(await getTranslation("7", 2)).toMatchObject({ ok: true, value: { editable: true, blocks: [{ seq: 1, text: null }, { seq: 2, text: "번역" }] } });
    expect(await saveTranslation("7", 2, 4, [{ seq: 2, text: "번역" }])).toEqual({ ok: true, value: { revision: 5, changed: true } });
    expect(await submitTranslation("7", 2, 5)).toMatchObject({ ok: true, value: { status: "REVIEW_PENDING" } });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/my/episodes/7/translations", "POST /api/my/episodes/7/translations", "GET /api/my/episodes/7/translations/2",
      "PUT /api/my/episodes/7/translations/2", "POST /api/my/episodes/7/translations/2/submit",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
    expect(JSON.parse(calls[3].body!)).toEqual({ expectedRevision: 4, blocks: [{ seq: 2, text: "번역" }] });
    expect(JSON.parse(calls[4].body!)).toEqual({ expectedRevision: 5 });
    expect(calls[1].body).toBeUndefined();
  });

  test("without a stored token nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, {}));
    expect(await listTranslations("7")).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("translation-specific failures", () => {
  test("INCOMPLETE_TRANSLATION carries the missing seqs", async () => {
    storeToken();
    mockFetch(() => json(400, { error: { code: "INCOMPLETE_TRANSLATION", message: "x", missingSeqs: [2, 5] } }));
    expect(await submitTranslation("7", 2, 1)).toEqual({ ok: false, failure: { kind: "incomplete", missingSeqs: [2, 5] } });
    mockFetch(() => json(400, errorBody("INVALID_REQUEST")));
    expect(await submitTranslation("7", 2, 1)).toEqual({ ok: false, failure: { kind: "invalid_request" } });
  });

  test("409 distinguishes a revision conflict from a state conflict", async () => {
    storeToken();
    mockFetch(() => json(409, { error: { code: "VERSION_CONFLICT", message: "x", latestRevision: 9 } }));
    expect(await saveTranslation("7", 2, 1, [])).toEqual({ ok: false, failure: { kind: "revision_conflict", latestRevision: 9 } });
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }));
    expect(await saveTranslation("7", 2, 1, [])).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "INVALIDATED" } });
    expect(await createTranslation("7")).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "INVALIDATED" } });
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x" } }));
    expect(await createTranslation("7")).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: null } });
  });

  test.each([
    [403, errorBody("FORBIDDEN"), { kind: "forbidden" }],
    [404, errorBody("NOT_FOUND"), { kind: "not_found" }],
    [503, errorBody("SERVICE_UNAVAILABLE"), { kind: "unavailable" }],
    [500, errorBody("INTERNAL_ERROR"), { kind: "server_error" }],
  ])("status %i", async (status, body, expected) => {
    storeToken();
    mockFetch(() => json(status, body));
    expect(await getTranslation("7", 2)).toEqual({ ok: false, failure: expected });
  });

  test("malformed bodies are rejected and network errors do not leak details", async () => {
    storeToken();
    for (const body of [{}, { latestSourceVersion: 1, items: [{ versionNo: 1, status: "WEIRD", sourceVersion: 1, revision: 1, createdAt: T, submittedAt: null }] }]) {
      mockFetch(() => json(200, body));
      expect((await listTranslations("7")).ok, JSON.stringify(body)).toBe(false);
    }
    mockFetch(() => json(200, { ...summary, editable: true, blocks: [{ seq: 1, pageNo: null, source: "a", text: 5 }] }));
    expect((await getTranslation("7", 2)).ok).toBe(false);
    mockFetch(() => { throw new TypeError("private detail"); });
    expect(await createTranslation("7")).toEqual({ ok: false, failure: { kind: "network" } });
  });
});

describe("translation text rules mirror CONTRACTS 17.3 without normalising anything", () => {
  test("empty means not translated; anything typed must be valid", () => {
    expect(validateTranslationText("")).toBeNull();
    expect(validateTranslationText("번역\n두 줄\t탭")).toBeNull();
    expect(validateTranslationText("가".repeat(4000))).toBeNull();
    expect(validateTranslationText("😀".repeat(4000))).toBeNull();
    for (const bad of ["   ", " \n ", "가".repeat(4001), "a\u0007b", "a\u0085b"]) expect(validateTranslationText(bad), JSON.stringify(bad)).not.toBeNull();
    expect(validateTranslationText("  앞뒤 공백  ")).toBeNull();
  });
});

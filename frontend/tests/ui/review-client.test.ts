import { describe, expect, test } from "vitest";
import {
  approveReview, getOperatorTranslation, getReview, listEpisodeReviews, listOperatorTranslations, listPendingReviews, rejectReview,
} from "@/lib/review/client";
import { validateReason } from "@/lib/review/validation";
import { parseDecision } from "@/lib/translation/decision";
import { errorBody, json, mockFetch, storeToken, TOKEN } from "./helpers";

const T = "2026-10-06T01:00:00.123456Z";
const rejected = { decision: "REJECTED", decidedAt: T, reason: "번역이 어색합니다" };
const approved = { decision: "APPROVED", decidedAt: T, reason: null };
const block = { seq: 1, pageNo: 1, source: "원문", text: "번역" };

describe("review API requests follow CONTRACTS 18.1", () => {
  test("every call sends the bearer token, no cookies, and the documented method, path and body", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/my/reviews") return json(200, { items: [{ episodeId: "7", title: "1화", versionNo: 2, sourceVersion: 3, submittedAt: T }], total: 1 });
      if (call.path === "/api/my/episodes/7/reviews") return json(200, { latestSourceVersion: 3, items: [{ versionNo: 2, status: "APPROVED", sourceVersion: 3, submittedAt: T, decision: approved }] });
      if (call.path.endsWith("/approve")) return json(200, { versionNo: 2, status: "APPROVED", decidedAt: T });
      if (call.path.endsWith("/reject")) return json(200, { versionNo: 2, status: "REJECTED", decidedAt: T });
      if (call.path === "/api/episodes/7/translations") return json(200, { latestSourceVersion: 3, items: [{ versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 4, createdAt: T, submittedAt: null, decision: null }] });
      if (call.path === "/api/episodes/7/translations/2") return json(200, { versionNo: 2, status: "INVALIDATED", sourceVersion: 3, createdAt: T, submittedAt: T, decision: approved, invalidatedAt: T, blocks: [block] });
      return json(200, { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: true, decision: null, blocks: [block] });
    });
    expect(await listPendingReviews(20, 40)).toMatchObject({ ok: true, value: { total: 1, items: [{ episodeId: "7", versionNo: 2 }] } });
    expect(await listEpisodeReviews("7")).toMatchObject({ ok: true, value: { items: [{ decision: { decision: "APPROVED", reason: null } }] } });
    expect(await getReview("7", 2)).toMatchObject({ ok: true, value: { decidable: true, decision: null, blocks: [{ seq: 1, text: "번역" }] } });
    expect(await approveReview("7", 2)).toEqual({ ok: true, value: { versionNo: 2, status: "APPROVED", decidedAt: T } });
    expect(await rejectReview("7", 2, "  사유\n둘째 줄  ")).toMatchObject({ ok: true, value: { status: "REJECTED" } });
    expect(await listOperatorTranslations("7")).toMatchObject({ ok: true, value: { items: [{ status: "DRAFT", revision: 4 }] } });
    expect(await getOperatorTranslation("7", 2)).toMatchObject({ ok: true, value: { invalidatedAt: T, decision: { decision: "APPROVED" } } });

    expect(calls.map((call) => `${call.method} ${call.url.replace("http://localhost:8080", "")}`)).toEqual([
      "GET /api/my/reviews?limit=20&offset=40", "GET /api/my/episodes/7/reviews", "GET /api/my/episodes/7/reviews/2",
      "POST /api/my/episodes/7/reviews/2/approve", "POST /api/my/episodes/7/reviews/2/reject",
      "GET /api/episodes/7/translations", "GET /api/episodes/7/translations/2",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
    expect(calls[3].body).toBeUndefined();
    expect(JSON.parse(calls[4].body!)).toEqual({ reason: "  사유\n둘째 줄  " });
  });

  test("without a stored token nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, {}));
    expect(await listPendingReviews(20, 0)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  test("a state conflict carries the current status", async () => {
    storeToken();
    mockFetch(() => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }));
    expect(await approveReview("7", 2)).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "INVALIDATED" } });
    expect(await rejectReview("7", 2, "사유")).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "INVALIDATED" } });
  });

  test.each([
    [400, errorBody("INVALID_REQUEST"), { kind: "invalid_request" }],
    [403, errorBody("FORBIDDEN"), { kind: "forbidden" }],
    [404, errorBody("NOT_FOUND"), { kind: "not_found" }],
    [503, errorBody("SERVICE_UNAVAILABLE"), { kind: "unavailable" }],
    [500, errorBody("INTERNAL_ERROR"), { kind: "server_error" }],
  ])("status %i", async (status, body, expected) => {
    storeToken();
    mockFetch(() => json(status, body));
    expect(await getReview("7", 2)).toEqual({ ok: false, failure: expected });
    expect(await rejectReview("7", 2, "x")).toEqual({ ok: false, failure: expected });
  });

  test("malformed bodies are rejected and a network error leaks nothing", async () => {
    storeToken();
    for (const body of [{}, { items: [{ episodeId: 7 }], total: 1 }]) {
      mockFetch(() => json(200, body));
      expect((await listPendingReviews(20, 0)).ok, JSON.stringify(body)).toBe(false);
    }
    mockFetch(() => json(200, { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: true, decision: { decision: "MAYBE", decidedAt: T }, blocks: [] }));
    expect((await getReview("7", 2)).ok).toBe(false);
    mockFetch(() => json(200, { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: "yes", decision: null, blocks: [] }));
    expect((await getReview("7", 2)).ok).toBe(false);
    mockFetch(() => { throw new TypeError("private detail"); });
    expect(await approveReview("7", 2)).toEqual({ ok: false, failure: { kind: "network" } });
  });
});

describe("decision parsing and reason rules", () => {
  test("an absent decision means none; a rejection keeps its reason; a bad shape is refused", () => {
    expect(parseDecision(undefined)).toEqual({ ok: true, value: null });
    expect(parseDecision(null)).toEqual({ ok: true, value: null });
    expect(parseDecision(approved)).toEqual({ ok: true, value: approved });
    expect(parseDecision(rejected)).toEqual({ ok: true, value: rejected });
    expect(parseDecision({ decision: "APPROVED", decidedAt: T })).toEqual({ ok: true, value: approved });
    expect(parseDecision({ decision: "REJECTED", decidedAt: "soon", reason: "x" })).toEqual({ ok: false });
    expect(parseDecision("APPROVED")).toEqual({ ok: false });
  });

  test("the rejection reason follows CONTRACTS 18.2 without normalising anything", () => {
    expect(validateReason("번역이 어색합니다")).toBeNull();
    expect(validateReason("  앞뒤 공백\n둘째 줄\t탭  ")).toBeNull();
    expect(validateReason("가".repeat(500))).toBeNull();
    expect(validateReason("😀".repeat(500))).toBeNull();
    for (const bad of ["", "   ", " \n ", "가".repeat(501), "a\u0007b", "a\u0085b"]) expect(validateReason(bad), JSON.stringify(bad)).not.toBeNull();
  });
});

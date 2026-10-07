import { describe, expect, test, vi } from "vitest";
import { mapLimited, operatorChip, translatorChip, translatorSummary } from "@/lib/dashboard/status";
import { defaultPair } from "@/components/VersionCompare";
import { filterByTitle, loadAllPublicEpisodes, MAX_PAGES, neighbours } from "@/lib/reader/episodes";
import { hasPosition, loadPosition, POSITION_KEY, savePosition } from "@/lib/reader/position";
import { compareBlocks, summarizeCompare } from "@/lib/translation/compare";
import { translationProgress } from "@/lib/translation/progress";
import { json, mockFetch } from "./helpers";

const T = "2026-10-07T01:00:00.123456Z";

describe("compareBlocks (23.1)", () => {
  test("aligns by seq and classifies same / changed / added / removed; null text compares as empty", () => {
    const rows = compareBlocks(
      [{ seq: 1, text: "같음" }, { seq: 2, text: "이전" }, { seq: 3, text: null }, { seq: 5, text: "삭제될 블록" }],
      [{ seq: 4, text: "추가" }, { seq: 1, text: "같음" }, { seq: 2, text: "새 번역" }, { seq: 3, text: "" }],
    );
    expect(rows).toEqual([
      { seq: 1, change: "same", before: "같음", after: "같음" },
      { seq: 2, change: "changed", before: "이전", after: "새 번역" },
      { seq: 3, change: "same", before: "", after: "" },
      { seq: 4, change: "added", before: null, after: "추가" },
      { seq: 5, change: "removed", before: "삭제될 블록", after: null },
    ]);
    expect(summarizeCompare(rows)).toEqual({ changed: 1, added: 1, removed: 1, same: 2 });
  });

  test("whitespace differences count as changes (no normalising)", () => {
    expect(compareBlocks([{ seq: 1, text: "a" }], [{ seq: 1, text: "a " }])[0].change).toBe("changed");
  });
});

describe("defaultPair (23.1)", () => {
  test("latest rejected version with the one after it, else the two newest, none under two versions", () => {
    expect(defaultPair([{ versionNo: 1, status: "REJECTED" }])).toBeNull();
    expect(defaultPair([{ versionNo: 2, status: "DRAFT" }, { versionNo: 1, status: "REJECTED" }])).toEqual([1, 2]);
    expect(defaultPair([{ versionNo: 3, status: "DRAFT" }, { versionNo: 2, status: "REJECTED" }, { versionNo: 1, status: "REJECTED" }])).toEqual([2, 3]);
    expect(defaultPair([{ versionNo: 3, status: "APPROVED" }, { versionNo: 2, status: "APPROVED" }, { versionNo: 1, status: "REJECTED" }])).toEqual([1, 2]);
    expect(defaultPair([{ versionNo: 2, status: "APPROVED" }, { versionNo: 1, status: "INVALIDATED" }])).toEqual([1, 2]);
  });
});

describe("translationProgress (23.2)", () => {
  test("counts blocks whose translation is not blank; zero blocks is 0%; rounds to an integer", () => {
    expect(translationProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    const blocks = [{ seq: 1, text: "가" }, { seq: 2, text: "  \n" }, { seq: 3, text: null }];
    expect(translationProgress(blocks)).toEqual({ done: 1, total: 3, percent: 33 });
    expect(translationProgress([{ seq: 1, text: "a" }, { seq: 2, text: "b" }, { seq: 3, text: null }])).toEqual({ done: 2, total: 3, percent: 67 });
  });

  test("typed values win over saved ones, per block; a typed blank counts as not done", () => {
    const blocks = [{ seq: 1, text: "저장됨" }, { seq: 2, text: null }, { seq: 3, text: "저장됨" }];
    expect(translationProgress(blocks, { 1: "저장됨", 2: "새로 입력", 3: "   " })).toEqual({ done: 2, total: 3, percent: 67 });
    expect(translationProgress(blocks, {})).toEqual({ done: 2, total: 3, percent: 67 }); // untouched blocks fall back to the saved text
  });
});

describe("reader position (23.3)", () => {
  test("saves episode id, block number and publication time only; a changed publication time discards it", () => {
    savePosition("7", 3, T);
    expect(JSON.parse(window.localStorage.getItem(POSITION_KEY)!)).toEqual({ 7: { seq: 3, publishedAt: T } });
    expect(loadPosition("7", T)).toEqual({ seq: 3, publishedAt: T });
    expect(hasPosition("7", T)).toBe(true);
    expect(loadPosition("7", "2026-10-08T00:00:00.000000Z")).toBeNull();
    expect(window.localStorage.getItem(POSITION_KEY)).toBe("{}");
    expect(hasPosition("7", T)).toBe(false);
  });

  test("blocked or corrupt storage never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadPosition("7", T)).toBeNull();
    expect(() => savePosition("7", 1, T)).not.toThrow();
    expect(hasPosition("7", T)).toBe(false);
    vi.restoreAllMocks();
    window.localStorage.setItem(POSITION_KEY, "not json");
    expect(loadPosition("7", T)).toBeNull();
    window.localStorage.setItem(POSITION_KEY, JSON.stringify({ 7: { seq: "x", publishedAt: 5 }, 8: { seq: 2, publishedAt: T } }));
    expect(loadPosition("7", T)).toBeNull();
    expect(loadPosition("8", T)).toEqual({ seq: 2, publishedAt: T });
  });
});

describe("public list helpers (23.3)", () => {
  const eps = [{ episodeId: "1", title: "Hello World", publishedAt: T }, { episodeId: "2", title: "둘째 회차", publishedAt: T }, { episodeId: "3", title: "hello again", publishedAt: T }];

  test("title filter is a case-insensitive substring match; surrounding spaces only matter for matching", () => {
    expect(filterByTitle(eps, "  HELLO ").map((e) => e.episodeId)).toEqual(["1", "3"]);
    expect(filterByTitle(eps, "둘째").map((e) => e.episodeId)).toEqual(["2"]);
    expect(filterByTitle(eps, "   ")).toEqual(eps);
    expect(filterByTitle(eps, "없음")).toEqual([]);
  });

  test("neighbours follow the list order; unknown episode gives null", () => {
    expect(neighbours(eps, "2")).toEqual({ previous: eps[0], next: eps[2] });
    expect(neighbours(eps, "1")).toEqual({ previous: null, next: eps[1] });
    expect(neighbours(eps, "3")?.next).toBeNull();
    expect(neighbours(eps, "9")).toBeNull();
  });

  test("loads every page of 100 and stops at the total", async () => {
    const make = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ episodeId: String(from + i), title: `회차 ${from + i}`, publishedAt: T }));
    const { calls } = mockFetch((call) => {
      const offset = Number(new URL(call.url).searchParams.get("offset"));
      return json(200, { items: make(offset + 1, Math.min(100, 230 - offset)), total: 230 });
    });
    const result = await loadAllPublicEpisodes();
    expect(result.ok && result.value.items.length).toBe(230);
    expect(result.ok && result.value.truncated).toBe(false);
    expect(calls.map((call) => new URL(call.url).search)).toEqual(["?limit=100&offset=0", "?limit=100&offset=100", "?limit=100&offset=200"]);
  });

  test("stops after 10 requests (1000 episodes) and reports the truncation; a failing page fails the whole load", async () => {
    mockFetch(() => json(200, { items: Array.from({ length: 100 }, (_, i) => ({ episodeId: String(i), title: "t", publishedAt: T })), total: 5000 }));
    const result = await loadAllPublicEpisodes();
    expect(result.ok && result.value.items.length).toBe(MAX_PAGES * 100);
    expect(result.ok && result.value.truncated).toBe(true);
    let n = 0;
    mockFetch(() => (++n === 2 ? json(503, { error: { code: "SERVICE_UNAVAILABLE", message: "x" } }) : json(200, { items: Array.from({ length: 100 }, () => ({ episodeId: "1", title: "t", publishedAt: T })), total: 500 })));
    expect(await loadAllPublicEpisodes()).toEqual({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("dashboard helpers (23.4)", () => {
  test("operator chip: publication first, then approved, pending review, draft", () => {
    const entry = { versionNo: 1, sourceVersion: 1, publishedAt: T };
    expect(operatorChip([], null).label).toBe("번역 없음");
    expect(operatorChip([{ versionNo: 1, status: "DRAFT" }], null).label).toBe("작성 중");
    expect(operatorChip([{ versionNo: 2, status: "DRAFT" }, { versionNo: 1, status: "REVIEW_PENDING" }], null).label).toBe("검수 대기");
    expect(operatorChip([{ versionNo: 1, status: "APPROVED" }], null).label).toBe("발행 대기(승인됨)");
    expect(operatorChip([{ versionNo: 1, status: "APPROVED" }], { current: entry, held: null, history: [entry] }).label).toBe("공개 중");
    expect(operatorChip([{ versionNo: 1, status: "ON_HOLD" }], { current: null, held: entry, history: [entry] }).label).toBe("보류 중");
  });

  test("translator chip follows the latest version; summary counts what needs attention", () => {
    expect(translatorChip([]).label).toBe("시작 전");
    expect(translatorChip([{ versionNo: 1, status: "REJECTED" }, { versionNo: 2, status: "DRAFT" }]).label).toBe("작성 중");
    expect(translatorChip([{ versionNo: 2, status: "REJECTED" }, { versionNo: 1, status: "APPROVED" }]).label).toBe("반려됨");
    const labels = ["REVIEW_PENDING", "APPROVED", "PUBLISHED", "INVALIDATED", "ON_HOLD"].map((status) => translatorChip([{ versionNo: 1, status }]).label);
    expect(labels).toEqual(["검수 대기", "승인됨", "발행됨", "무효화됨", "보류"]);
    expect(translatorSummary([translatorChip([]), translatorChip([{ versionNo: 1, status: "REJECTED" }]), translatorChip([{ versionNo: 1, status: "DRAFT" }]), translatorChip([])]))
      .toEqual({ rejected: 1, drafting: 1, notStarted: 2 });
  });

  test("mapLimited keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - n)));
      running--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimited([], 5, async (n: number) => n)).toEqual([]);
  });
});

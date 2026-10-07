import { describe, expect, test } from "vitest";
import { getOperatorTranslation, getReview, rejectReview } from "@/lib/review/client";
import { COMMENT_MAX, COMMENTS_MAX, validateComment } from "@/lib/review/validation";
import { parseBlockComments } from "@/lib/translation/comments";
import { getTranslation } from "@/lib/translation/client";
import { json, mockFetch, storeToken } from "./helpers";

const T = "2026-10-07T01:00:00.123456Z";
const block = { seq: 1, pageNo: 1, source: "원문", text: "번역" };
const remark = { seq: 1, text: "어색합니다", createdAt: T };
const rejected = { decision: "REJECTED", decidedAt: T, reason: "사유" };

describe("reject request carries optional block comments (CONTRACTS 22.2)", () => {
  test("without comments the body is exactly the 18.1 one; with comments it adds them in seq/text form only", async () => {
    storeToken();
    const { calls } = mockFetch(() => json(200, { versionNo: 2, status: "REJECTED", decidedAt: T }));
    await rejectReview("7", 2, "사유");
    await rejectReview("7", 2, "사유", []);
    await rejectReview("7", 2, "  사유\n", [{ seq: 1, text: "  의견 \n" }, { seq: 3, text: "둘째" }]);
    expect(JSON.parse(calls[0].body!)).toEqual({ reason: "사유" });
    expect(JSON.parse(calls[1].body!)).toEqual({ reason: "사유" });
    expect(JSON.parse(calls[2].body!)).toEqual({ reason: "  사유\n", comments: [{ seq: 1, text: "  의견 \n" }, { seq: 3, text: "둘째" }] });
  });
});

describe("blockComments in detail responses", () => {
  const reviewBody = (extra: Record<string, unknown>) => ({ versionNo: 2, status: "REJECTED", sourceVersion: 3, submittedAt: T, decidable: false, decision: rejected, blocks: [block], ...extra });
  const translatorBody = (extra: Record<string, unknown>) => ({ versionNo: 2, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, editable: false, decision: rejected, blocks: [block], ...extra });
  const operatorBody = (extra: Record<string, unknown>) => ({ versionNo: 2, status: "REJECTED", sourceVersion: 3, createdAt: T, submittedAt: T, decision: rejected, invalidatedAt: null, blocks: [block], ...extra });

  test("all three detail clients read the comments; absent means none", async () => {
    storeToken();
    mockFetch(() => json(200, reviewBody({ blockComments: [remark] })));
    expect(await getReview("7", 2)).toMatchObject({ ok: true, value: { blockComments: [remark] } });
    mockFetch(() => json(200, translatorBody({ blockComments: [remark] })));
    expect(await getTranslation("7", 2)).toMatchObject({ ok: true, value: { blockComments: [remark] } });
    mockFetch(() => json(200, operatorBody({ blockComments: [remark] })));
    expect(await getOperatorTranslation("7", 2)).toMatchObject({ ok: true, value: { blockComments: [remark] } });
    mockFetch(() => json(200, reviewBody({})));
    expect(await getReview("7", 2)).toMatchObject({ ok: true, value: { blockComments: [] } });
    mockFetch(() => json(200, translatorBody({ blockComments: [] })));
    expect(await getTranslation("7", 2)).toMatchObject({ ok: true, value: { blockComments: [] } });
  });

  test("a malformed comment list is refused by every detail client", async () => {
    storeToken();
    for (const bad of ["x", [{ seq: "1", text: "a", createdAt: T }], [{ seq: 1, text: 5, createdAt: T }], [{ seq: 1, text: "a" }]]) {
      mockFetch(() => json(200, reviewBody({ blockComments: bad })));
      expect((await getReview("7", 2)).ok, JSON.stringify(bad)).toBe(false);
      mockFetch(() => json(200, translatorBody({ blockComments: bad })));
      expect((await getTranslation("7", 2)).ok).toBe(false);
      mockFetch(() => json(200, operatorBody({ blockComments: bad })));
      expect((await getOperatorTranslation("7", 2)).ok).toBe(false);
    }
    expect(parseBlockComments(null)).toEqual([]);
    expect(parseBlockComments(undefined)).toEqual([]);
  });
});

describe("validateComment follows the 22.2 text rules", () => {
  test("empty means no remark; others must be real remarks without normalising anything", () => {
    expect(validateComment("")).toBeNull();
    expect(validateComment("  앞뒤 공백\n둘째 줄\t탭  ")).toBeNull();
    expect(validateComment("가".repeat(COMMENT_MAX))).toBeNull();
    expect(validateComment("😀".repeat(COMMENT_MAX))).toBeNull();
    for (const bad of ["   ", " \n ", "가".repeat(COMMENT_MAX + 1), "a\u0007b", "a\u0085b"]) expect(validateComment(bad), JSON.stringify(bad)).not.toBeNull();
    expect(COMMENTS_MAX).toBe(50);
  });
});

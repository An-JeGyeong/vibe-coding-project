import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import ReviewDetailPage from "@/app/(auth)/reviews/[episodeId]/[versionNo]/page";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import { groupByPage, pageLabel } from "@/lib/translation/pages";
import type { Role } from "@/lib/auth/types";
import { json, meBody, mockFetch, renderWithAuth, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7", episodeId: "7", versionNo: "2" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-07T01:00:00.123456Z";
// seq 1-2 on page 1, seq 3 on page 2, seq 4 without a page number
const pageOf = [1, 1, 2, null] as const;
const blocks = (texts: (string | null)[]) => [1, 2, 3, 4].map((seq) => ({ seq, pageNo: pageOf[seq - 1], source: `원문 ${seq}`, text: texts[seq - 1] }));

describe("groupByPage (26.4)", () => {
  test("pages ascending, blocks without a page last, block order kept inside a page", () => {
    const groups = groupByPage([{ seq: 4, pageNo: null }, { seq: 3, pageNo: 2 }, { seq: 1, pageNo: 1 }, { seq: 2, pageNo: 1 }, { seq: 5, pageNo: 2 }]);
    expect(groups.map((g) => [g.label, g.blocks.map((b) => b.seq)])).toEqual([["p.1", [1, 2]], ["p.2", [3, 5]], ["페이지 미지정", [4]]]);
    expect(pageLabel(null)).toBe("페이지 미지정");
    expect(groupByPage([])).toEqual([]);
    expect(groupByPage([{ seq: 1, pageNo: 10 }, { seq: 2, pageNo: 9 }]).map((g) => g.pageNo)).toEqual([9, 10]);
  });
});

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role, routes: Record<string, H> = {}) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (n: number) => screen.getByLabelText(`블록 ${n} 번역`) as HTMLTextAreaElement;

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.params = { id: "7", episodeId: "7", versionNo: "2" }; });

describe("translator: one page at a time", () => {
  const episode = { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "원문" }] } };
  const summary = (versionNo: number, status: string) => ({ versionNo, status, sourceVersion: 3, revision: 1, createdAt: T, submittedAt: null, decision: null });
  const detail = (versionNo: number, status: string, texts: (string | null)[]) => ({ ...summary(versionNo, status), editable: status === "DRAFT", blocks: blocks(texts), blockComments: [] });

  function open(routes: Record<string, H> = {}, texts: (string | null)[] = ["가", null, null, null]) {
    const api = server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT")] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", texts)),
      ...routes,
    });
    renderWithAuth(<AssignedDetailPage />);
    return api;
  }

  test("shows only the current page with a page bar; the page picker, previous and next move between pages (unassigned last)", async () => {
    open();
    expect(await screen.findByLabelText("블록 1 번역")).toBeTruthy();
    const bar = within(screen.getByRole("navigation", { name: "페이지 이동" }));
    expect(bar.getByText(/p\.1 \(1 \/ 3\)/)).toBeTruthy();
    expect(bar.getByText(/번역 1\/2 블록/)).toBeTruthy();
    expect(screen.getByLabelText("블록 2 번역")).toBeTruthy();
    expect(screen.queryByLabelText("블록 3 번역")).toBeNull();
    expect((bar.getByRole("button", { name: "이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    click("다음 페이지");
    expect(screen.getByLabelText("블록 3 번역")).toBeTruthy();
    expect(screen.queryByLabelText("블록 1 번역")).toBeNull();
    expect(screen.getByText(/p\.2 \(2 \/ 3\)/)).toBeTruthy();
    click("다음 페이지");
    expect(screen.getByLabelText("블록 4 번역")).toBeTruthy();
    expect(screen.getByText(/페이지 미지정 \(3 \/ 3\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "다음 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("페이지 선택"), { target: { value: "0" } });
    expect(screen.getByLabelText("블록 1 번역")).toBeTruthy();
  });

  test("typing on one page survives turning pages; saving sends the blocks of every page; progress counts all pages", async () => {
    const { calls } = open({ "PUT /api/my/episodes/7/translations/2": () => json(200, { revision: 2, changed: true }) });
    await screen.findByLabelText("블록 1 번역");
    fireEvent.change(field(2), { target: { value: "둘째" } });
    click("다음 페이지");
    fireEvent.change(field(3), { target: { value: "셋째" } });
    expect(screen.getByText(/번역 1\/1 블록/)).toBeTruthy();
    expect(screen.getByText(/3\/4 블록 \(75%\)/)).toBeTruthy(); // overall progress spans pages
    fireEvent.change(screen.getByLabelText("페이지 선택"), { target: { value: "0" } });
    expect(field(2).value).toBe("둘째");
    click("저장");
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.method === "PUT")!.body!).blocks).toEqual([
      { seq: 1, text: "가" }, { seq: 2, text: "둘째" }, { seq: 3, text: "셋째" },
    ]);
  });

  test("a submit with missing blocks marks the pages that still need a translation", async () => {
    open({}, ["가", "나", "다", null]);
    await screen.findByLabelText("블록 1 번역");
    click("검수에 제출");
    click("제출 확정");
    expect(await screen.findByText(/번역하지 않은 블록이 1개 있습니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("페이지 선택"), { target: { value: "2" } });
    expect(screen.getByText(/번역이 필요한 블록 있음/)).toBeTruthy();
  });

  test("'show all' lists every page with a heading and hides the page bar controls", async () => {
    open();
    await screen.findByLabelText("블록 1 번역");
    fireEvent.click(screen.getByLabelText("전체 보기"));
    for (const n of [1, 2, 3, 4]) expect(screen.getByLabelText(`블록 ${n} 번역`)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "페이지 미지정" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다음 페이지" })).toBeNull();
    fireEvent.click(screen.getByLabelText("전체 보기"));
    expect(screen.queryByLabelText("블록 3 번역")).toBeNull();
  });

  test("another version starts again on its first page", async () => {
    open({
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT"), summary(1, "REJECTED")] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REJECTED", ["옛 1", "옛 2", "옛 3", "옛 4"])),
    });
    await screen.findByLabelText("블록 1 번역");
    click("다음 페이지");
    expect(screen.getByText(/p\.2 \(2 \/ 3\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "v1 보기" }));
    expect(await screen.findByText("옛 1")).toBeTruthy();
    expect(screen.getByText(/p\.1 \(1 \/ 3\)/)).toBeTruthy();
  });

  test("a version with a single page has no page bar", async () => {
    const one = (texts: (string | null)[]) => texts.map((text, i) => ({ seq: i + 1, pageNo: 5, source: `원문 ${i + 1}`, text }));
    open({ "GET /api/my/episodes/7/translations/2": () => json(200, { ...detail(2, "DRAFT", []), blocks: one(["가", null]) }) });
    await screen.findByLabelText("블록 1 번역");
    expect(screen.queryByRole("navigation", { name: "페이지 이동" })).toBeNull();
    expect(screen.getByLabelText("블록 2 번역")).toBeTruthy();
  });

  test("AI proposals fill blocks on every page even when only one page is shown", async () => {
    open({ "POST /api/my/episodes/7/translations/2/ai-draft": () => json(200, { versionNo: 2, provider: "mock", suggestions: [{ seq: 2, text: "AI 2" }, { seq: 3, text: "AI 3" }, { seq: 4, text: "AI 4" }] }) });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    expect(await screen.findByText(/AI 초안 3개를 채웠습니다/)).toBeTruthy();
    expect(field(2).value).toBe("AI 2");
    click("다음 페이지");
    expect(field(3).value).toBe("AI 3");
    expect(screen.getAllByText("AI 초안", { selector: "span.badge" })).toHaveLength(1);
  });
});

describe("reviewer and operator: pages", () => {
  const rejected = { decision: "REJECTED", decidedAt: T, reason: "사유" };
  const review = (extra: Record<string, unknown> = {}) => ({ versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: true, decision: null, blocks: blocks(["가", "나", "다", "라"]), blockComments: [], ...extra });
  const REV = "/api/my/episodes/7/reviews/2";

  test("the reviewer's remarks typed on different pages are all sent with the rejection", async () => {
    const { calls } = server("REVIEWER", {
      [`GET ${REV}`]: () => json(200, review()),
      [`POST ${REV}/reject`]: () => json(200, { versionNo: 2, status: "REJECTED", decidedAt: T }),
    });
    renderWithAuth(<ReviewDetailPage />);
    await screen.findByRole("heading", { name: "번역 v2 검토" });
    expect(screen.getByText("원문 1")).toBeTruthy();
    expect(screen.queryByText("원문 3")).toBeNull();
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    fireEvent.change(screen.getByLabelText(/블록 2 의견/), { target: { value: "1쪽 의견" } });
    click("다음 페이지");
    expect(screen.getByText("원문 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/블록 3 의견/), { target: { value: "2쪽 의견" } });
    click("반려 확정");
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.method === "POST")!.body!)).toEqual({
      reason: "사유", comments: [{ seq: 2, text: "1쪽 의견" }, { seq: 3, text: "2쪽 의견" }],
    });
  });

  test("a validation error on another page is not lost and the first page keeps its remark", async () => {
    server("REVIEWER", { [`GET ${REV}`]: () => json(200, review()) });
    renderWithAuth(<ReviewDetailPage />);
    await screen.findByRole("heading", { name: "번역 v2 검토" });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    click("다음 페이지");
    fireEvent.change(screen.getByLabelText(/블록 3 의견/), { target: { value: "   " } });
    click("반려 확정");
    expect(await screen.findByText("의견은 공백만으로 입력할 수 없습니다.")).toBeTruthy();
    click("이전 페이지");
    click("다음 페이지");
    expect((screen.getByLabelText(/블록 3 의견/) as HTMLTextAreaElement).value).toBe("   ");
  });

  test("the operator's overview detail pages through the blocks and shows remarks on their page", async () => {
    server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [{ versionNo: 1, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: rejected }] }),
      "GET /api/episodes/7/publication": () => json(200, { current: null, held: null, history: [] }),
      "GET /api/episodes/7/translations/1": () => json(200, { versionNo: 1, status: "REJECTED", sourceVersion: 3, createdAt: T, submittedAt: T, decision: rejected, invalidatedAt: null, blocks: blocks(["가", "나", "다", "라"]), blockComments: [{ seq: 3, text: "2쪽 의견", createdAt: T }] }),
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    fireEvent.click(await screen.findByRole("button", { name: "번역 v1 보기" }));
    const region = within(await screen.findByRole("region", { name: "번역 v1 내용" }));
    expect(region.queryByText(/감수 의견: 2쪽 의견/)).toBeNull();
    fireEvent.click(region.getByRole("button", { name: "다음 페이지" }));
    expect(region.getByText(/감수 의견: 2쪽 의견/)).toBeTruthy();
  });
});

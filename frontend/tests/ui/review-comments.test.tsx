import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import ReviewDetailPage from "@/app/(auth)/reviews/[episodeId]/[versionNo]/page";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import type { Role } from "@/lib/auth/types";
import { errorBody, json, meBody, mockFetch, renderWithAuth, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { episodeId: "7", versionNo: "2", id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-07T01:00:00.123456Z";
const rejected = { decision: "REJECTED", decidedAt: T, reason: "전체적으로 어색합니다" };
const blocks = [
  { seq: 1, pageNo: null, source: "원문 하나", text: "번역 하나" },
  { seq: 2, pageNo: null, source: "원문 둘", text: "번역 둘" },
  { seq: 3, pageNo: null, source: "원문 셋", text: "번역 셋" },
];
const review = (status: string, extra: Record<string, unknown> = {}) =>
  ({ versionNo: 2, status, sourceVersion: 3, submittedAt: T, decidable: status === "REVIEW_PENDING", decision: null, blocks, blockComments: [], ...extra });
const remarks = [{ seq: 1, text: "1번 블록 어투 수정\n(두 줄)", createdAt: T }, { seq: 3, text: "<b>3번</b> 오역", createdAt: T }];

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

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.params = { episodeId: "7", versionNo: "2", id: "7" }; });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const posts = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");
const REV = "/api/my/episodes/7/reviews/2";

describe("reviewer: remarks on a rejection", () => {
  async function open(extra: Record<string, H> = {}) {
    const api = server("REVIEWER", { [`GET ${REV}`]: () => json(200, review("REVIEW_PENDING")), ...extra });
    renderWithAuth(<ReviewDetailPage />);
    await screen.findByRole("heading", { name: "번역 v2 검토" });
    return api;
  }

  test("remark fields only appear in reject mode, one per block, and are optional", async () => {
    const { calls } = await open({ [`POST ${REV}/reject`]: () => json(200, { versionNo: 2, status: "REJECTED", decidedAt: T }) });
    expect(screen.queryByLabelText(/블록 1 의견/)).toBeNull();
    click("반려");
    expect(screen.getByLabelText(/블록 1 의견/)).toBeTruthy();
    expect(screen.getByLabelText(/블록 3 의견/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유만" } });
    click("반려 확정");
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(JSON.parse(posts(calls)[0].body!)).toEqual({ reason: "사유만" }); // no comments key at all
  });

  test("remarks are sent exactly as typed, only for blocks that have one, then cleared", async () => {
    let done = false;
    const { calls } = await open({
      [`POST ${REV}/reject`]: () => { done = true; return json(200, { versionNo: 2, status: "REJECTED", decidedAt: T }); },
      [`GET ${REV}`]: () => json(200, done ? review("REJECTED", { decision: rejected, blockComments: remarks }) : review("REVIEW_PENDING")),
    });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "전체적으로 어색합니다" } });
    fireEvent.change(screen.getByLabelText(/블록 1 의견/), { target: { value: "  1번 의견\n둘째 줄  " } });
    fireEvent.change(screen.getByLabelText(/블록 3 의견/), { target: { value: "3번 의견" } });
    expect(screen.getByText(/블록별 의견 2개/)).toBeTruthy();
    click("반려 확정");
    expect(await screen.findByText(/번역을 반려했습니다/)).toBeTruthy();
    expect(JSON.parse(posts(calls)[0].body!)).toEqual({
      reason: "전체적으로 어색합니다", comments: [{ seq: 1, text: "  1번 의견\n둘째 줄  " }, { seq: 3, text: "3번 의견" }],
    });
    // the decided, read-only page shows the remarks next to their blocks, as plain text
    expect(await screen.findByText("반려됨")).toBeTruthy();
    expect(screen.queryByLabelText(/블록 1 의견/)).toBeNull();
    expect(screen.getByText(/감수 의견: <b>3번<\/b> 오역/)).toBeTruthy();
    expect(screen.getByText(/감수 의견: 1번 블록 어투 수정/)).toBeTruthy();
  });

  test("an invalid remark (whitespace only, 301 chars) is rejected locally with the block named; nothing is sent and input stays", async () => {
    const { calls } = await open();
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    fireEvent.change(screen.getByLabelText(/블록 1 의견/), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/블록 2 의견/), { target: { value: "가".repeat(301) } });
    fireEvent.change(screen.getByLabelText(/블록 3 의견/), { target: { value: "정상 의견" } });
    click("반려 확정");
    expect(await screen.findByText("의견은 공백만으로 입력할 수 없습니다.")).toBeTruthy();
    expect(screen.getByText("의견은 300자 이하여야 합니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
    expect((screen.getByLabelText(/블록 3 의견/) as HTMLTextAreaElement).value).toBe("정상 의견");
    // fixing one field clears only its error
    fireEvent.change(screen.getByLabelText(/블록 1 의견/), { target: { value: "고침" } });
    expect(screen.queryByText("의견은 공백만으로 입력할 수 없습니다.")).toBeNull();
    expect(screen.getByText("의견은 300자 이하여야 합니다.")).toBeTruthy();
  });

  test("more than 50 remarks is refused locally", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ seq: i + 1, pageNo: null, source: `s${i + 1}`, text: `t${i + 1}` }));
    const { calls } = await open({ [`GET ${REV}`]: () => json(200, review("REVIEW_PENDING", { blocks: many })) });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    for (let i = 1; i <= 51; i++) fireEvent.change(screen.getByLabelText(new RegExp(`블록 ${i} 의견`)), { target: { value: `의견 ${i}` } });
    click("반려 확정");
    expect(await screen.findByText("의견은 최대 50개까지 남길 수 있습니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  test("a failed rejection keeps both the reason and every remark", async () => {
    await open({ [`POST ${REV}/reject`]: () => json(503, errorBody("SERVICE_UNAVAILABLE")) });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "내 사유" } });
    fireEvent.change(screen.getByLabelText(/블록 2 의견/), { target: { value: "내 의견" } });
    click("반려 확정");
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    expect((screen.getByLabelText(/반려 사유/) as HTMLTextAreaElement).value).toBe("내 사유");
    expect((screen.getByLabelText(/블록 2 의견/) as HTMLTextAreaElement).value).toBe("내 의견");
  });

  test("approval never offers remark fields", async () => {
    await open();
    click("승인");
    expect(screen.queryByLabelText(/의견/)).toBeNull();
  });
});

describe("translator: remarks of the reviewer", () => {
  const episode = { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } };
  const summary = (versionNo: number, status: string, decision: unknown = null) => ({ versionNo, status, sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision });
  const detail = (versionNo: number, status: string, editable: boolean, extra: Record<string, unknown> = {}) =>
    ({ ...summary(versionNo, status, status === "REJECTED" ? rejected : null), editable, blocks, blockComments: [], ...extra });

  test("a rejected version shows each remark next to its block as plain text", async () => {
    server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(1, "REJECTED", rejected)] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REJECTED", false, { blockComments: remarks })),
    });
    const { container } = renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/감수 의견: 1번 블록 어투 수정/)).toBeTruthy();
    expect(screen.getByText(/감수 의견: <b>3번<\/b> 오역/)).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });

  test("while a new draft is edited, the latest rejection's remarks stay readable in their own area", async () => {
    const { calls } = server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT"), summary(1, "REJECTED", rejected)] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", true)),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REJECTED", false, { blockComments: remarks })),
    });
    renderWithAuth(<AssignedDetailPage />);
    const area = within(await screen.findByRole("region", { name: "직전 반려 의견" }));
    expect(area.getByText("직전 반려 의견 (v1)")).toBeTruthy();
    expect(area.getByText(/<b>3번<\/b> 오역/)).toBeTruthy();
    expect(screen.getAllByLabelText(/번역$/).length).toBeGreaterThan(0); // the draft is still editable
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0);
  });

  test("no area when the rejection had no remarks, and a failing lookup of it does not break the draft", async () => {
    server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT"), summary(1, "REJECTED", rejected)] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", true)),
      "GET /api/my/episodes/7/translations/1": () => json(503, errorBody("SERVICE_UNAVAILABLE")),
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByLabelText("블록 1 번역")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "직전 반려 의견" })).toBeNull();
  });
});

describe("operator: remarks in the overview detail", () => {
  test("the opened rejected version shows its remarks next to the blocks", async () => {
    server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [{ versionNo: 1, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: rejected }] }),
      "GET /api/episodes/7/publication": () => json(200, { current: null, held: null, history: [] }),
      "GET /api/episodes/7/translations/1": () => json(200, { versionNo: 1, status: "REJECTED", sourceVersion: 3, createdAt: T, submittedAt: T, decision: rejected, invalidatedAt: null, blocks, blockComments: remarks }),
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    click2("번역 v1 보기");
    const region = within(await screen.findByRole("region", { name: "번역 v1 내용" }));
    expect(region.getByText(/감수 의견: 1번 블록 어투 수정/)).toBeTruthy();
    expect(region.getByText(/감수 의견: <b>3번<\/b> 오역/)).toBeTruthy();
  });
});

async function click2(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

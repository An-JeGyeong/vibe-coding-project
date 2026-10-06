import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import ReviewDetailPage from "@/app/(auth)/reviews/[episodeId]/[versionNo]/page";
import ReviewsPage from "@/app/(auth)/reviews/page";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { episodeId: "7", versionNo: "2", id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-06T01:00:00.123456Z";
const approved = { decision: "APPROVED", decidedAt: T, reason: null };
const rejected = { decision: "REJECTED", decidedAt: T, reason: "3번 블록 번역이\n어색합니다" };
const blocks = [{ seq: 1, pageNo: 1, source: "원문 하나", text: "번역 하나" }, { seq: 2, pageNo: null, source: "원문 둘", text: null }];
const review = (status: string, decision: unknown = null, decidable = status === "REVIEW_PENDING") =>
  ({ versionNo: 2, status, sourceVersion: 3, submittedAt: T, decidable, decision, blocks });
const pendingItem = (episodeId: string, versionNo: number) => ({ episodeId, title: `회차 ${episodeId}`, versionNo, sourceVersion: 3, submittedAt: T });

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
const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.path !== "/api/auth/me");
const posts = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");
const REV = "/api/my/episodes/7/reviews/2";

describe("pending reviews list (reviewer)", () => {
  test("shows the pending translations with links to the review page", async () => {
    server("REVIEWER", { "GET /api/my/reviews": () => json(200, { items: [pendingItem("7", 2), pendingItem("9", 1)], total: 2 }) });
    renderWithAuth(<ReviewsPage />);
    const link = await screen.findAllByRole("link", { name: /검토/ });
    expect(link.map((a) => a.getAttribute("href"))).toEqual(["/reviews/7/2", "/reviews/9/1"]);
    expect(screen.getByText("회차 7")).toBeTruthy();
  });

  test("empty list, pagination, 503 retry and 401", async () => {
    server("REVIEWER", { "GET /api/my/reviews": () => json(200, { items: [], total: 0 }) });
    const first = renderWithAuth(<ReviewsPage />);
    expect(await screen.findByText("검수를 기다리는 번역이 없습니다.")).toBeTruthy();
    first.unmount();

    const { calls } = server("REVIEWER", { "GET /api/my/reviews": () => json(200, { items: Array.from({ length: 20 }, (_, i) => pendingItem(String(i + 1), 1)), total: 45 }) });
    renderWithAuth(<ReviewsPage />);
    await screen.findAllByRole("link", { name: /검토/ });
    click("다음");
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/my/reviews?limit=20&offset=20"))).toBe(true));
  });

  test("a 503 keeps the session and offers a retry; a 401 signs out", async () => {
    let healthy = false;
    server("REVIEWER", { "GET /api/my/reviews": () => (healthy ? json(200, { items: [pendingItem("7", 2)], total: 1 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    const view = renderWithAuth(<ReviewsPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("link", { name: /검토/ })).toBeTruthy();
    view.unmount();
    server("REVIEWER", { "GET /api/my/reviews": () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<ReviewsPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test.each(["TRANSLATOR", "OPERATOR", "READER"] as const)("%s sees a notice and no request is sent", async (role) => {
    const { calls } = server(role, { "GET /api/my/reviews": () => json(200, { items: [], total: 0 }) });
    renderWithAuth(<ReviewsPage />);
    expect(await screen.findByText(/검수는 감수자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
    expect(storedToken()).not.toBeNull();
  });
});

describe("review page: reading", () => {
  test("shows source and translation side by side, read only, with the decision buttons when decidable", async () => {
    server("REVIEWER", { [`GET ${REV}`]: () => json(200, review("REVIEW_PENDING")) });
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByRole("heading", { name: "번역 v2 검토" })).toBeTruthy();
    expect(screen.getByText("원문 하나")).toBeTruthy();
    expect(screen.getByText("번역 하나")).toBeTruthy();
    expect(screen.getByText("p.1")).toBeTruthy();
    expect(screen.getByText("(번역 없음)")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "승인" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "반려" })).toBeTruthy();
  });

  test("an already decided version shows the outcome and offers no decision", async () => {
    server("REVIEWER", { [`GET ${REV}`]: () => json(200, review("REJECTED", rejected)) });
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByText("반려됨")).toBeTruthy();
    expect(screen.getByText(/반려 사유: 3번 블록 번역이/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "반려" })).toBeNull();
  });

  test("an invalidated or unknown version (404) shows one neutral notice and no content", async () => {
    server("REVIEWER", { [`GET ${REV}`]: () => json(404, errorBody("NOT_FOUND")) });
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 항목입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "검수 대기 목록으로" }).getAttribute("href")).toBe("/reviews");
    expect(screen.queryByText("원문 하나")).toBeNull();
  });

  test("an invalid version number never calls the API", async () => {
    nav.params = { episodeId: "7", versionNo: "abc", id: "7" };
    const { calls } = server("REVIEWER", {});
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 항목입니다.")).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });

  test("a translator, operator or reader sees a notice and no request is sent", async () => {
    for (const role of ["TRANSLATOR", "OPERATOR", "READER"] as const) {
      const { calls } = server(role, { [`GET ${REV}`]: () => json(200, review("REVIEW_PENDING")) });
      const view = renderWithAuth(<ReviewDetailPage />);
      expect(await screen.findByText(/검수는 감수자만 사용할 수 있습니다/)).toBeTruthy();
      expect(apiCalls(calls)).toHaveLength(0);
      view.unmount();
    }
  });
});

describe("review page: deciding", () => {
  async function open(extra: Record<string, H> = {}, role: Role = "REVIEWER") {
    const api = server(role, { [`GET ${REV}`]: () => json(200, review("REVIEW_PENDING")), ...extra });
    renderWithAuth(<ReviewDetailPage />);
    await screen.findByRole("heading", { name: "번역 v2 검토" });
    return api;
  }

  test("approval needs a confirmation, sends no body, then shows the recorded decision", async () => {
    let decided = false;
    const { calls } = await open({
      [`POST ${REV}/approve`]: () => { decided = true; return json(200, { versionNo: 2, status: "APPROVED", decidedAt: T }); },
      [`GET ${REV}`]: () => json(200, decided ? review("APPROVED", approved) : review("REVIEW_PENDING")),
    });
    click("승인");
    expect(screen.getByText("승인하면 되돌릴 수 없습니다. 승인할까요?")).toBeTruthy();
    click("취소");
    expect(posts(calls)).toHaveLength(0);
    click("승인");
    click("승인 확정");
    expect(await screen.findByText("번역을 승인했습니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toBeUndefined();
    expect(await screen.findByText("승인됨")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
  });

  test("a rejection needs a reason (validated locally), is sent exactly as typed, then shows the reason", async () => {
    let decided = false;
    const { calls } = await open({
      [`POST ${REV}/reject`]: () => { decided = true; return json(200, { versionNo: 2, status: "REJECTED", decidedAt: T }); },
      [`GET ${REV}`]: () => json(200, decided ? review("REJECTED", rejected) : review("REVIEW_PENDING")),
    });
    click("반려");
    click("반려 확정");
    expect(await screen.findByText("반려 사유를 입력하세요.")).toBeTruthy();
    const box = screen.getByLabelText(/반려 사유/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "가".repeat(501) } });
    click("반려 확정");
    expect((await screen.findAllByText(/500자 이하/)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("alert").some((el) => /500자 이하/.test(el.textContent ?? ""))).toBe(true);
    expect(posts(calls)).toHaveLength(0);
    fireEvent.change(box, { target: { value: "  3번 블록 번역이\n어색합니다  " } });
    click("반려 확정");
    expect(await screen.findByText(/번역을 반려했습니다/)).toBeTruthy();
    expect(JSON.parse(posts(calls)[0].body!)).toEqual({ reason: "  3번 블록 번역이\n어색합니다  " });
    expect(await screen.findByText("반려됨")).toBeTruthy();
  });

  test("double click on the confirmation sends one request", async () => {
    const pending = deferred<Response>();
    const { calls } = await open({ [`POST ${REV}/approve`]: () => pending.promise });
    click("승인");
    click("승인 확정");
    fireEvent.click(screen.getByRole("button", { name: "처리 중…" }));
    expect(posts(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, { versionNo: 2, status: "APPROVED", decidedAt: T })); });
    expect(await screen.findByText("번역을 승인했습니다.")).toBeTruthy();
  });

  test("a state conflict (source changed meanwhile) explains it and reloads without the decision buttons", async () => {
    let invalid = false;
    await open({
      [`POST ${REV}/approve`]: () => { invalid = true; return json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }); },
      [`GET ${REV}`]: () => json(200, invalid ? review("INVALIDATED", null, false) : review("REVIEW_PENDING")),
    });
    click("승인");
    click("승인 확정");
    expect(await screen.findByText(/원문이 변경되어 이 번역은 무효화되었습니다. 더 이상 승인하거나 반려할 수 없습니다/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "승인" })).toBeNull());
    expect(screen.queryByText(/새 번역을 시작하세요/)).toBeNull();
  });

  test("after a conflict the reload is a 404: the conflict explanation stays visible next to the neutral notice", async () => {
    let invalid = false;
    await open({
      [`POST ${REV}/approve`]: () => { invalid = true; return json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }); },
      [`GET ${REV}`]: () => (invalid ? json(404, errorBody("NOT_FOUND")) : json(200, review("REVIEW_PENDING"))),
    });
    click("승인");
    click("승인 확정");
    expect(await screen.findByText(/원문이 변경되어 이 번역은 무효화되었습니다/)).toBeTruthy();
    expect(screen.getByText("배정되지 않았거나 존재하지 않는 항목입니다.")).toBeTruthy();
    expect(screen.queryByText("원문 하나")).toBeNull();
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
  });

  test("a 404 on the decision (e.g. replaced reviewer) removes the translation and the buttons at once, without a reload", async () => {
    const { calls } = await open({ [`POST ${REV}/reject`]: () => json(404, errorBody("NOT_FOUND")) });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    click("반려 확정");
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 항목입니다.")).toBeTruthy();
    expect(screen.queryByText("원문 하나")).toBeNull();
    expect(screen.queryByRole("button", { name: /반려|승인/ })).toBeNull();
    expect(calls.filter((call) => call.method === "GET" && call.path === REV)).toHaveLength(1);
  });

  test("an already processed version (409) points to the result", async () => {
    await open({ [`POST ${REV}/reject`]: () => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "APPROVED" } }) });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "사유" } });
    click("반려 확정");
    expect(await screen.findByText("이미 처리된 번역입니다. 새로고침해 결과를 확인하세요.")).toBeTruthy();
  });

  test.each([
    ["403", () => json(403, errorBody("FORBIDDEN")), /권한이 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed rejection (%s) keeps the typed reason and the login", async (_name, respond, expected) => {
    await open({ [`POST ${REV}/reject`]: respond });
    click("반려");
    fireEvent.change(screen.getByLabelText(/반려 사유/), { target: { value: "내가 쓴 사유" } });
    click("반려 확정");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect((screen.getByLabelText(/반려 사유/) as HTMLTextAreaElement).value).toBe("내가 쓴 사유");
    expect(storedToken()).not.toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  test("401 on a decision signs out", async () => {
    await open({ [`POST ${REV}/approve`]: () => json(401, errorBody("AUTH_REQUIRED")) });
    click("승인");
    click("승인 확정");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });
});

describe("reviewer's version list on /assigned/{id}", () => {
  const episode = { id: "7", title: "1화", assignedRole: "REVIEWER", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } };

  test("lists the reviewable versions with their decisions and links to the review page, and never calls translator APIs", async () => {
    const { calls } = server("REVIEWER", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/reviews": () => json(200, { latestSourceVersion: 3, items: [
        { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decision: null },
        { versionNo: 1, status: "REJECTED", sourceVersion: 2, submittedAt: T, decision: rejected },
      ] }),
    });
    renderWithAuth(<AssignedDetailPage />);
    const panel = within(await screen.findByRole("region", { name: "검수 버전" }));
    expect((await panel.findAllByRole("link", { name: /검토/ })).map((a) => a.getAttribute("href"))).toEqual(["/reviews/7/2", "/reviews/7/1"]);
    expect(panel.getByText("원문 v3 (최신)")).toBeTruthy();
    expect(panel.getByText("원문 v2 (이전)")).toBeTruthy();
    expect(panel.getByText("반려")).toBeTruthy();
    expect(calls.filter((call) => call.path.includes("/translations"))).toHaveLength(0);
  });

  test("with nothing submitted yet it says so", async () => {
    server("REVIEWER", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/reviews": () => json(200, { latestSourceVersion: 3, items: [] }),
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/검수할 번역이 아직 없습니다/)).toBeTruthy();
  });
});

describe("operator's translation overview", () => {
  const list = { latestSourceVersion: 3, items: [
    { versionNo: 3, status: "DRAFT", sourceVersion: 3, revision: 2, createdAt: T, submittedAt: null, decision: null },
    { versionNo: 2, status: "INVALIDATED", sourceVersion: 2, revision: 1, createdAt: T, submittedAt: T, decision: approved },
    { versionNo: 1, status: "REJECTED", sourceVersion: 1, revision: 1, createdAt: T, submittedAt: T, decision: rejected },
  ] };
  const detail = (versionNo: number, extra: Record<string, unknown> = {}) =>
    ({ versionNo, status: "REJECTED", sourceVersion: 1, createdAt: T, submittedAt: T, decision: rejected, invalidatedAt: null, blocks, ...extra });

  async function open(routes: Record<string, H> = {}, role: Role = "OPERATOR") {
    const api = server(role, { "GET /api/episodes/7/translations": () => json(200, list), ...routes });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    return api;
  }

  test("lists every state including drafts, with the decision column", async () => {
    await open();
    await screen.findByText("작성 중");
    expect(screen.getByText("무효화됨")).toBeTruthy();
    expect(screen.getByText("반려됨")).toBeTruthy();
    expect(screen.getByText("원문 v3 (최신)")).toBeTruthy();
    expect(screen.getByText("원문 v2 (이전)")).toBeTruthy();
  });

  test("viewing a version shows source and translation, the decision with its reason and the invalidation time", async () => {
    await open({
      "GET /api/episodes/7/translations/2": () => json(200, detail(2, { status: "INVALIDATED", decision: approved, invalidatedAt: T })),
      "GET /api/episodes/7/translations/1": () => json(200, detail(1)),
    });
    await screen.findByText("작성 중");
    click("번역 v2 보기");
    const region = within(await screen.findByRole("region", { name: "번역 v2 내용" }));
    expect(region.getByText("승인됨")).toBeTruthy();
    expect(region.getByText(/무효화 시각/)).toBeTruthy();
    expect(region.getByText("원문 하나")).toBeTruthy();
    click("번역 v1 보기");
    const second = within(await screen.findByRole("region", { name: "번역 v1 내용" }));
    expect(second.getByText(/반려 사유: 3번 블록 번역이/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("a late response of an earlier click does not replace the latest one", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    await open({
      "GET /api/episodes/7/translations/2": () => first.promise,
      "GET /api/episodes/7/translations/1": () => second.promise,
    });
    await screen.findByText("작성 중");
    click("번역 v2 보기");
    click("번역 v1 보기");
    await act(async () => { second.resolve(json(200, detail(1))); });
    expect(await screen.findByRole("region", { name: "번역 v1 내용" })).toBeTruthy();
    await act(async () => { first.resolve(json(200, detail(2, { status: "INVALIDATED", decision: approved }))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole("region", { name: "번역 v1 내용" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "번역 v2 내용" })).toBeNull();
  });

  test("failures are fixed messages; a non-operator never mounts the panel", async () => {
    server("OPERATOR", { "GET /api/episodes/7/translations": () => json(503, errorBody("SERVICE_UNAVAILABLE")) });
    const view = renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    view.unmount();
    const { calls } = server("TRANSLATOR", { "GET /api/episodes/7/translations": () => json(200, list) });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

describe("translator sees the decision", () => {
  test("a rejected version shows its reason in the table and the detail", async () => {
    server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } }),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [{ versionNo: 1, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: rejected }] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, { versionNo: 1, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, editable: false, decision: rejected,
        blocks: [{ seq: 1, pageNo: null, source: "원문", text: "번역" }] }),
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/반려 사유: 3번 블록 번역이/)).toBeTruthy();
    expect(screen.getByText("반려", { selector: "td" })).toBeTruthy();
    expect(screen.getByText("사유: 3번 블록 번역이 어색합니다")).toBeTruthy(); // one-line summary in the version table
    expect(screen.getByRole("button", { name: "새 번역 시작" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

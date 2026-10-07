import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import ReadPage from "@/app/(public)/read/page";
import ReadEpisodePage from "@/app/(public)/read/[id]/page";
import { DashboardCards } from "@/components/DashboardCards";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import type { Role } from "@/lib/auth/types";
import { POSITION_KEY } from "@/lib/reader/position";
import { errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-07T01:00:00.123456Z";
const rejected = { decision: "REJECTED", decidedAt: T, reason: "사유" };
const approved = { decision: "APPROVED", decidedAt: T, reason: null };
const srcBlocks = (texts: (string | null)[]) => texts.map((text, i) => ({ seq: i + 1, pageNo: null, source: `원문 ${i + 1}`, text }));

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role | null, routes: Record<string, H> = {}) {
  if (role) storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role ?? "OPERATOR"));
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.path !== "/api/auth/me");

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.params = { id: "7" }; });

describe("translator: progress and version compare", () => {
  const episode = { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } };
  const summary = (versionNo: number, status: string, decision: unknown = null) => ({ versionNo, status, sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision });
  const detail = (versionNo: number, status: string, texts: (string | null)[], extra: Record<string, unknown> = {}) =>
    ({ ...summary(versionNo, status, status === "REJECTED" ? rejected : null), editable: status === "DRAFT", blocks: srcBlocks(texts), blockComments: [], ...extra });

  function open(routes: Record<string, H> = {}) {
    const api = server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT"), summary(1, "REJECTED", rejected)] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", ["새 번역 1", null, null])),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REJECTED", ["옛 번역 1", "옛 번역 2", "옛 번역 3"], { blockComments: [{ seq: 2, text: "2번이 어색", createdAt: T }] })),
      ...routes,
    });
    renderWithAuth(<AssignedDetailPage />);
    return api;
  }

  test("progress follows what is typed, and says so when it includes unsaved input", async () => {
    open();
    const bar = await screen.findByRole("progressbar", { name: "번역 진행률" });
    expect(bar.getAttribute("aria-valuenow")).toBe("33");
    expect(screen.getByText("1/3 블록 (33%)")).toBeTruthy();
    expect(screen.queryByText(/저장하지 않은 변경 포함/)).toBeNull();
    fireEvent.change(screen.getByLabelText("블록 2 번역"), { target: { value: "둘째" } });
    expect(screen.getByRole("progressbar", { name: "번역 진행률" }).getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText(/2\/3 블록 \(67%\)/)).toBeTruthy();
    expect(screen.getByText(/저장하지 않은 변경 포함/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("블록 2 번역"), { target: { value: "   " } });
    expect(screen.getByRole("progressbar", { name: "번역 진행률" }).getAttribute("aria-valuenow")).toBe("33");
  });

  test("compare defaults to the rejected version and the next one, uses only the translator API and shows the old remark", async () => {
    const { calls } = open();
    await screen.findByRole("region", { name: "버전 비교" });
    expect((screen.getByLabelText("이전 버전") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText("새 버전") as HTMLSelectElement).value).toBe("2");
    click("비교");
    const area = within(await screen.findByRole("region", { name: "버전 비교" }));
    expect(await area.findByText("변경 3 · 추가 0 · 삭제 0 · 같음 0")).toBeTruthy();
    expect(area.getByText("이전 버전 감수 의견: 2번이 어색")).toBeTruthy();
    expect(area.getAllByText("변경됨")).toHaveLength(3);
    expect(apiCalls(calls).every((call) => call.path.startsWith("/api/my/episodes/7"))).toBe(true);
    expect(calls.some((call) => call.path.includes("/reviews") || call.path.startsWith("/api/episodes"))).toBe(false);
  });

  test("the same version twice is explained and sends nothing; changed-only filter hides equal blocks", async () => {
    const { calls } = open({
      "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", ["옛 번역 1", "바뀜", "옛 번역 3"])),
    });
    await screen.findByRole("region", { name: "버전 비교" });
    const before = calls.length;
    fireEvent.change(screen.getByLabelText("새 버전"), { target: { value: "1" } });
    click("비교");
    expect(await screen.findByText("서로 다른 두 버전을 선택하세요.")).toBeTruthy();
    expect(calls.length).toBe(before);
    fireEvent.change(screen.getByLabelText("새 버전"), { target: { value: "2" } });
    click("비교");
    const area = within(screen.getByRole("region", { name: "버전 비교" }));
    expect(await area.findByText("변경 1 · 추가 0 · 삭제 0 · 같음 2")).toBeTruthy();
    expect(area.getAllByText("같음")).toHaveLength(2);
    fireEvent.click(area.getByLabelText("변경된 블록만 보기"));
    expect(area.queryAllByText("같음")).toHaveLength(0);
    expect(area.getAllByText("변경됨")).toHaveLength(1);
  });

  test("when one of the two versions fails to load, no partial result is shown and a retry is offered", async () => {
    let healthy = false;
    open({ "GET /api/my/episodes/7/translations/1": () => (healthy ? json(200, detail(1, "REJECTED", ["가", "나", "다"])) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    await screen.findByRole("region", { name: "버전 비교" });
    click("비교");
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/변경 \d+ · 추가/)).toBeNull();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByText(/변경 \d+ · 추가/)).toBeTruthy();
  });

  test("a basis-source difference is announced", async () => {
    open({ "GET /api/my/episodes/7/translations/1": () => json(200, { ...detail(1, "REJECTED", ["가", "나", "다"]), sourceVersion: 2 }) });
    await screen.findByRole("region", { name: "버전 비교" });
    click("비교");
    expect(await screen.findByText("기준 원문이 다릅니다(v2 / v3).")).toBeTruthy();
  });

  test("with a single version there is no compare area", async () => {
    open({ "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT")] }) });
    await screen.findByRole("progressbar", { name: "번역 진행률" });
    expect(screen.queryByRole("region", { name: "버전 비교" })).toBeNull();
  });
});

describe("reviewer and operator: compare with their own API", () => {
  test("reviewer compares the versions it can see and never calls the translator API", async () => {
    const episode = { id: "7", title: "1화", assignedRole: "REVIEWER", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } };
    const review = (versionNo: number, status: string, texts: string[], extra = {}) => ({ versionNo, status, sourceVersion: 3, submittedAt: T, decidable: false, decision: status === "REJECTED" ? rejected : null, blocks: srcBlocks(texts), blockComments: [], ...extra });
    const { calls } = server("REVIEWER", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/reviews": () => json(200, { latestSourceVersion: 3, items: [
        { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decision: null }, { versionNo: 1, status: "REJECTED", sourceVersion: 3, submittedAt: T, decision: rejected }] }),
      "GET /api/my/episodes/7/reviews/1": () => json(200, review(1, "REJECTED", ["a", "b"], { blockComments: [{ seq: 1, text: "1번 의견", createdAt: T }] })),
      "GET /api/my/episodes/7/reviews/2": () => json(200, review(2, "REVIEW_PENDING", ["a", "b2"])),
    });
    renderWithAuth(<AssignedDetailPage />);
    const area = within(await screen.findByRole("region", { name: "버전 비교" }));
    fireEvent.click(area.getByRole("button", { name: "비교" }));
    expect(await area.findByText("변경 1 · 추가 0 · 삭제 0 · 같음 1")).toBeTruthy();
    expect(area.getByText("이전 버전 감수 의견: 1번 의견")).toBeTruthy();
    expect(calls.some((call) => call.path.includes("/translations"))).toBe(false);
  });

  test("operator compares via the operator API and the compare is reset after a source save", async () => {
    const op = (versionNo: number, status: string, texts: string[]) => ({ versionNo, status, sourceVersion: 3, createdAt: T, submittedAt: T, decision: approved, invalidatedAt: null, blocks: srcBlocks(texts), blockComments: [] });
    const { calls } = server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [
        { versionNo: 2, status: "APPROVED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: approved }, { versionNo: 1, status: "REJECTED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: rejected }] }),
      "GET /api/episodes/7/publication": () => json(200, { current: null, held: null, history: [] }),
      "GET /api/episodes/7/translations/1": () => json(200, op(1, "REJECTED", ["a"])),
      "GET /api/episodes/7/translations/2": () => json(200, op(2, "APPROVED", ["a", "새 블록"])),
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    const area = within(await screen.findByRole("region", { name: "버전 비교" }));
    fireEvent.click(area.getByRole("button", { name: "비교" }));
    expect(await area.findByText("변경 0 · 추가 1 · 삭제 0 · 같음 1")).toBeTruthy();
    expect(area.getByText("추가됨")).toBeTruthy();
    expect(apiCalls(calls).every((call) => call.path.startsWith("/api/episodes/7"))).toBe(true);
  });
});

describe("reader: search, neighbours and reading position (public API only)", () => {
  const eps = [{ episodeId: "1", title: "Hello World", publishedAt: T }, { episodeId: "2", title: "둘째 회차", publishedAt: T }, { episodeId: "3", title: "hello again", publishedAt: T }];
  const listBody = (call: FetchCall) => {
    const params = new URL(call.url).searchParams;
    const limit = Number(params.get("limit"));
    const offset = Number(params.get("offset"));
    return json(200, { items: eps.slice(offset, offset + limit), total: eps.length });
  };
  const blocks = [{ seq: 1, pageNo: 1, text: "첫째" }, { seq: 2, pageNo: null, text: "둘째" }];
  const detailBody = { episodeId: "2", title: "둘째 회차", publishedAt: T, blocks };

  test("a title search loads the whole list once, filters case-insensitively and needs no login", async () => {
    const { calls } = mockFetch((call) => (call.path === "/api/public/episodes" ? listBody(call) : json(404, errorBody("NOT_FOUND"))));
    render(<ReadPage />);
    await screen.findAllByRole("link");
    fireEvent.change(screen.getByLabelText("제목 검색"), { target: { value: " HELLO " } });
    await waitFor(() => expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Hello World", "hello again"]));
    fireEvent.change(screen.getByLabelText("제목 검색"), { target: { value: "hello w" } });
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Hello World"]);
    fireEvent.change(screen.getByLabelText("제목 검색"), { target: { value: "없는 제목" } });
    expect(screen.getByText("검색 결과가 없습니다.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("제목 검색"), { target: { value: "" } });
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(calls.filter((call) => new URL(call.url).searchParams.get("limit") === "100")).toHaveLength(1); // loaded once, reused
    expect(calls.every((call) => call.headers.Authorization === undefined)).toBe(true);
  });

  test("a failing full load shows a retry and the normal list is untouched", async () => {
    let healthy = false;
    mockFetch((call) => (new URL(call.url).searchParams.get("limit") === "100" && !healthy ? json(503, errorBody("SERVICE_UNAVAILABLE")) : listBody(call)));
    render(<ReadPage />);
    await screen.findAllByRole("link");
    fireEvent.change(screen.getByLabelText("제목 검색"), { target: { value: "둘째" } });
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    await waitFor(() => expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["둘째 회차"]));
  });

  test("previous and next episode links come from the public list; a failing list only hides them", async () => {
    nav.params = { id: "2" };
    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, detailBody) : listBody(call)));
    const first = render(<ReadEpisodePage />);
    expect((await screen.findByRole("link", { name: /이전 회차 Hello World/ })).getAttribute("href")).toBe("/read/1");
    expect(screen.getByRole("link", { name: /다음 회차 hello again/ }).getAttribute("href")).toBe("/read/3");
    first.unmount();
    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, detailBody) : json(503, errorBody("SERVICE_UNAVAILABLE"))));
    render(<ReadEpisodePage />);
    expect(await screen.findByText("둘째")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("link", { name: /이전 회차|다음 회차/ })).toBeNull();
  });

  test("'read up to here' is saved with the publication time; reopening offers to continue; a replaced publication discards it", async () => {
    nav.params = { id: "2" };
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, detailBody) : listBody(call)));
    const first = render(<ReadEpisodePage />);
    await screen.findByText("둘째");
    expect(screen.queryByRole("button", { name: /이어 읽기/ })).toBeNull();
    click("블록 2 여기까지 읽음");
    expect(JSON.parse(window.localStorage.getItem(POSITION_KEY)!)).toEqual({ 2: { seq: 2, publishedAt: T } });
    expect(screen.getByText("읽던 위치")).toBeTruthy();
    first.unmount();

    render(<ReadEpisodePage />);
    fireEvent.click(await screen.findByRole("button", { name: "이어 읽기: 블록 2로 이동" }));
    expect(scroll).toHaveBeenCalled();
    cleanupAll();

    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, { ...detailBody, publishedAt: "2026-10-08T00:00:00.000000Z" }) : listBody(call)));
    render(<ReadEpisodePage />);
    await screen.findByText("둘째");
    expect(screen.queryByRole("button", { name: /이어 읽기/ })).toBeNull();
    expect(window.localStorage.getItem(POSITION_KEY)).toBe("{}");
  });

  test("the reader works when storage is blocked, and the list marks episodes with a saved position", async () => {
    nav.params = { id: "2" };
    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, detailBody) : listBody(call)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const first = render(<ReadEpisodePage />);
    await screen.findByText("둘째");
    click("블록 1 여기까지 읽음");
    expect(screen.getByText("읽던 위치")).toBeTruthy(); // the page still reacts
    first.unmount();
    vi.restoreAllMocks();
    window.localStorage.setItem(POSITION_KEY, JSON.stringify({ 2: { seq: 1, publishedAt: T }, 3: { seq: 1, publishedAt: "2020-01-01T00:00:00.000000Z" } }));
    mockFetch(listBody);
    render(<ReadPage />);
    await screen.findAllByRole("link");
    expect(screen.getAllByText("이어 읽기")).toHaveLength(1);
  });
});

function cleanupAll() { document.body.innerHTML = ""; }

describe("dashboard cards by role (23.4)", () => {
  test("operator card: one chip per recent episode, a failing episode only affects its own row", async () => {
    const eps = [{ id: "1", title: "1화", latestSourceVersion: 1, updatedAt: T }, { id: "2", title: "2화", latestSourceVersion: 1, updatedAt: T }, { id: "3", title: "3화", latestSourceVersion: 0, updatedAt: T }];
    const list = (status: string) => ({ latestSourceVersion: 1, items: [{ versionNo: 1, status, sourceVersion: 1, revision: 1, createdAt: T, submittedAt: T, decision: null }] });
    const entry = { versionNo: 1, sourceVersion: 1, publishedAt: T };
    const { calls } = server("OPERATOR", {
      "GET /api/episodes": () => json(200, { items: eps, total: 12 }),
      "GET /api/episodes/1/translations": () => json(200, list("APPROVED")),
      "GET /api/episodes/1/publication": () => json(200, { current: null, held: null, history: [] }),
      "GET /api/episodes/2/translations": () => json(503, errorBody("SERVICE_UNAVAILABLE")),
      "GET /api/episodes/2/publication": () => json(200, { current: null, held: null, history: [] }),
      "GET /api/episodes/3/translations": () => json(200, { latestSourceVersion: 0, items: [] }),
      "GET /api/episodes/3/publication": () => json(200, { current: entry, held: null, history: [entry] }),
    });
    renderWithAuth(<DashboardCards role="OPERATOR" />);
    const card = within(await screen.findByRole("region", { name: "회차 현황" }));
    expect(await card.findByText("발행 대기(승인됨)")).toBeTruthy();
    expect(card.getByText("불러오지 못함")).toBeTruthy();
    expect(card.getByText("공개 중")).toBeTruthy();
    expect(card.getByText("회차 12개 · 최근 3개의 진행 상태")).toBeTruthy();
    expect(card.getByRole("link", { name: "1화" }).getAttribute("href")).toBe("/episodes/1");
    expect(calls.some((call) => call.path.startsWith("/api/my/") || call.path.startsWith("/api/public/"))).toBe(false);
    expect(new URL(calls.find((call) => call.path === "/api/episodes")!.url).search).toBe("?limit=10&offset=0");
  });

  test("translator card: status of each assigned episode and the to-do counts", async () => {
    const mine = [{ id: "1", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 1, assignedAt: T, updatedAt: T }, { id: "2", title: "2화", assignedRole: "TRANSLATOR", latestSourceVersion: 1, assignedAt: T, updatedAt: T }, { id: "3", title: "3화", assignedRole: "TRANSLATOR", latestSourceVersion: 1, assignedAt: T, updatedAt: T }];
    const versions = (status: string | null) => ({ latestSourceVersion: 1, items: status ? [{ versionNo: 1, status, sourceVersion: 1, revision: 1, createdAt: T, submittedAt: T, decision: null }] : [] });
    const { calls } = server("TRANSLATOR", {
      "GET /api/my/episodes": () => json(200, { items: mine, total: 3 }),
      "GET /api/my/episodes/1/translations": () => json(200, versions("REJECTED")),
      "GET /api/my/episodes/2/translations": () => json(200, versions("DRAFT")),
      "GET /api/my/episodes/3/translations": () => json(200, versions(null)),
    });
    renderWithAuth(<DashboardCards role="TRANSLATOR" />);
    const card = within(await screen.findByRole("region", { name: "내 번역" }));
    expect(await card.findByText("반려 1건 · 작성 중 1건 · 시작 전 1건")).toBeTruthy();
    expect(card.getByText("반려됨")).toBeTruthy();
    expect(card.getByRole("link", { name: "1화" }).getAttribute("href")).toBe("/assigned/1");
    expect(calls.some((call) => call.path.startsWith("/api/episodes") || call.path.startsWith("/api/public/"))).toBe(false);
  });

  test("reviewer card: pending count with the newest links; empty means nothing to review", async () => {
    server("REVIEWER", { "GET /api/my/reviews": () => json(200, { items: [{ episodeId: "7", title: "1화", versionNo: 2, sourceVersion: 3, submittedAt: T }], total: 6 }) });
    const first = renderWithAuth(<DashboardCards role="REVIEWER" />);
    const card = within(await screen.findByRole("region", { name: "검수 대기" }));
    expect(await card.findByText("검수 대기 6건")).toBeTruthy();
    expect(card.getByRole("link", { name: "1화 · v2 검토" }).getAttribute("href")).toBe("/reviews/7/2");
    first.unmount();
    server("REVIEWER", { "GET /api/my/reviews": () => json(200, { items: [], total: 0 }) });
    renderWithAuth(<DashboardCards role="REVIEWER" />);
    expect(await screen.findByText("검수할 번역이 없습니다.")).toBeTruthy();
  });

  test("reader card: the five latest public episodes, without a token", async () => {
    const all = Array.from({ length: 8 }, (_, i) => ({ episodeId: String(i + 1), title: `회차 ${i + 1}`, publishedAt: T }));
    const { calls } = server("READER", {
      "GET /api/public/episodes": (call) => {
        const params = new URL(call.url).searchParams;
        const offset = Number(params.get("offset"));
        return json(200, { items: all.slice(offset, offset + 5), total: 8 });
      },
    });
    renderWithAuth(<DashboardCards role="READER" />);
    const card = within(await screen.findByRole("region", { name: "최근 공개 회차" }));
    await card.findByText("회차 8");
    expect(card.getAllByRole("link").map((a) => a.textContent)).toEqual(["회차 8", "회차 7", "회차 6", "회차 5", "회차 4"]);
    const publicCalls = calls.filter((call) => call.path === "/api/public/episodes");
    expect(publicCalls.map((call) => new URL(call.url).search)).toEqual(["?limit=5&offset=0", "?limit=5&offset=3"]);
    expect(publicCalls.every((call) => call.headers.Authorization === undefined)).toBe(true);
  });

  test("a failing card offers its own retry, and 401 signs out", async () => {
    let healthy = false;
    server("REVIEWER", { "GET /api/my/reviews": () => (healthy ? json(200, { items: [], total: 0 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    const first = renderWithAuth(<DashboardCards role="REVIEWER" />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByText("검수할 번역이 없습니다.")).toBeTruthy();
    first.unmount();
    server("REVIEWER", { "GET /api/my/reviews": () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<DashboardCards role="REVIEWER" />);
    await waitFor(() => expect(storedToken()).toBeNull()); // the shared auth state signs out; the page then leaves for /login
  });
});

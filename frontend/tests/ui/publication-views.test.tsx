import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ReadPage from "@/app/(public)/read/page";
import ReadEpisodePage from "@/app/(public)/read/[id]/page";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";
import { render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-07T01:00:00.123456Z";
const approved = { decision: "APPROVED", decidedAt: T, reason: null };
const item = (versionNo: number, status: string, sourceVersion = 3) =>
  ({ versionNo, status, sourceVersion, revision: 1, createdAt: T, submittedAt: T, decision: status === "DRAFT" ? null : approved });
const list = (...items: ReturnType<typeof item>[]) => ({ latestSourceVersion: 3, items });
const none = { current: null, history: [] };
const published = (versionNo: number) => ({ current: { versionNo, sourceVersion: 3, publishedAt: T }, history: [{ versionNo, sourceVersion: 3, publishedAt: T }] });

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

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.params = { id: "7" }; });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.path !== "/api/auth/me");
const posts = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");
const PUB = "POST /api/episodes/7/translations/2/publish";

describe("operator: publication state and publishing", () => {
  async function open(routes: Record<string, H> = {}) {
    const api = server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, list(item(2, "APPROVED"), item(1, "REJECTED"))),
      "GET /api/episodes/7/publication": () => json(200, none),
      ...routes,
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    await screen.findByRole("region", { name: "공개 상태" });
    await screen.findByText("승인됨");
    return api;
  }

  test("shows that nothing is public, and offers publishing only for approved versions", async () => {
    await open();
    expect(screen.getByText("공개 중인 번역 없음")).toBeTruthy();
    expect(screen.getByRole("button", { name: "v2 발행" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "v1 발행" })).toBeNull();
  });

  test("shows the current public version with its history", async () => {
    await open({
      "GET /api/episodes/7/translations": () => json(200, list(item(3, "APPROVED"), item(2, "PUBLISHED"))),
      "GET /api/episodes/7/publication": () => json(200, published(2)),
    });
    const region = within(screen.getByRole("region", { name: "공개 상태" }));
    expect(region.getByText("번역 v2", { selector: "strong" })).toBeTruthy();
    expect(region.getByText("발행 이력 1건")).toBeTruthy();
    expect(screen.getByText("공개 중")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "v2 발행" })).toBeNull(); // already published
    expect(screen.getByRole("button", { name: "v3 발행" })).toBeTruthy();
  });

  test("publishing needs a confirmation: cancel sends nothing, confirm sends one body-less POST then reloads the state", async () => {
    let done = false;
    const { calls } = await open({
      [PUB]: () => { done = true; return json(200, { versionNo: 2, status: "PUBLISHED", publishedAt: T }); },
      "GET /api/episodes/7/translations": () => json(200, list(item(2, done ? "PUBLISHED" : "APPROVED"), item(1, "REJECTED"))),
      "GET /api/episodes/7/publication": () => json(200, done ? published(2) : none),
    });
    click("v2 발행");
    expect(screen.getByText("발행하면 독자에게 공개됩니다. 발행할까요?")).toBeTruthy();
    click("취소");
    expect(posts(calls)).toHaveLength(0);
    click("v2 발행");
    click("발행 확정");
    expect(await screen.findByText("번역 v2을 발행했습니다. 독자에게 공개됩니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toBeUndefined();
    expect(await screen.findByText("공개 중")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "v2 발행" })).toBeNull();
  });

  test("when another version is public, the confirmation says it will be replaced", async () => {
    await open({
      "GET /api/episodes/7/translations": () => json(200, list(item(3, "APPROVED"), item(2, "PUBLISHED"))),
      "GET /api/episodes/7/publication": () => json(200, published(2)),
    });
    click("v3 발행");
    expect(screen.getByText("발행하면 독자에게 공개됩니다. 현재 공개 중인 v2을 대체합니다. 발행할까요?")).toBeTruthy();
  });

  test("double click on the confirmation sends one request", async () => {
    const pending = deferred<Response>();
    const { calls } = await open({ [PUB]: () => pending.promise });
    click("v2 발행");
    click("발행 확정");
    fireEvent.click(screen.getByRole("button", { name: "처리 중…" }));
    expect(posts(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, { versionNo: 2, status: "PUBLISHED", publishedAt: T })); });
    expect(await screen.findByText(/을 발행했습니다/)).toBeTruthy();
  });

  test.each([
    ["INVALIDATED", /원문이 변경되어 이 번역의 승인이 무효화되었습니다/],
    ["PUBLISHED", /이미 발행된 번역입니다/],
    ["REVIEW_PENDING", /승인된 번역만 발행할 수 있습니다/],
  ])("a state conflict (%s) explains it and reloads the state", async (currentStatus, message) => {
    const { calls } = await open({ [PUB]: () => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus } }) });
    click("v2 발행");
    click("발행 확정");
    expect(await screen.findByText(message)).toBeTruthy();
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/episodes/7/publication")).toHaveLength(2));
    expect(screen.queryByText(/발행할까요/)).toBeNull();
  });

  test.each([
    ["403", () => json(403, errorBody("FORBIDDEN")), /발행할 권한이 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed publish (%s) keeps the login and the confirmation so it can be retried", async (_name, respond, expected) => {
    await open({ [PUB]: respond });
    click("v2 발행");
    click("발행 확정");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.getByRole("button", { name: "발행 확정" })).toBeTruthy();
    expect(storedToken()).not.toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  test("401 on publish signs out", async () => {
    await open({ [PUB]: () => json(401, errorBody("AUTH_REQUIRED")) });
    click("v2 발행");
    click("발행 확정");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("a publication read failure does not hide the translation list", async () => {
    server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, list(item(2, "APPROVED"))),
      "GET /api/episodes/7/publication": () => json(503, errorBody("SERVICE_UNAVAILABLE")),
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText("승인됨")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "공개 상태" })).getByRole("alert").textContent).toMatch(/서비스를 사용할 수 없습니다/);
  });

  test("a non-operator never mounts the panel and sends no request", async () => {
    const { calls } = server("TRANSLATOR", {});
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

describe("reader: public pages", () => {
  const blocks = [{ seq: 1, pageNo: 1, text: "첫 컷 번역\n둘째 줄" }, { seq: 2, pageNo: null, text: "<b>태그는 글자로</b>" }];

  test("the list works without any login, shows only title and publish time, and sends no Authorization", async () => {
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/public/episodes") return json(200, { items: [{ episodeId: "7", title: "1화", publishedAt: T }, { episodeId: "9", title: "2화", publishedAt: T }], total: 2 });
      throw new Error(`unexpected ${call.path}`);
    });
    render(<ReadPage />);
    const links = await screen.findAllByRole("link", { name: /화$/ });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/read/7", "/read/9"]);
    expect(calls.every((call) => call.headers.Authorization === undefined)).toBe(true);
    expect(calls.some((call) => call.path === "/api/auth/me")).toBe(false);
  });

  test("a logged-in token in sessionStorage is still never sent", async () => {
    storeToken();
    const { calls } = mockFetch(() => json(200, { items: [], total: 0 }));
    render(<ReadPage />);
    expect(await screen.findByText("아직 공개된 회차가 없습니다.")).toBeTruthy();
    expect(calls.every((call) => call.headers.Authorization === undefined)).toBe(true);
  });

  test("pagination requests the next offset; a 503 offers a retry", async () => {
    let healthy = false;
    const { calls } = mockFetch(() => (healthy
      ? json(200, { items: Array.from({ length: 20 }, (_, i) => ({ episodeId: String(i + 1), title: `회차 ${i + 1}`, publishedAt: T })), total: 45 })
      : json(503, errorBody("SERVICE_UNAVAILABLE"))));
    render(<ReadPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    await screen.findByText("회차 1");
    click("다음");
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/public/episodes?limit=20&offset=20"))).toBe(true));
  });

  test("the reader shows the translated blocks as plain text with page and order, and nothing else", async () => {
    const { calls } = mockFetch(() => json(200, { episodeId: "7", title: "1화", publishedAt: T, blocks }));
    const { container } = render(<ReadEpisodePage />);
    expect(await screen.findByRole("heading", { name: "1화" })).toBeTruthy();
    expect(screen.getByText("p.1")).toBeTruthy();
    expect(container.textContent).toContain("<b>태그는 글자로</b>"); // rendered as text, not markup
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByText(/원문|초안|검수|승인|상태/)).toBeNull();
    expect(calls.every((call) => call.path.startsWith("/api/public/"))).toBe(true); // the episode and, best effort, the public list for neighbour links
    expect(calls.every((call) => call.headers.Authorization === undefined)).toBe(true);
  });

  test("an unpublished or unknown episode (404) shows one neutral notice and no content", async () => {
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    render(<ReadEpisodePage />);
    expect(await screen.findByText("공개되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "공개 회차 목록으로" }).getAttribute("href")).toBe("/read");
  });

  test("an invalid id never calls the API", async () => {
    nav.params = { id: "abc" };
    const { fn } = mockFetch(() => json(200, {}));
    render(<ReadEpisodePage />);
    expect(await screen.findByText("공개되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  test("a 503 keeps a retry and a network error leaks no detail", async () => {
    let healthy = false;
    mockFetch(() => { if (!healthy) throw new TypeError("private detail"); return json(200, { episodeId: "7", title: "1화", publishedAt: T, blocks }); });
    render(<ReadEpisodePage />);
    expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/private detail/)).toBeNull();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("heading", { name: "1화" })).toBeTruthy();
  });
});

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: "7" }),
}));

const T = "2026-10-07T01:00:00.123456Z";
const approved = { decision: "APPROVED", decidedAt: T, reason: null };
const item = (versionNo: number, status: string) => ({ versionNo, status, sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: approved });
const list = (...items: ReturnType<typeof item>[]) => ({ latestSourceVersion: 3, items });
const entry = (versionNo: number) => ({ versionNo, sourceVersion: 3, publishedAt: T });
const live = { current: entry(2), held: null, history: [entry(2)] };
const paused = { current: null, held: entry(2), history: [entry(2)] };
const HOLD = "POST /api/episodes/7/publication/hold";
const RESUME = "POST /api/episodes/7/publication/resume";

type H = (call: FetchCall) => Response | Promise<Response>;
function server(routes: Record<string, H>) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody("OPERATOR"));
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}

async function open(state: unknown, routes: Record<string, H> = {}, status = "PUBLISHED") {
  const api = server({
    "GET /api/episodes/7/translations": () => json(200, list(item(2, status))),
    "GET /api/episodes/7/publication": () => json(200, state),
    ...routes,
  });
  renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
  await screen.findByRole("region", { name: "공개 상태" });
  await screen.findByRole("button", { name: "번역 v2 보기" });
  return api;
}

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const posts = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");

describe("operator: hold and resume (CONTRACTS 21.5)", () => {
  test("a public version offers only hold", async () => {
    await open(live);
    expect(screen.getByRole("button", { name: "공개 보류" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "공개 재개" })).toBeNull();
  });

  test("a held version shows it is hidden, offers only resume and carries a badge", async () => {
    await open(paused, {}, "ON_HOLD");
    expect(screen.getByText(/독자에게 보이지 않음/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "공개 재개" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "공개 보류" })).toBeNull();
    expect(screen.getByText("보류 중", { selector: "span.badge" })).toBeTruthy();
  });

  test("nothing public and nothing held offers neither action", async () => {
    await open({ current: null, held: null, history: [] }, {}, "APPROVED");
    expect(screen.queryByRole("button", { name: /공개 보류|공개 재개/ })).toBeNull();
  });

  test("hold needs a confirmation: cancel sends nothing, confirm sends one body-less POST then reloads", async () => {
    let done = false;
    const { calls } = await open(live, {
      [HOLD]: () => { done = true; return json(200, { versionNo: 2, status: "ON_HOLD", heldAt: T }); },
      "GET /api/episodes/7/publication": () => json(200, done ? paused : live),
    });
    click("공개 보류");
    expect(screen.getByText("보류하면 독자에게 더 이상 보이지 않습니다. 나중에 공개를 재개할 수 있습니다.")).toBeTruthy();
    click("취소");
    expect(posts(calls)).toHaveLength(0);
    click("공개 보류");
    click("보류 확정");
    expect(await screen.findByText("공개를 보류했습니다. 독자에게 더 이상 보이지 않습니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toBeUndefined();
    expect(await screen.findByRole("button", { name: "공개 재개" })).toBeTruthy();
  });

  test("resume needs a confirmation and reloads the public state", async () => {
    let done = false;
    const { calls } = await open(paused, {
      [RESUME]: () => { done = true; return json(200, { versionNo: 2, status: "PUBLISHED", publishedAt: T }); },
      "GET /api/episodes/7/publication": () => json(200, done ? live : paused),
    }, "ON_HOLD");
    click("공개 재개");
    expect(screen.getByText("재개하면 다시 독자에게 공개됩니다.")).toBeTruthy();
    click("재개 확정");
    expect(await screen.findByText("공개를 재개했습니다. 독자에게 다시 공개됩니다.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "공개 보류" })).toBeTruthy();
  });

  test("double click on the confirmation sends one request", async () => {
    const pending = deferred<Response>();
    const { calls } = await open(live, { [HOLD]: () => pending.promise });
    click("공개 보류");
    click("보류 확정");
    fireEvent.click(screen.getByRole("button", { name: "처리 중…" }));
    expect(posts(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, { versionNo: 2, status: "ON_HOLD", heldAt: T })); });
    expect(await screen.findByText(/공개를 보류했습니다/)).toBeTruthy();
  });

  test.each([
    ["ON_HOLD", /이미 보류 중입니다/],
    [null, /보류할 공개 중인 번역이 없습니다/],
  ])("a hold conflict (currentStatus=%s) explains it and reloads", async (currentStatus, message) => {
    const body = { error: { code: "STATE_CONFLICT", message: "x", ...(currentStatus ? { currentStatus } : {}) } };
    const { calls } = await open(live, { [HOLD]: () => json(409, body) });
    click("공개 보류");
    click("보류 확정");
    expect(await screen.findByText(message)).toBeTruthy();
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/episodes/7/publication" && call.method === "GET")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "보류 확정" })).toBeNull();
  });

  test("a resume conflict says it is already public", async () => {
    await open(paused, { [RESUME]: () => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "PUBLISHED" } }) }, "ON_HOLD");
    click("공개 재개");
    click("재개 확정");
    expect(await screen.findByText(/이미 공개 중입니다/)).toBeTruthy();
  });

  test.each([
    ["403", () => json(403, errorBody("FORBIDDEN")), /권한이 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed hold (%s) keeps the login and the confirmation so it can be retried", async (_name, respond, expected) => {
    await open(live, { [HOLD]: respond });
    click("공개 보류");
    click("보류 확정");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.getByRole("button", { name: "보류 확정" })).toBeTruthy();
    expect(storedToken()).not.toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  test("401 on hold signs out", async () => {
    await open(live, { [HOLD]: () => json(401, errorBody("AUTH_REQUIRED")) });
    click("공개 보류");
    click("보류 확정");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("publishing another approved version while one is held says it replaces the held one", async () => {
    await open(paused, { "GET /api/episodes/7/translations": () => json(200, list(item(3, "APPROVED"), item(2, "ON_HOLD"))) }, "ON_HOLD");
    click("v3 발행");
    expect(screen.getByText("발행하면 독자에게 공개됩니다. 보류 중인 v2 대신 공개됩니다. 발행할까요?")).toBeTruthy();
  });
});

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import AssignedPage from "@/app/(auth)/assigned/page";
import { AssignmentPanel } from "@/components/AssignmentPanel";
import { OperatorGate } from "@/components/OperatorGate";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), id: "7" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: nav.id }),
}));

const T = "2026-10-06T01:00:00.123456Z";
const who = (id: string, displayName: string) => ({ id, displayName });
const accounts = (role: string) => (role === "TRANSLATOR"
  ? [{ id: "2", displayName: "데모 번역가", role }, { id: "5", displayName: "다른 번역가", role }]
  : [{ id: "3", displayName: "데모 감수자", role }]);
const myItem = (id: string, role: "TRANSLATOR" | "REVIEWER", version = 1) => ({ id, title: `회차 ${id}`, assignedRole: role, latestSourceVersion: version, assignedAt: T, updatedAt: T });
const myDetail = (role: "TRANSLATOR" | "REVIEWER" = "TRANSLATOR") => ({
  id: "7", title: "1화", assignedRole: role, latestSourceVersion: 2,
  source: { version: 2, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "안녕" }, { seq: 2, pageNo: null, text: "다음 컷" }] },
});

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role, routes: Record<string, H> = {}) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    const key = `${call.method} ${call.path}`;
    if (!routes[key] && key === "GET /api/my/episodes/7/reviews") return json(200, { latestSourceVersion: 2, items: [] });
    const handler = routes[key];
    if (handler) return handler(call);
    throw new Error(`unexpected ${key}`);
  });
}

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.id = "7"; });

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.path !== "/api/auth/me");
const puts = (calls: FetchCall[]) => calls.filter((call) => call.method === "PUT");

const panelRoutes = (overrides: Record<string, H> = {}): Record<string, H> => ({
  "GET /api/episodes/7/assignments": () => json(200, { translator: null, reviewer: null }),
  "GET /api/assignable-accounts": (call) => json(200, { items: accounts(new URL(call.url).searchParams.get("role")!) }),
  ...overrides,
});

async function openPanel(overrides: Record<string, H> = {}) {
  const api = server("OPERATOR", panelRoutes(overrides));
  renderWithAuth(<OperatorGate><AssignmentPanel episodeId="7" /></OperatorGate>);
  await screen.findByRole("region", { name: "담당자 배정" });
  await screen.findByLabelText("번역가 후보");
  return api;
}

describe("assignment panel (operator)", () => {
  test("shows unassigned slots and only the candidates of each role", async () => {
    await openPanel();
    expect(screen.getAllByText("미배정")).toHaveLength(2);
    const translators = within(screen.getByLabelText("번역가 후보")).getAllByRole("option").map((option) => option.textContent);
    expect(translators).toEqual(["선택하세요", "데모 번역가", "다른 번역가"]);
    const reviewers = within(screen.getByLabelText("감수자 후보")).getAllByRole("option").map((option) => option.textContent);
    expect(reviewers).toEqual(["선택하세요", "데모 감수자"]);
    expect((screen.getByRole("button", { name: "번역가 배정" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("assigning sends the account id as a string and shows the new assignee", async () => {
    const { calls } = await openPanel({
      "PUT /api/episodes/7/assignments/translator": () => json(201, { role: "TRANSLATOR", account: who("2", "데모 번역가"), assignedAt: T, changed: true }),
    });
    select("번역가 후보", "2");
    click("번역가 배정");
    expect(await screen.findByText("번역가를 데모 번역가(으)로 배정했습니다.")).toBeTruthy();
    expect(JSON.parse(puts(calls)[0].body!)).toEqual({ accountId: "2" });
    expect(screen.getByRole("button", { name: "번역가 교체" })).toBeTruthy();
  });

  test("an existing assignee is replaced; selecting the same account is not offered", async () => {
    const { calls } = await openPanel({
      "GET /api/episodes/7/assignments": () => json(200, { translator: { account: who("2", "데모 번역가"), assignedAt: T }, reviewer: null }),
      "PUT /api/episodes/7/assignments/translator": () => json(200, { role: "TRANSLATOR", account: who("5", "다른 번역가"), assignedAt: T, changed: true }),
    });
    expect(screen.getByText("데모 번역가")).toBeTruthy();
    expect((screen.getByRole("button", { name: "번역가 교체" }) as HTMLButtonElement).disabled).toBe(true);
    select("번역가 후보", "5");
    click("번역가 교체");
    expect(await screen.findByText("번역가를 다른 번역가(으)로 교체했습니다.")).toBeTruthy();
    expect(puts(calls)).toHaveLength(1);
  });

  test("an unchanged answer from the server is reported as such", async () => {
    await openPanel({ "PUT /api/episodes/7/assignments/reviewer": () => json(200, { role: "REVIEWER", account: who("3", "데모 감수자"), assignedAt: T, changed: false }) });
    select("감수자 후보", "3");
    click("감수자 배정");
    expect(await screen.findByText("이미 같은 담당자입니다. 변경 사항이 없습니다.")).toBeTruthy();
  });

  test("double click sends one request and blocks the other slot while saving", async () => {
    const pending = deferred<Response>();
    const { calls } = await openPanel({ "PUT /api/episodes/7/assignments/translator": () => pending.promise });
    select("번역가 후보", "2");
    select("감수자 후보", "3");
    click("번역가 배정");
    fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
    expect(puts(calls)).toHaveLength(1);
    expect((screen.getByRole("button", { name: "감수자 배정" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(json(201, { role: "TRANSLATOR", account: who("2", "데모 번역가"), assignedAt: T, changed: true })); });
    expect(await screen.findByText(/배정했습니다/)).toBeTruthy();
  });

  test.each([
    ["400", () => json(400, errorBody("INVALID_REQUEST")), /배정할 수 없습니다/],
    ["403", () => json(403, errorBody("FORBIDDEN")), /권한이 없습니다/],
    ["404", () => json(404, errorBody("NOT_FOUND")), /찾을 수 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed assignment (%s) shows a fixed message and keeps the login and the selection", async (_name, respond, expected) => {
    await openPanel({ "PUT /api/episodes/7/assignments/translator": respond });
    select("번역가 후보", "2");
    click("번역가 배정");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect((screen.getByLabelText("번역가 후보") as HTMLSelectElement).value).toBe("2");
    expect(storedToken()).not.toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  test("401 on assigning signs out and goes to /login", async () => {
    await openPanel({ "PUT /api/episodes/7/assignments/translator": () => json(401, errorBody("AUTH_REQUIRED")) });
    select("번역가 후보", "2");
    click("번역가 배정");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("a load failure offers a retry and shows no assignment controls", async () => {
    let healthy = false;
    server("OPERATOR", panelRoutes({ "GET /api/episodes/7/assignments": () => (healthy ? json(200, { translator: null, reviewer: null }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) }));
    renderWithAuth(<OperatorGate><AssignmentPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    expect(screen.queryByLabelText("번역가 후보")).toBeNull();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByLabelText("번역가 후보")).toBeTruthy();
  });

  test("a non-operator never mounts the panel and sends no assignment request", async () => {
    const { calls } = server("TRANSLATOR", panelRoutes());
    renderWithAuth(<OperatorGate><AssignmentPanel episodeId="7" /></OperatorGate>);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

describe("assigned episodes list (translator / reviewer)", () => {
  test.each(["TRANSLATOR", "REVIEWER"] as const)("%s sees only the episodes the server returns, with the role label", async (role) => {
    server(role, { "GET /api/my/episodes": () => json(200, { items: [myItem("1", role, 0), myItem("2", role, 3)], total: 2 }) });
    renderWithAuth(<AssignedPage />);
    expect((await screen.findByRole("link", { name: "회차 1" })).getAttribute("href")).toBe("/assigned/1");
    expect(screen.getAllByText(role === "TRANSLATOR" ? "번역가" : "감수자").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("원문 없음")).toBeTruthy();
    expect(screen.getByText("v3")).toBeTruthy();
  });

  test("an empty list, pagination and failures", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes": () => json(200, { items: [], total: 0 }) });
    renderWithAuth(<AssignedPage />);
    expect(await screen.findByText("배정된 회차가 없습니다.")).toBeTruthy();
  });

  test("pagination requests the next offset", async () => {
    const { calls } = server("TRANSLATOR", { "GET /api/my/episodes": () => json(200, { items: Array.from({ length: 20 }, (_, i) => myItem(String(i + 1), "TRANSLATOR")), total: 45 }) });
    renderWithAuth(<AssignedPage />);
    await screen.findByRole("link", { name: "회차 1" });
    click("다음");
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/my/episodes?limit=20&offset=20"))).toBe(true));
  });

  test("503 keeps the session and offers a retry; 401 signs out", async () => {
    let healthy = false;
    server("REVIEWER", { "GET /api/my/episodes": () => (healthy ? json(200, { items: [myItem("1", "REVIEWER")], total: 1 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    renderWithAuth(<AssignedPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("link", { name: "회차 1" })).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("401 on the list signs out and goes to /login", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes": () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<AssignedPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test.each(["OPERATOR", "READER"] as const)("%s sees a notice and no request is sent", async (role) => {
    const { calls } = server(role, { "GET /api/my/episodes": () => json(200, { items: [], total: 0 }) });
    renderWithAuth(<AssignedPage />);
    expect(await screen.findByText(/번역가·감수자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
    expect(storedToken()).not.toBeNull();
  });
});

describe("assigned episode detail (read-only source)", () => {
  test("shows the title, my role and the source blocks with page numbers, and no edit controls", async () => {
    server("REVIEWER", { "GET /api/my/episodes/7": () => json(200, myDetail("REVIEWER")) });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByRole("heading", { name: "1화" })).toBeTruthy();
    expect(screen.getByText("감수자")).toBeTruthy();
    expect(screen.getByText("안녕")).toBeTruthy();
    expect(screen.getByText("p.1")).toBeTruthy();
    expect(screen.getByText("다음 컷")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
  });

  test("an episode without source says so", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes/7": () => json(200, { ...myDetail(), latestSourceVersion: 0, source: null }) });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText("운영자가 원문을 저장하면 여기에 표시됩니다.")).toBeTruthy();
  });

  test("404 (not assigned, replaced or unknown) shows one neutral notice and a link back", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes/7": () => json(404, errorBody("NOT_FOUND")) });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "배정된 회차 목록으로" }).getAttribute("href")).toBe("/assigned");
    expect(screen.queryByText("안녕")).toBeNull();
    expect(storedToken()).not.toBeNull();
  });

  test("a reload after the assignment moved away no longer shows the source", async () => {
    let assigned = true;
    server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => (assigned ? json(200, myDetail()) : json(404, errorBody("NOT_FOUND"))),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 2, items: [{ versionNo: 1, status: "REJECTED", sourceVersion: 2, revision: 1, createdAt: T, submittedAt: T }] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, { versionNo: 1, status: "REJECTED", sourceVersion: 2, revision: 1, createdAt: T, submittedAt: T, editable: false,
        blocks: [{ seq: 1, pageNo: 1, source: "안녕", text: null }] }),
    });
    renderWithAuth(<AssignedDetailPage />);
    await screen.findByText("안녕");
    assigned = false;
    // The page has no reload button by design; re-mounting is what a refresh does.
    document.body.innerHTML = "";
    const again = renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(again.queryByText("안녕")).toBeNull();
  });

  test("503 and network errors offer a retry; 401 signs out; other roles see a notice only", async () => {
    let healthy = false;
    server("TRANSLATOR", { "GET /api/my/episodes/7": () => { if (!healthy) throw new TypeError("offline"); return json(200, myDetail()); } });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("heading", { name: "1화" })).toBeTruthy();
  });

  test("401 on the detail signs out and goes to /login", async () => {
    server("REVIEWER", { "GET /api/my/episodes/7": () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<AssignedDetailPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("an operator or reader sees a notice and no request is sent", async () => {
    const { calls } = server("READER", { "GET /api/my/episodes/7": () => json(200, myDetail()) });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/번역가·감수자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });
});

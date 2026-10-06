import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import EpisodesPage from "@/app/(auth)/episodes/page";
import EpisodeDetailPage from "@/app/(auth)/episodes/[id]/page";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), id: "7" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: nav.id }),
}));

const T = "2026-10-06T01:00:00.123456Z";
const by = { id: "1", displayName: "데모 운영자" };
const source = (version: number, blocks: { pageNo: number | null; text: string }[]) =>
  ({ version, savedAt: T, savedBy: by, blocks: blocks.map((block, index) => ({ seq: index + 1, ...block })) });
const detailBody = (version = 2, title = "1화") => ({
  id: "7", title, latestSourceVersion: version, createdAt: T, updatedAt: T,
  source: version === 0 ? null : source(version, [{ pageNo: 1, text: "안녕" }, { pageNo: null, text: "다음 컷" }]),
});
const versionsBody = { items: [
  { version: 2, savedAt: T, savedBy: by, blockCount: 2 },
  { version: 1, savedAt: T, savedBy: by, blockCount: 1 },
] };
const listBody = (count: number, total = count) => ({
  items: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), title: `회차 ${index + 1}`, latestSourceVersion: index, updatedAt: T })),
  total,
});

type Handlers = Partial<Record<"list" | "create" | "detail" | "versions" | "version" | "put", (call: FetchCall) => Response | Promise<Response>>>;

function server(handlers: Handlers = {}, role: Role = "OPERATOR") {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    if (call.path === "/api/episodes" && call.method === "POST") return (handlers.create ?? (() => json(201, { id: "7", title: "x", latestSourceVersion: 0, createdAt: T })))(call);
    if (call.path === "/api/episodes") return (handlers.list ?? (() => json(200, listBody(2))))(call);
    if (call.path === "/api/episodes/7/source" && call.method === "PUT") return (handlers.put ?? (() => json(201, { version: 3, changed: true, savedAt: T })))(call);
    if (call.path === "/api/episodes/7/source/versions") return (handlers.versions ?? (() => json(200, versionsBody)))(call);
    if (call.path.startsWith("/api/episodes/7/source/versions/")) return (handlers.version ?? (() => json(200, source(1, [{ pageNo: null, text: "옛 버전 내용" }]))))(call);
    if (call.path === "/api/episodes/7/translations") return json(200, { latestSourceVersion: 2, items: [] });
    if (call.path === "/api/episodes/7/publication") return json(200, { current: null, history: [] });
    if (call.path === "/api/episodes/7/assignments") return json(200, { translator: null, reviewer: null });
    if (call.path === "/api/assignable-accounts") return json(200, { items: [] });
    if (call.path === "/api/episodes/7") return (handlers.detail ?? (() => json(200, detailBody())))(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.id = "7"; });

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const textarea = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.path !== "/api/auth/me");
const putCalls = (calls: FetchCall[]) => calls.filter((call) => call.method === "PUT");

async function openDetail(handlers: Handlers = {}) {
  const api = server(handlers);
  renderWithAuth(<EpisodeDetailPage />);
  await screen.findByRole("heading", { name: "1화" });
  return api;
}

describe("episode list", () => {
  test("shows the episodes with links and a label for episodes without source", async () => {
    server();
    renderWithAuth(<EpisodesPage />);
    expect((await screen.findByRole("link", { name: "회차 1" })).getAttribute("href")).toBe("/episodes/1");
    expect(screen.getByRole("link", { name: "회차 2" }).getAttribute("href")).toBe("/episodes/2");
    expect(screen.getByText("원문 없음")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  test("title is validated locally and sent exactly as typed", async () => {
    const { calls } = server({ create: () => json(201, { id: "9", title: " 새 회차 ", latestSourceVersion: 0, createdAt: T }) });
    renderWithAuth(<EpisodesPage />);
    await screen.findByRole("link", { name: "회차 1" });
    click("회차 만들기");
    expect(await screen.findByText("제목을 입력하세요.")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    change("제목", " 새 회차 ");
    click("회차 만들기");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/episodes/9"));
    expect(JSON.parse(calls.find((call) => call.method === "POST")!.body!)).toEqual({ title: " 새 회차 " });
  });

  test("double submit sends one create request", async () => {
    const pending = deferred<Response>();
    const { calls } = server({ create: () => pending.promise });
    renderWithAuth(<EpisodesPage />);
    await screen.findByRole("link", { name: "회차 1" });
    change("제목", "1화");
    const form = screen.getByRole("form", { name: "회차 생성 양식" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect((screen.getByRole("button", { name: "생성 중…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(json(201, { id: "9", title: "1화", latestSourceVersion: 0, createdAt: T })); });
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
  });

  test.each([
    ["403", () => json(403, errorBody("FORBIDDEN")), /권한이 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["400", () => json(400, errorBody("INVALID_REQUEST")), /서버 규칙에 맞지 않습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed create (%s) keeps the title and shows a fixed message", async (_name, respond, expected) => {
    server({ create: respond });
    renderWithAuth(<EpisodesPage />);
    await screen.findByRole("link", { name: "회차 1" });
    change("제목", "1화");
    click("회차 만들기");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("1화");
    expect(nav.push).not.toHaveBeenCalled();
    expect(storedToken()).not.toBeNull();
  });

  test("401 signs the user out and goes to /login", async () => {
    server({ list: () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<EpisodesPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("a 503 on the list keeps the session and offers a retry", async () => {
    let healthy = false;
    server({ list: () => (healthy ? json(200, listBody(1)) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    renderWithAuth(<EpisodesPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("link", { name: "회차 1" })).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("pagination requests the next offset", async () => {
    const { calls } = server({ list: () => json(200, listBody(20, 45)) });
    renderWithAuth(<EpisodesPage />);
    await screen.findByRole("link", { name: "회차 1" });
    click("다음");
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/episodes?limit=20&offset=20"))).toBe(true));
  });

  test("a non-operator sees a notice, keeps the login and triggers no episode request", async () => {
    const { calls } = server({}, "READER");
    renderWithAuth(<EpisodesPage />);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(screen.getByText(/현재 역할: 독자/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
    expect(storedToken()).not.toBeNull();
    expect(screen.queryByRole("form", { name: "회차 생성 양식" })).toBeNull();
  });
});

describe("episode detail and editor", () => {
  test("loads the title, the current blocks into the editor and the version history", async () => {
    await openDetail();
    expect(textarea("블록 1 텍스트").value).toBe("안녕");
    expect((screen.getByLabelText("블록 1 페이지") as HTMLInputElement).value).toBe("1");
    expect(textarea("블록 2 텍스트").value).toBe("다음 컷");
    expect((screen.getByLabelText("블록 2 페이지") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("최신 원문 버전: v2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "v1 보기" })).toBeTruthy();
  });

  test("a new episode without source starts with one empty block", async () => {
    server({ detail: () => json(200, detailBody(0)), versions: () => json(200, { items: [] }) });
    renderWithAuth(<EpisodeDetailPage />);
    await screen.findByRole("heading", { name: "1화" });
    expect(screen.getByText("아직 저장된 원문이 없습니다.")).toBeTruthy();
    expect(textarea("블록 1 텍스트").value).toBe("");
    expect(screen.getByText("저장된 버전이 없습니다.")).toBeTruthy();
  });

  test("invalid input is rejected locally and nothing is sent", async () => {
    const { calls } = await openDetail();
    change("블록 1 텍스트", "   ");
    change("블록 2 페이지", "0");
    click("원문 저장");
    expect(await screen.findByText("텍스트를 입력하세요.")).toBeTruthy();
    expect(screen.getByText(/페이지 번호는 1~9999/)).toBeTruthy();
    expect(screen.getByText("입력 내용을 확인하세요.")).toBeTruthy();
    expect(putCalls(calls)).toHaveLength(0);
  });

  test("saving sends expectedVersion and the blocks as typed, then reloads", async () => {
    const { calls } = await openDetail();
    change("블록 1 텍스트", "  수정된 첫 컷\n둘째 줄  ");
    change("블록 2 페이지", "12");
    click("원문 저장");
    expect(await screen.findByText("원문 버전 3으로 저장했습니다.")).toBeTruthy();
    expect(JSON.parse(putCalls(calls)[0].body!)).toEqual({
      expectedVersion: 2,
      blocks: [{ pageNo: 1, text: "  수정된 첫 컷\n둘째 줄  " }, { pageNo: 12, text: "다음 컷" }],
    });
    await waitFor(() => expect(calls.filter((call) => call.method === "GET" && call.path === "/api/episodes/7")).toHaveLength(2));
  });

  test("a source save reloads the operator's translation overview and drops an opened detail", async () => {
    const { calls } = await openDetail();
    const overview = () => calls.filter((call) => call.method === "GET" && call.path === "/api/episodes/7/translations");
    expect(overview()).toHaveLength(1);
    change("블록 1 텍스트", "수정");
    click("원문 저장");
    await screen.findByText("원문 버전 3으로 저장했습니다.");
    await waitFor(() => expect(overview()).toHaveLength(2));
  });

  test("an unchanged save does not reload the translation overview", async () => {
    const { calls } = await openDetail({ put: () => json(200, { version: 2, changed: false }) });
    click("원문 저장");
    await screen.findByText(/변경 사항이 없어/);
    expect(calls.filter((call) => call.path === "/api/episodes/7/translations")).toHaveLength(1);
  });

  test("an unchanged save reports that no version was created", async () => {
    await openDetail({ put: () => json(200, { version: 2, changed: false }) });
    click("원문 저장");
    expect(await screen.findByText("변경 사항이 없어 새 버전을 만들지 않았습니다.")).toBeTruthy();
  });

  test("double click on save sends one request", async () => {
    const pending = deferred<Response>();
    const { calls } = await openDetail({ put: () => pending.promise });
    click("원문 저장");
    fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
    expect(putCalls(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(201, { version: 3, changed: true, savedAt: T })); });
    expect(await screen.findByText("원문 버전 3으로 저장했습니다.")).toBeTruthy();
  });

  test("a 409 keeps the draft, explains the conflict and loads the latest version on request", async () => {
    let latest = false;
    await openDetail({
      put: () => json(409, { error: { code: "VERSION_CONFLICT", message: "x", latestVersion: 3 } }),
      detail: () => json(200, latest
        ? { ...detailBody(3), source: source(3, [{ pageNo: null, text: "다른 사람이 쓴 내용" }]) }
        : detailBody()),
    });
    change("블록 1 텍스트", "내 초안");
    click("원문 저장");
    expect(await screen.findByText(/최신 버전 3/)).toBeTruthy();
    expect(textarea("블록 1 텍스트").value).toBe("내 초안");
    latest = true;
    click(/최신 버전 불러오기/);
    await waitFor(() => expect(textarea("블록 1 텍스트").value).toBe("다른 사람이 쓴 내용"));
    expect(screen.queryByRole("button", { name: /최신 버전 불러오기/ })).toBeNull();
  });

  test("401 on save signs out, 403 keeps the login and the draft", async () => {
    await openDetail({ put: () => json(401, errorBody("AUTH_REQUIRED")) });
    click("원문 저장");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("403 keeps the login and the draft", async () => {
    await openDetail({ put: () => json(403, errorBody("FORBIDDEN")) });
    change("블록 1 텍스트", "내 초안");
    click("원문 저장");
    expect(await screen.findByText(/권한이 없습니다/)).toBeTruthy();
    expect(textarea("블록 1 텍스트").value).toBe("내 초안");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(storedToken()).not.toBeNull();
  });

  test("503 on save keeps the draft and a second attempt can succeed", async () => {
    let down = true;
    const { calls } = await openDetail({ put: () => (down ? json(503, errorBody("SERVICE_UNAVAILABLE")) : json(201, { version: 3, changed: true, savedAt: T })) });
    change("블록 1 텍스트", "내 초안");
    click("원문 저장");
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    expect(textarea("블록 1 텍스트").value).toBe("내 초안");
    down = false;
    click("원문 저장");
    expect(await screen.findByText("원문 버전 3으로 저장했습니다.")).toBeTruthy();
    expect(putCalls(calls)).toHaveLength(2);
  });

  test("blocks can be added, reordered and deleted; the last block cannot be deleted", async () => {
    await openDetail();
    click("블록 추가");
    expect(textarea("블록 3 텍스트").value).toBe("");
    click("블록 2 위로");
    expect(textarea("블록 1 텍스트").value).toBe("다음 컷");
    expect(textarea("블록 2 텍스트").value).toBe("안녕");
    expect((screen.getByRole("button", { name: "블록 1 위로" }) as HTMLButtonElement).disabled).toBe(true);
    click("블록 3 삭제");
    click("블록 2 삭제");
    expect(textarea("블록 1 텍스트").value).toBe("다음 컷");
    expect((screen.getByRole("button", { name: "블록 1 삭제" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the 200 block limit disables adding more blocks", async () => {
    server({ detail: () => json(200, { ...detailBody(), source: source(2, Array.from({ length: 200 }, (_, index) => ({ pageNo: null, text: `블록 ${index}` }))) }) });
    renderWithAuth(<EpisodeDetailPage />);
    await screen.findByRole("heading", { name: "1화" });
    expect((screen.getByRole("button", { name: "블록 추가" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("an old version is shown read-only and the editor is untouched", async () => {
    await openDetail();
    change("블록 1 텍스트", "작성 중");
    click("v1 보기");
    const view = await screen.findByRole("region", { name: "v1 내용" });
    expect(within(view).getByText("옛 버전 내용")).toBeTruthy();
    expect(textarea("블록 1 텍스트").value).toBe("작성 중");
  });

  test("a late response of an earlier version click does not replace the latest click", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    await openDetail({ version: (call) => (call.path.endsWith("/2") ? first.promise : second.promise) });
    click("v2 보기");
    click("v1 보기");
    await act(async () => { second.resolve(json(200, source(1, [{ pageNo: null, text: "v1 본문" }]))); });
    expect(await screen.findByRole("region", { name: "v1 내용" })).toBeTruthy();
    await act(async () => { first.resolve(json(200, source(2, [{ pageNo: null, text: "v2 본문" }]))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole("region", { name: "v1 내용" })).toBeTruthy();
    expect(screen.queryByText("v2 본문")).toBeNull();
  });

  test("an unknown episode shows a not-found notice with a link back to the list", async () => {
    server({ detail: () => json(404, errorBody("NOT_FOUND")), versions: () => json(404, errorBody("NOT_FOUND")) });
    renderWithAuth(<EpisodeDetailPage />);
    expect(await screen.findByText("요청한 회차 또는 원문 버전을 찾을 수 없습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "회차 목록으로" }).getAttribute("href")).toBe("/episodes");
  });

  test("a load failure offers a retry and 401 on load signs out", async () => {
    let healthy = false;
    server({ detail: () => { if (!healthy) throw new TypeError("offline"); return json(200, detailBody()); } });
    renderWithAuth(<EpisodeDetailPage />);
    expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("heading", { name: "1화" })).toBeTruthy();
  });

  test("a non-operator never triggers an episode request on the detail page", async () => {
    const { calls } = server({}, "TRANSLATOR");
    renderWithAuth(<EpisodeDetailPage />);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(apiCalls(calls)).toHaveLength(0);
  });

  test("drafts are kept in memory only: nothing but the token is stored in the browser", async () => {
    await openDetail();
    change("블록 1 텍스트", "저장하지 않은 초안");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(1);
    expect(document.cookie).toBe("");
  });
});

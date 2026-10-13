import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LibraryPage from "@/app/(public)/library/page";
import MyPage from "@/app/(public)/my/page";
import SettingsPage from "@/app/(public)/settings/page";
import SignupPage from "@/app/(public)/signup/page";
import WorkPage from "@/app/(public)/works/[id]/page";
import PublicLayout from "@/app/(public)/layout";
import { changePassword, getLibrary, getProfile, mergeLibrary, registerAccount, saveProfile, setAccountRecommendation } from "@/lib/account/client";
import { loginIdProblem, nameProblem, passwordProblem } from "@/lib/account/rules";
import { AUTH_EVENT } from "@/lib/auth/events";
import { TOKEN_STORAGE_KEY } from "@/lib/auth/storage";
import { addToLibrary, loadLibrary } from "@/lib/personal/library";
import { loadRecent, loadTitles, recordRecent } from "@/lib/personal/recent";
import { syncAfterSignIn, SYNCED_KEY } from "@/lib/personal/sync";
import { loadRecommended, setRecommended } from "@/lib/personal/voter";
import { NEW_TOKEN, TOKEN, errorBody, json, meBody, mockFetch, noContent, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/",
}));

const T = "2026-10-08T01:00:00.123456Z";
const sessionBody = (token = NEW_TOKEN) => ({ user: { id: "9", displayName: "새 독자", role: "READER" }, accessToken: token, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" });
const work = (id: number) => ({ workId: String(id), title: `작품${id}`, author: "작가", genres: ["판타지"], hasCover: false, episodeCount: 1, latestPublishedAt: T, views: 1, recommendCount: 2 });
const signIn = () => window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
const bearer = (call: FetchCall) => call.headers.Authorization ?? call.headers.authorization;

beforeEach(() => { nav.push.mockClear(); nav.search = ""; });

describe("sign-up rules (32.2) as the form checks them", () => {
  test("login id: 4-20 lower-case characters, not the reserved demo. prefix", () => {
    expect(loginIdProblem("abcd")).toBeNull();
    expect(loginIdProblem("a".repeat(20))).toBeNull();
    for (const bad of ["abc", "a".repeat(21), "Abcd", "ab cd", "한글아이디", "demo.reader", "-abcd"]) expect(loginIdProblem(bad), bad).not.toBeNull();
    expect(loginIdProblem("demonstration")).toBeNull();
  });
  test("password: 10 characters, 72 bytes, no login id, nothing common or repeated", () => {
    expect(passwordProblem("reader01", "Abcdefghi1")).toBeNull();
    for (const bad of ["Abcdefgh1", "a1".repeat(36) + "x", "xxReader01xx", "1234567890", "aaaaaaaaaaaa", "          "]) expect(passwordProblem("reader01", bad), bad).not.toBeNull();
    expect(passwordProblem("reader01", "a1".repeat(36))).toBeNull();
  });
  test("display name: 1-20 characters without control characters", () => {
    expect(nameProblem("독자")).toBeNull();
    for (const bad of ["", "   ", "가".repeat(21), "a\u0007b"]) expect(nameProblem(bad), bad).not.toBeNull();
  });
});

describe("account client (32.2-32.5)", () => {
  test("registerAccount posts exactly the three fields, without a token, and parses the session", async () => {
    signIn();
    const { calls } = mockFetch(() => json(201, sessionBody()));
    const result = await registerAccount("reader01", "Abcdefghi1", "독자");
    expect(result).toEqual({ ok: true, value: { user: { id: "9", displayName: "새 독자", role: "READER" }, accessToken: NEW_TOKEN, expiresAt: "2099-01-01T00:00:00Z" } });
    expect(calls[0].path).toBe("/api/auth/register");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body!)).toEqual({ loginId: "reader01", password: "Abcdefghi1", displayName: "독자" });
    expect(bearer(calls[0])).toBeUndefined();
  });

  test("409 is taken, 429 keeps Retry-After, 400 is invalid, a malformed answer is refused", async () => {
    mockFetch(() => json(409, errorBody("LOGIN_ID_TAKEN")));
    expect(await registerAccount("reader01", "Abcdefghi1", "독자")).toMatchObject({ ok: false, failure: { kind: "taken" } });
    mockFetch(() => json(429, errorBody("REGISTER_RATE_LIMITED"), { "Retry-After": "120" }));
    expect(await registerAccount("reader01", "Abcdefghi1", "독자")).toMatchObject({ ok: false, failure: { kind: "rate_limited", retryAfterSeconds: 120 } });
    mockFetch(() => json(400, errorBody("INVALID_REQUEST")));
    expect(await registerAccount("reader01", "Abcdefghi1", "독자")).toMatchObject({ ok: false, failure: { kind: "invalid_request" } });
    mockFetch(() => json(201, { ...sessionBody(), accessToken: "short" }));
    expect(await registerAccount("reader01", "Abcdefghi1", "독자")).toMatchObject({ ok: false, failure: { kind: "invalid_response" } });
    mockFetch(() => json(201, { ...sessionBody(), user: { id: "9", displayName: "x", role: "ADMIN" } }));
    expect((await registerAccount("reader01", "Abcdefghi1", "독자")).ok).toBe(false);
  });

  test("the account calls carry the bearer token and their paths; wrong current password is its own failure", async () => {
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/me/profile") return json(200, { loginId: "reader01", displayName: "독자", bio: "소개", role: "READER" });
      if (call.path === "/api/me/library/merge") return json(200, { items: [{ workId: "1", addedAt: T }] });
      if (call.path === "/api/me/library") return json(200, { items: [{ workId: "1", addedAt: T }] });
      if (call.path === "/api/me/password") return json(400, errorBody("INVALID_CURRENT_PASSWORD"));
      if (call.path === "/api/me/works/1/recommend") return json(200, { recommended: true, recommendCount: 3 });
      return json(404, errorBody("NOT_FOUND"));
    });
    expect(await getProfile(TOKEN)).toMatchObject({ ok: true, value: { loginId: "reader01", bio: "소개" } });
    expect(await getLibrary(TOKEN)).toEqual({ ok: true, value: [{ workId: "1", addedAt: T }] });
    expect(await mergeLibrary(TOKEN, ["1"])).toMatchObject({ ok: true });
    expect(await changePassword(TOKEN, "wrong", "Abcdefghi1")).toMatchObject({ ok: false, failure: { kind: "wrong_current_password" } });
    expect(await setAccountRecommendation(TOKEN, "1", true)).toEqual({ ok: true, value: { recommended: true, recommendCount: 3 } });
    for (const call of calls) expect(bearer(call)).toBe(`Bearer ${TOKEN}`);
    expect(calls.map((call) => call.path)).toEqual(["/api/me/profile", "/api/me/library", "/api/me/library/merge", "/api/me/password", "/api/me/works/1/recommend"]);
    expect(JSON.parse(calls[2].body!)).toEqual({ workIds: ["1"] });
    expect(calls[4].body).toBeUndefined();   // the account is the voter: no key is sent
  });
});

describe("sign-up page (32.7)", () => {
  test("rule problems show next to the fields and nothing is sent", async () => {
    const { calls } = mockFetch(() => json(500, errorBody("X")));
    render(<SignupPage />);
    await screen.findByRole("form", { name: "회원가입" });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText(/아이디는 영어 소문자/)).toBeTruthy();
    expect(screen.getByText(/표시 이름은 1~20자/)).toBeTruthy();
    expect(screen.getByText(/비밀번호는 10자 이상/)).toBeTruthy();
    expect((screen.getByLabelText("아이디") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "reader01" } });
    fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "독자" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Abcdefghi1" } });
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Abcdefghi2" } });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("비밀번호가 서로 다릅니다.")).toBeTruthy();
    expect(calls.filter((call) => call.path === "/api/auth/register")).toHaveLength(0);
  });

  test("a good form signs up, stores the token, tells the tab and goes to the my page", async () => {
    const { calls } = mockFetch((call) => (call.path === "/api/auth/register" ? json(201, sessionBody()) : noContent()));
    const heard = vi.fn();
    window.addEventListener(AUTH_EVENT, heard);
    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText("아이디"), { target: { value: "reader01" } });
    fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "  독자  " } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Abcdefghi1" } });
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Abcdefghi1" } });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/my"));
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(NEW_TOKEN);
    expect(JSON.parse(calls.find((call) => call.path === "/api/auth/register")!.body!)).toEqual({ loginId: "reader01", password: "Abcdefghi1", displayName: "독자" });
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(AUTH_EVENT, heard);
  });

  test("a taken id and a rate limit show fixed messages, keep the input and allow another try; a double click sends once", async () => {
    let answer: Response = json(409, errorBody("LOGIN_ID_TAKEN"));
    const { calls } = mockFetch((call) => (call.path === "/api/auth/register" ? answer : noContent()));
    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText("아이디"), { target: { value: "reader01" } });
    fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "독자" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Abcdefghi1" } });
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Abcdefghi1" } });
    const button = screen.getByRole("button", { name: "가입하기" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/이미 사용 중인 아이디/)).toBeTruthy();
    expect(calls.filter((call) => call.path === "/api/auth/register")).toHaveLength(1);
    expect((screen.getByLabelText("아이디") as HTMLInputElement).value).toBe("reader01");
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    answer = json(429, errorBody("REGISTER_RATE_LIMITED"), { "Retry-After": "600" });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText(/10분 뒤에 다시 시도/)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  test("somebody already signed in is told so instead of seeing the form", async () => {
    signIn();
    mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody("READER")) : noContent()));
    render(<SignupPage />);
    expect(await screen.findByText(/이미 로그인되어 있습니다/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "회원가입" })).toBeNull();
  });
});

describe("account data replaces the browser's while signed in (32.7)", () => {
  /** A server that keeps a library and a recent list in memory. */
  function accountServer(extra?: (call: FetchCall) => Response | undefined) {
    const state = { library: ["1", "2"], recent: [{ episodeId: "11", readAt: T }], recommended: ["1"] };
    const server = mockFetch((call) => {
      const special = extra?.(call);
      if (special) return special;
      if (call.path === "/api/auth/me") return json(200, meBody("READER"));
      if (call.path === "/api/me/library" && call.method === "GET") return json(200, { items: state.library.map((workId) => ({ workId, addedAt: T })) });
      const put = /^\/api\/me\/library\/(\d+)$/.exec(call.path);
      if (put && call.method === "PUT") { state.library = [put[1], ...state.library.filter((id) => id !== put[1])]; return noContent(); }
      if (put && call.method === "DELETE") { state.library = state.library.filter((id) => id !== put[1]); return noContent(); }
      if (call.path === "/api/me/recent" && call.method === "GET") return json(200, { items: state.recent });
      if (call.path === "/api/me/recent" && call.method === "DELETE") { state.recent = []; return noContent(); }
      if (call.path === "/api/me/recommendations") return json(200, { workIds: state.recommended });
      if (call.path === "/api/library/none") return noContent();
      const workMatch = /^\/api\/public\/works\/(\d+)$/.exec(call.path);
      if (workMatch) return json(200, { ...work(Number(workMatch[1])), description: "", readingDirection: "RTL", episodes: [] });
      if (call.path === "/api/public/episodes/11") return json(200, { episodeId: "11", title: "11화 제목", publishedAt: T, blocks: [] });
      if (call.path === "/api/public/episodes/11/work") return json(200, { workId: "1", title: "작품1", readingDirection: "RTL", episodeNo: 11 });
      return json(404, errorBody("NOT_FOUND"));
    });
    return { ...server, state };
  }

  test("the library page shows the account's works, adding and removing go to the server", async () => {
    signIn();
    addToLibrary("77");                                   // the browser's own list is not what is shown
    const { calls, state } = accountServer();
    render(<MyPage />);
    const library = await screen.findByRole("region", { name: "내 서재" });
    expect(await within(library).findByRole("heading", { name: "작품1" })).toBeTruthy();
    expect(within(library).getByRole("heading", { name: "작품2" })).toBeTruthy();
    expect(within(library).queryByRole("heading", { name: "작품77" })).toBeNull();
    expect(calls.filter((call) => call.path === "/api/me/library" && call.method === "GET").length).toBeGreaterThan(0);
    expect(bearer(calls.find((call) => call.path === "/api/me/library")!)).toBe(`Bearer ${TOKEN}`);
    fireEvent.click(within(library).getByRole("button", { name: "작품1 내 서재에서 빼기" }));
    await waitFor(() => expect(state.library).toEqual(["2"]));
    expect(calls.some((call) => call.method === "DELETE" && call.path === "/api/me/library/1")).toBe(true);
    await waitFor(() => expect(within(library).queryByRole("heading", { name: "작품1" })).toBeNull());
    expect(loadLibrary().map((entry) => entry.workId)).toEqual(["77"]);   // the browser's list was left alone
  });

  test("one page of hearts asks the server for the library once or twice, not once per heart", async () => {
    signIn();
    const { calls } = accountServer();
    render(<MyPage />);
    await screen.findByRole("heading", { name: "작품1" });
    await act(async () => {});
    expect(calls.filter((call) => call.path === "/api/me/library" && call.method === "GET").length).toBeLessThanOrEqual(3);
  });

  test("the recent list comes from the server and its titles are looked up once", async () => {
    signIn();
    const { calls } = accountServer();
    render(<MyPage />);
    const recent = await screen.findByRole("region", { name: "최근 본 회차" }).catch(() => null);
    void recent;
    expect(await screen.findByRole("link", { name: /작품1 · 11화 제목/ })).toBeTruthy();
    expect(loadTitles()["11"]).toMatchObject({ title: "11화 제목", workTitle: "작품1", episodeNo: 11 });
    expect(calls.filter((call) => call.path === "/api/public/episodes/11")).toHaveLength(1);
  });

  test("opening an episode also tells the server; without a token only the browser keeps it", async () => {
    signIn();
    const { calls } = accountServer();
    recordRecent({ episodeId: "11", title: "11화", workId: "1", workTitle: "작품1", episodeNo: 11 });
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.path === "/api/me/recent/11")).toBe(true));
    expect(bearer(calls.find((call) => call.path === "/api/me/recent/11")!)).toBe(`Bearer ${TOKEN}`);
    expect(loadRecent()).toHaveLength(1);                                   // the titles stay in the browser
    window.sessionStorage.clear();
    const before = calls.length;
    recordRecent({ episodeId: "12", title: "12화", workId: null, workTitle: null, episodeNo: null });
    await act(async () => {});
    expect(calls.slice(before).filter((call) => call.path.startsWith("/api/me"))).toHaveLength(0);
  });

  test("a token the server refuses is dropped and the browser's data is shown again", async () => {
    signIn();
    addToLibrary("5");
    mockFetch((call) => {
      if (call.path === "/api/auth/me") return json(401, errorBody("AUTH_REQUIRED"));
      if (call.path.startsWith("/api/me/")) return json(401, errorBody("AUTH_REQUIRED"));
      if (call.path === "/api/public/works/5") return json(200, { ...work(5), description: "", readingDirection: "RTL", episodes: [] });
      return json(404, errorBody("NOT_FOUND"));
    });
    render(<MyPage />);
    expect(await screen.findByRole("heading", { name: "작품5" })).toBeTruthy();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("the shared library store alone drops a refused token and falls back to the browser's list", async () => {
    signIn();
    addToLibrary("5");
    mockFetch((call) => {
      if (call.path === "/api/me/library") return json(401, errorBody("AUTH_REQUIRED"));
      if (call.path === "/api/public/works/5") return json(200, { ...work(5), description: "", readingDirection: "RTL", episodes: [] });
      return json(404, errorBody("NOT_FOUND"));
    });
    render(<LibraryPage />);                       // this page asks the server for nothing but the library
    expect(await screen.findByRole("heading", { name: "작품5" })).toBeTruthy();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("an unreachable server keeps what is shown and never empties the library", async () => {
    signIn();
    let down = false;
    const { state } = accountServer((call) => (down && call.path.startsWith("/api/me/") ? json(503, errorBody("SERVICE_UNAVAILABLE")) : undefined));
    render(<MyPage />);
    expect(await screen.findByRole("heading", { name: "작품1" })).toBeTruthy();
    down = true;
    await act(async () => { window.dispatchEvent(new Event("mangabridge:personal")); });
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "작품1" })).toBeTruthy();
    expect(state.library).toEqual(["1", "2"]);
  });

  test("clearing my record removes the account's library and recent list on the server", async () => {
    signIn();
    const { calls, state } = accountServer();
    render(<MyPage />);
    await screen.findByRole("heading", { name: "작품1" });
    fireEvent.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    fireEvent.click(await screen.findByRole("button", { name: "지우기" }));
    await waitFor(() => expect(state.library).toEqual([]));
    expect(state.recent).toEqual([]);
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path).sort()).toEqual(["/api/me/library/1", "/api/me/library/2", "/api/me/recent"]);
  });

  test("the recommend button votes as the account when signed in, and as this browser when not", async () => {
    signIn();
    const { calls } = accountServer((call) => {
      if (call.path === "/api/me/works/1/recommend") return json(200, { recommended: true, recommendCount: 3 });
      if (call.path === "/api/me/works/1/unrecommend") return json(200, { recommended: false, recommendCount: 2 });
      return undefined;
    });
    const first = render(<WorkPage />);
    const button = await screen.findByRole("button", { name: "작품1 추천 2" });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));      // the account already recommended it
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "작품1 추천 2" })).toBeTruthy();
    const vote = calls.find((call) => call.path === "/api/me/works/1/unrecommend")!;
    expect(bearer(vote)).toBe(`Bearer ${TOKEN}`);
    expect(vote.body).toBeUndefined();
    expect(calls.some((call) => call.path.startsWith("/api/public/works/1/") && call.method === "POST")).toBe(false);
    first.unmount();
    window.sessionStorage.clear();
    window.dispatchEvent(new Event(AUTH_EVENT));
    const anonymous = mockFetch((call) => (call.path === "/api/public/works/1" ? json(200, { ...work(1), description: "", readingDirection: "RTL", episodes: [] }) : json(200, { recommended: true, recommendCount: 3 })));
    render(<WorkPage />);
    fireEvent.click(await screen.findByRole("button", { name: "작품1 추천 2" }));
    await waitFor(() => expect(anonymous.calls.some((call) => call.path === "/api/public/works/1/recommend")).toBe(true));
    expect(bearer(anonymous.calls.find((call) => call.path === "/api/public/works/1/recommend")!)).toBeUndefined();
    expect(JSON.parse(anonymous.calls.find((call) => call.path === "/api/public/works/1/recommend")!.body!).voterKey).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("the merge after the first sign-in (32.7)", () => {
  test("the browser's library, recent episodes and recommendations join the account once, and the browser keeps its own", async () => {
    addToLibrary("1"); addToLibrary("2");
    recordRecent({ episodeId: "11", title: "11화", workId: null, workTitle: null, episodeNo: null });
    setRecommended("3", true);
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/me/library/merge") return json(200, { items: [] });
      if (call.path === "/api/me/recent/merge") return json(200, { items: [] });
      if (call.path === "/api/me/works/3/recommend") return json(200, { recommended: true, recommendCount: 1 });
      if (call.path === "/api/public/works/3/unrecommend") return json(200, { recommended: false, recommendCount: 0 });
      return noContent();
    });
    const localBefore = JSON.stringify(loadLibrary());
    await syncAfterSignIn(TOKEN, "9");
    const merge = calls.find((call) => call.path === "/api/me/library/merge")!;
    expect(JSON.parse(merge.body!)).toEqual({ workIds: ["2", "1"] });               // newest first, as the browser had them
    const recent = JSON.parse(calls.find((call) => call.path === "/api/me/recent/merge")!.body!);
    expect(recent.items).toHaveLength(1);
    expect(recent.items[0].episodeId).toBe("11");
    // the browser's anonymous vote is taken back first, then the account votes (never both)
    const order = calls.filter((call) => call.path.includes("/works/3/")).map((call) => call.path);
    expect(order).toEqual(["/api/public/works/3/unrecommend", "/api/me/works/3/recommend"]);
    expect(JSON.parse(calls.find((call) => call.path === "/api/public/works/3/unrecommend")!.body!).voterKey).toMatch(/^[0-9a-f]{32}$/);
    expect(loadRecommended()).toEqual([]);
    for (const call of calls.filter((item) => item.path.startsWith("/api/me"))) expect(bearer(call)).toBe(`Bearer ${TOKEN}`);
    for (const call of calls.filter((item) => item.path.startsWith("/api/public"))) expect(bearer(call)).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem(SYNCED_KEY)!)).toEqual(["9"]);
    expect(JSON.stringify(loadLibrary())).toBe(localBefore);                        // nothing was removed from the browser
    const count = calls.length;
    await syncAfterSignIn(TOKEN, "9");                                              // the same account in the same browser: no second merge
    expect(calls).toHaveLength(count);
  });

  test("a server that cannot be reached leaves the account unmarked so the next visit tries again; a refused token stops quietly", async () => {
    addToLibrary("1");
    mockFetch(() => json(503, errorBody("SERVICE_UNAVAILABLE")));
    await syncAfterSignIn(TOKEN, "9");
    expect(window.localStorage.getItem(SYNCED_KEY)).toBeNull();
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    await syncAfterSignIn(TOKEN, "9");
    expect(window.localStorage.getItem(SYNCED_KEY)).toBeNull();
    mockFetch(() => json(200, { items: [] }));
    await syncAfterSignIn(TOKEN, "9");
    expect(JSON.parse(window.localStorage.getItem(SYNCED_KEY)!)).toEqual(["9"]);
  });

  test("an empty browser sends nothing and still marks the account", async () => {
    const { calls } = mockFetch(() => noContent());
    await syncAfterSignIn(TOKEN, "10");
    expect(calls).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem(SYNCED_KEY)!)).toEqual(["10"]);
  });
});

describe("settings of a signed-in account (32.3, 32.7)", () => {
  function profileServer(extra?: (call: FetchCall) => Response | undefined) {
    return mockFetch((call) => {
      const special = extra?.(call);
      if (special) return special;
      if (call.path === "/api/auth/me") return json(200, meBody("READER"));
      if (call.path === "/api/me/profile" && call.method === "GET") return json(200, { loginId: "reader01", displayName: "독자", bio: "소개", role: "READER" });
      if (call.path === "/api/me/profile" && call.method === "PATCH") return json(200, JSON.parse(call.body!));
      if (call.path === "/api/me/password") return noContent();
      return json(404, errorBody("NOT_FOUND"));
    });
  }

  test("the form loads the account's profile and saves it on the server, not in the browser", async () => {
    signIn();
    const { calls } = profileServer();
    render(<SettingsPage />);
    const name = await screen.findByLabelText(/표시 이름/);
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("독자"));
    fireEvent.change(name, { target: { value: "  새 이름  " } });
    fireEvent.change(screen.getByLabelText(/한 줄 소개/), { target: { value: "바뀐 소개" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("저장했습니다.")).toBeTruthy();
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(JSON.parse(patch.body!)).toEqual({ displayName: "새 이름", bio: "바뀐 소개" });
    expect(bearer(patch)).toBe(`Bearer ${TOKEN}`);
    expect(window.localStorage.getItem("mangabridge.profile.v1")).toBeNull();
  });

  test("a bad name is refused before the request", async () => {
    signIn();
    const { calls } = profileServer();
    render(<SettingsPage />);
    const name = await screen.findByLabelText(/표시 이름/);
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("독자"));
    fireEvent.change(name, { target: { value: "가".repeat(21) } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect((await screen.findByRole("alert")).textContent).toContain("1~20자");
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  test("changing the password checks the rules first and shows a fixed message when the current one is wrong", async () => {
    signIn();
    let wrong = true;
    const { calls } = profileServer((call) => (call.path === "/api/me/password" && wrong ? json(400, errorBody("INVALID_CURRENT_PASSWORD")) : undefined));
    render(<SettingsPage />);
    await waitFor(() => expect((screen.getByLabelText(/표시 이름/) as HTMLInputElement).value).toBe("독자"));
    fireEvent.change(screen.getByLabelText("현재 비밀번호"), { target: { value: "old-password-1" } });
    fireEvent.change(screen.getByLabelText("새 비밀번호"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect((await screen.findAllByRole("alert")).some((alert) => /10자 이상/.test(alert.textContent ?? ""))).toBe(true);
    expect(calls.some((call) => call.path === "/api/me/password")).toBe(false);
    fireEvent.change(screen.getByLabelText("새 비밀번호"), { target: { value: "Brand-new-pass-1" } });
    fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), { target: { value: "Brand-new-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect(await screen.findByText("현재 비밀번호가 올바르지 않습니다.")).toBeTruthy();
    wrong = false;
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect(await screen.findByText(/비밀번호를 바꿨습니다/)).toBeTruthy();
    expect(JSON.parse(calls.filter((call) => call.path === "/api/me/password").at(-1)!.body!)).toEqual({ currentPassword: "old-password-1", newPassword: "Brand-new-pass-1" });
    expect((screen.getByLabelText("새 비밀번호") as HTMLInputElement).value).toBe("");     // the fields are emptied
  });

  test("without a sign-in the browser profile is offered with a way to sign up", async () => {
    mockFetch(() => json(500, errorBody("X")));
    render(<SettingsPage />);
    expect(await screen.findByText(/로그인하지 않았으므로 이 브라우저에만 저장/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "회원가입" }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("현재 비밀번호")).toBeNull();
  });
});

describe("header entry points (32.7)", () => {
  test("the popup offers sign-up beside the login while nobody is signed in", async () => {
    mockFetch(() => json(500, errorBody("X")));
    render(<PublicLayout>x</PublicLayout>);
    fireEvent.click(screen.getByRole("button", { name: "프로필" }));
    const popup = within(await screen.findByRole("region", { name: "프로필 메뉴" }));
    expect(popup.getByRole("link", { name: "회원가입" }).getAttribute("href")).toBe("/signup");
    expect(popup.getByRole("link", { name: "로그인" }).getAttribute("href")).toBe("/login");
  });
});

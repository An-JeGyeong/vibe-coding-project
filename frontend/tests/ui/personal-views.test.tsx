import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HomePage from "@/app/(public)/page";
import LibraryPage from "@/app/(public)/library/page";
import MyPage from "@/app/(public)/my/page";
import WorksPage from "@/app/(public)/works/page";
import PublicLayout from "@/app/(public)/layout";
import { LIBRARY_KEY, addToLibrary, loadLibrary } from "@/lib/personal/library";
import { RECENT_KEY, loadRecent, recordRecent } from "@/lib/personal/recent";
import { THEME_KEY } from "@/lib/personal/theme";
import { SETTINGS_KEY } from "@/lib/viewer/storage";
import { TOKEN_STORAGE_KEY } from "@/lib/auth/storage";
import { TOKEN, errorBody, json, meBody, mockFetch, noContent } from "./helpers";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/",
}));

const T = "2026-10-08T01:00:00.123456Z";
const work = (id: number, title = `작품${id}`, author = `작가${id}`) =>
  ({ workId: String(id), title, author, genres: ["판타지"], hasCover: false, episodeCount: 2, latestPublishedAt: T, views: 10 * id });
const detail = (id: number) => ({ ...work(id), description: "소개", readingDirection: "RTL", episodes: [] });

beforeEach(() => { nav.search = ""; document.documentElement.removeAttribute("data-bs-theme"); });

/** A catalog server with 3 works; `genre` narrows, `sort=popular` reverses (views grow with the id). */
function catalog(extra?: (path: string) => Response | undefined) {
  const all = [work(1, "낯선 항구", "이작가"), work(2, "Dragon Quest", "Kim"), work(3, "달의 정원", "박작가")];
  return mockFetch((call) => {
    const special = extra?.(call.path);
    if (special) return special;
    if (call.path === "/api/public/works") {
      const url = new URL(call.url);
      const items = url.searchParams.get("sort") === "popular" ? [...all].reverse() : all;
      return json(200, { items, total: items.length });
    }
    const match = /^\/api\/public\/works\/(\d+)$/.exec(call.path);
    if (match) return Number(match[1]) <= 3 ? json(200, detail(Number(match[1]))) : json(404, errorBody("NOT_FOUND"));
    return json(404, errorBody("NOT_FOUND"));
  });
}

describe("works search /works (30.2)", () => {
  test("filters by title and author, keeps the query in the address and shows the count", async () => {
    catalog();
    render(<WorksPage />);
    await screen.findByText("3개의 작품");
    fireEvent.change(screen.getByLabelText("작품 제목·작가 검색"), { target: { value: "dragon" } });
    expect(await screen.findByText("1개의 작품")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dragon Quest" })).toBeTruthy();
    expect(window.location.search).toBe("?q=dragon");
    fireEvent.change(screen.getByLabelText("작품 제목·작가 검색"), { target: { value: "박작가" } });
    expect(await screen.findByRole("heading", { name: "달의 정원" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("작품 제목·작가 검색"), { target: { value: "없는작품" } });
    expect(await screen.findByText("검색 결과가 없습니다.")).toBeTruthy();
  });

  test("the address sets the first query, genre and sort; the genre chip and sort go to the server", async () => {
    nav.search = "q=%EC%A0%95%EC%9B%90&genre=%ED%8C%90%ED%83%80%EC%A7%80&sort=popular";
    const { calls } = catalog();
    render(<WorksPage />);
    await screen.findByRole("heading", { name: "달의 정원" });
    expect((screen.getByLabelText("작품 제목·작가 검색") as HTMLInputElement).value).toBe("정원");
    const first = new URL(calls.find((call) => call.path === "/api/public/works")!.url).searchParams;
    expect(first.get("genre")).toBe("판타지");
    expect(first.get("sort")).toBe("popular");
    expect(first.get("limit")).toBe("50");
    expect(screen.getByRole("button", { name: "판타지" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/public/works").some((call) => !new URL(call.url).searchParams.has("genre"))).toBe(true));
  });

  test("a failure shows a message and a retry that loads the works", async () => {
    let healthy = false;
    catalog((path) => (path === "/api/public/works" && !healthy ? json(503, errorBody("SERVICE_UNAVAILABLE")) : undefined));
    render(<WorksPage />);
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    healthy = true;
    fireEvent.click(retry);
    expect(await screen.findByText("3개의 작품")).toBeTruthy();
  });

  test("pages through the server list until every work is loaded (50 per page)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => work(i + 1));
    const { calls } = mockFetch((call) => {
      const url = new URL(call.url);
      const offset = Number(url.searchParams.get("offset"));
      return json(200, { items: many.slice(offset, offset + 50), total: 60 });
    });
    render(<WorksPage />);
    expect(await screen.findByText("60개의 작품")).toBeTruthy();
    expect(calls.map((call) => new URL(call.url).searchParams.get("offset"))).toEqual(["0", "50"]);
  });
});

describe("hearts and the library (30.2)", () => {
  test("the heart on a work card puts the work into the library and takes it out, outside the card link", async () => {
    catalog();
    render(<WorksPage />);
    const heart = await screen.findByRole("button", { name: "낯선 항구 내 서재에 담기" });
    expect(heart.closest("a")).toBeNull();
    fireEvent.click(heart);
    expect(loadLibrary().map((item) => item.workId)).toEqual(["1"]);
    const on = await screen.findByRole("button", { name: "낯선 항구 내 서재에서 빼기" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(on);
    expect(loadLibrary()).toEqual([]);
  });

  test("/library shows bookmarked works, marks a work that is no longer public and lets it be removed", async () => {
    addToLibrary("1"); addToLibrary("99"); addToLibrary("2");
    catalog();
    render(<LibraryPage />);
    expect(await screen.findByRole("heading", { name: "작품1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "작품2" })).toBeTruthy();
    const gone = await screen.findByRole("region", { name: "공개되지 않은 작품" });
    expect(within(gone).getByText("작품 #99")).toBeTruthy();
    fireEvent.click(within(gone).getByRole("button", { name: "작품 #99 서재에서 빼기" }));
    expect(loadLibrary().map((item) => item.workId)).toEqual(["2", "1"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "공개되지 않은 작품" })).toBeNull());
  });

  test("/library when empty links to the work search and calls no server", () => {
    const { calls } = catalog();
    render(<LibraryPage />);
    return screen.findByRole("link", { name: "작품 찾기" }).then((link) => {
      expect(link.getAttribute("href")).toBe("/works");
      expect(calls).toHaveLength(0);
    });
  });

  test("looks up at most four bookmarked works at the same time", async () => {
    for (let id = 1; id <= 10; id++) addToLibrary(String(id));
    let running = 0, peak = 0;
    mockFetch(async (call) => {
      const id = Number(call.path.split("/").pop());
      running++; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return json(200, detail(id));
    });
    render(<LibraryPage />);
    await screen.findByRole("heading", { name: "작품10" }, { timeout: 3000 });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("main page additions (30.2)", () => {
  test("the search box goes to /works?q= and the continue-reading section appears only with recent episodes", async () => {
    mockFetch(() => json(503, errorBody("SERVICE_UNAVAILABLE")));
    const first = render(<HomePage />);
    const form = (await screen.findByRole("search")) as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/works");
    expect((within(form).getByLabelText("작품 제목·작가 검색") as HTMLInputElement).name).toBe("q");
    expect(screen.queryByRole("region", { name: "이어 읽기" })).toBeNull();
    first.unmount();
    for (let n = 1; n <= 6; n++) recordRecent({ episodeId: String(n), title: `${n}화`, workId: "1", workTitle: "낯선 항구", episodeNo: n });
    render(<HomePage />);
    const section = await screen.findByRole("region", { name: "이어 읽기" });
    const links = within(section).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[0].getAttribute("href")).toBe("/read/6");
  });
});

describe("my page /my (30.2)", () => {
  test("without a token the account area offers a login and the server is not asked", async () => {
    const { calls } = mockFetch(() => json(500, errorBody("X")));
    render(<MyPage />);
    expect(await screen.findByText(/로그인하지 않았습니다/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  test("with a token the account shows what the server confirms and logout clears the token", async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody("TRANSLATOR")) : noContent()));
    render(<MyPage />);
    expect(await screen.findByText("데모 번역가")).toBeTruthy();
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByText(/로그인하지 않았습니다/)).toBeTruthy();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(calls.some((call) => call.path === "/api/auth/logout" && call.method === "POST")).toBe(true);
  });

  test("a rejected token is dropped; a server outage is reported without dropping it", async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    mockFetch(() => json(401, errorBody("UNAUTHORIZED")));
    const first = render(<MyPage />);
    expect(await screen.findByText(/로그인하지 않았습니다/)).toBeTruthy();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    first.unmount();
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    mockFetch(() => json(503, errorBody("SERVICE_UNAVAILABLE")));
    render(<MyPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  test("library summary, recent list with clear, reading settings, theme, and clear-all with confirmation", async () => {
    addToLibrary("1"); addToLibrary("2");
    recordRecent({ episodeId: "5", title: "5화", workId: "1", workTitle: "낯선 항구", episodeNo: 5 });
    mockFetch(() => json(500, errorBody("X")));
    render(<MyPage />);
    await screen.findByText(/로그인하지 않았습니다/);
    expect(screen.getByText("2개의 작품을 담았습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /낯선 항구 · 5화/ }).getAttribute("href")).toBe("/read/5");

    fireEvent.change(screen.getByLabelText("보기 방식"), { target: { value: "scroll" } });
    fireEvent.change(screen.getByLabelText("쪽 수"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("읽기 방향"), { target: { value: "ltr" } });
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ mode: "scroll", spread: true, direction: "ltr" });

    fireEvent.click(screen.getByRole("button", { name: "다크" }));
    expect(window.localStorage.getItem(THEME_KEY)).toBe('"dark"');
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "기록 지우기" }));
    expect(loadRecent()).toEqual([]);
    expect(loadLibrary()).toHaveLength(2);

    recordRecent({ episodeId: "6", title: "6화", workId: null, workTitle: null, episodeNo: null });
    fireEvent.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(loadLibrary()).toHaveLength(2); // nothing is deleted before the confirmation
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(loadLibrary()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(loadLibrary()).toEqual([]);
    expect(loadRecent()).toEqual([]);
    expect(window.localStorage.getItem(LIBRARY_KEY)).toBeNull();
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(THEME_KEY)).toBe('"dark"'); // settings and theme stay
    expect(window.localStorage.getItem(SETTINGS_KEY)).not.toBeNull();
  });
});

describe("theme toggle in the header (30.2)", () => {
  test("switches the theme, names the mode it switches to and remembers it", async () => {
    render(<PublicLayout>x</PublicLayout>);
    const toggle = screen.getByRole("button", { name: "다크 모드" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
    const back = await screen.findByRole("button", { name: "라이트 모드" });
    expect(back.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(THEME_KEY)).toBe('"dark"');
    fireEvent.click(back);
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("light");
  });

  test("a stored dark theme shows the light-mode switch after loading, and the header has the new links", async () => {
    window.localStorage.setItem(THEME_KEY, '"dark"');
    render(<PublicLayout>x</PublicLayout>);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "라이트 모드" })).toBeTruthy();
    const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
    expect(nav.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["홈", "/"], ["작품", "/works"], ["랭킹", "/ranking"], ["회차 목록", "/read"], ["내 서재", "/library"], ["마이페이지", "/my"], ["작업 공간", "/demo"],
    ]);
  });
});

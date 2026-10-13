import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HomePage from "@/app/(public)/page";
import WorkPage from "@/app/(public)/works/[id]/page";
import ReadEpisodePage from "@/app/(public)/read/[id]/page";
import { getEpisodeWork, getHome, getWork, listWorks, recordView } from "@/lib/catalog/client";
import { GENRES } from "@/lib/catalog/types";
import { loadRecent } from "@/lib/personal/recent";
import { saveViewerPosition, SETTINGS_KEY, loadSettings } from "@/lib/viewer/storage";
import { COUNTED_KEY, shouldCountView } from "@/lib/viewer/views";
import { errorBody, json, mockFetch, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ params: { id: "1" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => nav.params }));

const T = "2026-10-08T01:00:00.123456Z";
const work = (id: number, title = `작품${id}`, extra: Record<string, unknown> = {}) =>
  ({ workId: String(id), title, author: `작가${id}`, genres: ["판타지", "액션"], hasCover: true, episodeCount: 3, latestPublishedAt: T, views: 1234, ...extra });
const latestItem = (id: number, extra: Record<string, unknown> = {}) => ({ episodeId: String(id), title: `${id}화 제목`, publishedAt: T, workId: "1", workTitle: "작품1", episodeNo: id, ...extra });
const home = (extra: Record<string, unknown> = {}) => ({ banners: [work(1), work(2)], latest: [latestItem(3), latestItem(2, { workId: null, workTitle: null, episodeNo: null })], popular: [work(3)], featured: [work(4)], ...extra });
const detail = (extra: Record<string, unknown> = {}) => ({
  ...work(1), description: "첫 줄\n둘째 줄", readingDirection: "RTL",
  episodes: [{ episodeId: "11", episodeNo: 1, title: "시작", publishedAt: T }, { episodeId: "12", episodeNo: 2, title: "둘째", publishedAt: T }, { episodeId: "13", episodeNo: 3, title: "셋째", publishedAt: T }], ...extra,
});

// the page is on screen AND the key listener (a passive effect) is registered, even on a loaded machine
async function ready() { await screen.findByRole("img", { name: "페이지 1" }); await act(async () => {}); }
beforeEach(() => { nav.params = { id: "1" }; });
afterEach(() => vi.unstubAllGlobals());

describe("catalog client (28.4)", () => {
  test("home, works, work and episode-work parse the documented shapes and send no token", async () => {
    window.sessionStorage.setItem("mangabridge.demoAuth.accessToken", "never-sent");
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/public/home") return json(200, home());
      if (call.path === "/api/public/works") return json(200, { items: [work(1)], total: 1 });
      if (call.path === "/api/public/works/1") return json(200, detail());
      if (call.path === "/api/public/episodes/11/work") return json(200, { workId: "1", title: "작품1", readingDirection: "LTR", episodeNo: 1 });
      return json(404, errorBody("NOT_FOUND"));
    });
    const h = await getHome();
    expect(h.ok && h.value.latest[1]).toMatchObject({ workId: null, workTitle: null, episodeNo: null });
    const list = await listWorks({ genre: "판타지", sort: "popular", limit: 12, offset: 24 });
    expect(list.ok && list.value.total).toBe(1);
    const query = new URL(calls[1].url).searchParams;
    expect([query.get("genre"), query.get("sort"), query.get("limit"), query.get("offset")]).toEqual(["판타지", "popular", "12", "24"]);
    await listWorks({});
    expect(new URL(calls[2].url).searchParams.has("genre")).toBe(false);
    const d = await getWork("1");
    expect(d.ok && d.value.episodes).toHaveLength(3);
    const ew = await getEpisodeWork("11");
    expect(ew.ok && ew.value.readingDirection).toBe("LTR");
    const none = await getEpisodeWork("99");
    expect(none).toEqual({ ok: false, failure: { kind: "not_found" } });
    for (const call of calls) expect(call.headers.Authorization ?? call.headers.authorization).toBeUndefined();
  });

  test("a malformed answer is rejected instead of rendered", async () => {
    mockFetch((call) => (call.path === "/api/public/home" ? json(200, { banners: [{ workId: 1 }], latest: [], popular: [], featured: [] }) : json(200, { items: [{ workId: "1" }], total: 1 })));
    expect((await getHome()).ok).toBe(false);
    expect((await listWorks({})).ok).toBe(false);
  });

  test("recordView is a POST without body or token and never throws", async () => {
    window.sessionStorage.setItem("mangabridge.demoAuth.accessToken", "never-sent");
    const { calls } = mockFetch(() => new Response(null, { status: 204 }));
    await recordView("7");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/public/episodes/7/views");
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers.Authorization).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(recordView("7")).resolves.toBeUndefined();
  });
});

describe("view counting guard and reading direction default (28.6)", () => {
  test("an episode is counted once per session; blocked storage counts every time", () => {
    expect(shouldCountView("5")).toBe(true);
    expect(shouldCountView("5")).toBe(false);
    expect(shouldCountView("6")).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem(COUNTED_KEY)!)).toEqual(["5", "6"]);
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(shouldCountView("5")).toBe(true);
    expect(shouldCountView("5")).toBe(true);
  });
  test("the work's direction applies only while the reader has not chosen one", () => {
    expect(loadSettings().direction).toBe("rtl");
    expect(loadSettings("ltr").direction).toBe("ltr");
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: "scroll", spread: false, direction: "rtl" }));
    expect(loadSettings("ltr")).toEqual({ mode: "scroll", spread: false, direction: "rtl" }); // the reader's own choice wins
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: "scroll" }));
    expect(loadSettings("ltr")).toMatchObject({ mode: "scroll", direction: "ltr" });
  });
});

describe("main page with the catalog (28.6)", () => {
  function open(routes: Record<string, (call: FetchCall) => Response> = {}) {
    return mockFetch((call) => {
      const handler = routes[call.path];
      if (handler) return handler(call);
      if (call.path === "/api/public/home") return json(200, home());
      if (call.path === "/api/public/works") return json(200, { items: [work(9, "장르 작품")], total: 1 });
      throw new Error(`unexpected ${call.path}`);
    });
  }

  test("shows latest with work info, popular, featured and the genre tabs; nothing for genres is requested yet", async () => {
    const { calls } = open();
    render(<HomePage />);
    expect(await screen.findByRole("region", { name: "최신 공개 회차" })).toBeTruthy();
    const latest = screen.getByRole("region", { name: "최신 공개 회차" });
    expect(within(latest).getByText("작품1 · 3화")).toBeTruthy();
    expect(within(latest).getAllByRole("link").map((link) => link.getAttribute("href"))).toContain("/read/3");
    expect(within(screen.getByRole("region", { name: "인기 작품" })).getByRole("link", { name: /작품3/ }).getAttribute("href")).toBe("/works/3");
    expect(within(screen.getByRole("region", { name: "운영자 추천" })).getByRole("link", { name: /작품4/ })).toBeTruthy();
    expect(GENRES.every((genre) => screen.getByRole("button", { name: genre }))).toBe(true);
    expect(screen.getByRole("button", { name: "전체" })).toBeTruthy();
    expect(calls.map((call) => call.path)).toEqual(["/api/public/home"]);
  });

  test("a cover is a public image URL with the work title as alt text; a failing cover falls back to a lettered placeholder", async () => {
    open();
    render(<HomePage />);
    const card = (await screen.findByRole("region", { name: "인기 작품" }));
    const image = within(card).getByRole("img", { name: "작품3 표지" }) as HTMLImageElement;
    expect(image.getAttribute("src")).toMatch(/\/api\/public\/works\/3\/cover$/);
    fireEvent.error(image);
    expect(within(card).getByRole("img", { name: "작품3 표지 없음" })).toBeTruthy();
  });

  test("a work without a cover and empty sections: placeholder shown, empty sections hidden", async () => {
    open({ "/api/public/home": () => json(200, home({ banners: [], popular: [work(3, "작품3", { hasCover: false })], featured: [] })) });
    render(<HomePage />);
    const popular = await screen.findByRole("region", { name: "인기 작품" });
    expect(within(popular).getByRole("img", { name: "작품3 표지 없음" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "추천 배너" })).toBeNull();
    expect(screen.queryByRole("region", { name: "운영자 추천" })).toBeNull();
  });

  test("nothing public at all shows one note", async () => {
    open({ "/api/public/home": () => json(200, { banners: [], latest: [], popular: [], featured: [] }) });
    render(<HomePage />);
    expect(await screen.findByText("아직 공개된 회차가 없습니다.")).toBeTruthy();
  });

  test("the banner data of the home answer is not shown: the hero is the top of the page (D-058)", async () => {
    open();
    render(<HomePage />);
    await screen.findByRole("region", { name: "최신 공개 회차" });
    expect(screen.queryByRole("region", { name: "추천 배너" })).toBeNull();
    expect(screen.queryByRole("button", { name: "다음 배너" })).toBeNull();
    expect(screen.getByRole("heading", { name: "번역된 만화를 읽어 보세요" })).toBeTruthy();
  });

  test("choosing a genre loads that genre's works (popular first); 'all' sends no genre; a failure only affects that area and can be retried", async () => {
    let healthy = false;
    const { calls } = open({ "/api/public/works": () => (healthy ? json(200, { items: [work(9, "장르 작품")], total: 1 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    render(<HomePage />);
    await screen.findByRole("region", { name: "장르별 작품" });
    fireEvent.click(screen.getByRole("button", { name: "로맨스" }));
    const area = screen.getByRole("region", { name: "장르별 작품" });
    expect(await within(area).findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("region", { name: "인기 작품" })).toBeTruthy(); // the other sections stay
    healthy = true;
    fireEvent.click(within(area).getByRole("button", { name: "다시 시도" }));
    expect(await within(area).findByRole("link", { name: /장르 작품/ })).toBeTruthy();
    const query = new URL(calls.filter((call) => call.path === "/api/public/works").at(-1)!.url).searchParams;
    expect([query.get("genre"), query.get("sort")]).toEqual(["로맨스", "popular"]);
    fireEvent.click(within(area).getByRole("button", { name: "전체" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/public/works")).toHaveLength(3));
    expect(new URL(calls.at(-1)!.url).searchParams.has("genre")).toBe(false);
    expect(within(area).getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("an empty genre says so", async () => {
    open({ "/api/public/works": () => json(200, { items: [], total: 0 }) });
    render(<HomePage />);
    await screen.findByRole("region", { name: "장르별 작품" });
    fireEvent.click(screen.getByRole("button", { name: "SF" }));
    expect(await screen.findByText("이 장르의 공개 작품이 아직 없습니다.")).toBeTruthy();
  });
});

describe("work page (28.6)", () => {
  function open(body: unknown = detail(), status = 200) {
    return mockFetch((call) => {
      if (call.path === "/api/public/works/1") return status === 200 ? json(200, body) : json(status, errorBody("NOT_FOUND"));
      throw new Error(`unexpected ${call.path}`);
    });
  }

  test("shows cover, facts, description with line breaks, direction and episodes newest first; the order can be flipped", async () => {
    open();
    render(<WorkPage />);
    expect(await screen.findByRole("heading", { name: "작품1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "작품1 표지" })).toBeTruthy();
    expect(screen.getByText("작가1")).toBeTruthy();
    expect(screen.getByText("판타지")).toBeTruthy();
    expect(screen.getByText(/오른쪽→왼쪽/)).toBeTruthy();
    expect(screen.getByText(/첫 줄/).getAttribute("style")).toContain("pre-wrap");
    const order = () => within(screen.getByRole("region", { name: "회차 목록" })).getAllByRole("link").map((link) => link.textContent);
    expect(order()).toEqual(["3화 · 셋째", "2화 · 둘째", "1화 · 시작"]);
    fireEvent.click(screen.getByRole("button", { name: "첫 화부터 보기" }));
    expect(order()).toEqual(["1화 · 시작", "2화 · 둘째", "3화 · 셋째"]);
    expect(screen.getByRole("link", { name: "첫 화 보기" }).getAttribute("href")).toBe("/read/11");
    expect(screen.queryByRole("link", { name: /이어 읽기/ })).toBeNull();
  });

  test("a saved viewer position offers 'continue' for the furthest such episode, and only for the publication shown now", async () => {
    saveViewerPosition("12", 4, T);
    saveViewerPosition("11", 2, T);
    saveViewerPosition("13", 1, "2026-01-01T00:00:00.000000Z"); // an older publication: discarded
    open();
    render(<WorkPage />);
    const link = await screen.findByRole("link", { name: "이어 읽기 (2화)" });
    expect(link.getAttribute("href")).toBe("/read/12");
  });

  test("LTR works are labelled left-to-right", async () => {
    open(detail({ readingDirection: "LTR" }));
    render(<WorkPage />);
    expect(await screen.findByText(/왼쪽→오른쪽/)).toBeTruthy();
  });

  test("an unknown or unpublished work (404) and an invalid id show a fixed notice with a way back; other failures can be retried", async () => {
    open(null, 404);
    const first = render(<WorkPage />);
    expect(await screen.findByText("공개되지 않았거나 존재하지 않는 작품입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "메인으로" }).getAttribute("href")).toBe("/");
    first.unmount();
    nav.params = { id: "abc" };
    const calls = open().calls;
    render(<WorkPage />);
    expect(screen.getByText("공개되지 않았거나 존재하지 않는 작품입니다.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  test("a server failure offers a retry that loads the work", async () => {
    let healthy = false;
    mockFetch(() => (healthy ? json(200, detail()) : json(503, errorBody("SERVICE_UNAVAILABLE"))));
    render(<WorkPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { name: "작품1" })).toBeTruthy();
  });
});

describe("viewer inside a work (28.6)", () => {
  function open(direction = "LTR", episodes = detail().episodes) {
    nav.params = { id: "12" };
    return mockFetch((call) => {
      if (call.path === "/api/public/episodes/12") return json(200, { episodeId: "12", title: "둘째", publishedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "본문" }] });
      if (call.path === "/api/public/episodes/12/pages") return json(200, { items: [{ pageNo: 1 }, { pageNo: 2 }] });
      if (call.path === "/api/public/episodes/12/work") return json(200, { workId: "1", title: "작품1", readingDirection: direction, episodeNo: 2 });
      if (call.path === "/api/public/works/1") return json(200, detail({ readingDirection: direction, episodes }));
      if (call.path === "/api/public/episodes") return json(200, { items: [{ episodeId: "1", title: "전체 첫째", publishedAt: T }, { episodeId: "12", title: "둘째", publishedAt: T }, { episodeId: "99", title: "전체 다음", publishedAt: T }], total: 3 });
      if (call.path === "/api/public/episodes/12/views") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${call.path}`);
    });
  }
  const shown = () => screen.getAllByRole("img").map((image) => image.getAttribute("alt"));

  test("the work supplies the reading direction, the list link and its own previous and next episodes", async () => {
    open("LTR");
    render(<ReadEpisodePage />);
    await ready();
    expect(screen.getByRole("link", { name: "목록" }).getAttribute("href")).toBe("/works/1");
    expect(screen.getAllByRole("link", { name: /이전화/ })[0].getAttribute("href")).toBe("/read/11");
    expect(screen.getAllByRole("link", { name: /다음화/ })[0].getAttribute("href")).toBe("/read/13");
    fireEvent.click(screen.getByTestId("zone-right")); // left-to-right: the right side goes forward
    expect(shown()).toEqual(["페이지 2"]);
  });

  test("the reader's own direction choice beats the work's", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: "page", spread: false, direction: "rtl" }));
    open("LTR");
    render(<ReadEpisodePage />);
    await ready();
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shown()).toEqual(["페이지 2"]);
  });

  test("opening an episode records it as recently read, with its work (30.1)", async () => {
    open("RTL");
    render(<ReadEpisodePage />);
    await ready();
    await waitFor(() => expect(loadRecent()).toHaveLength(1));
    expect(loadRecent()[0]).toMatchObject({ episodeId: "12", title: "둘째", workId: "1", workTitle: "작품1", episodeNo: 2 });
  });

  test("an episode that fails to load is not recorded as recently read (30.1)", async () => {
    nav.params = { id: "12" };
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    render(<ReadEpisodePage />);
    await screen.findByRole("alert");
    await act(async () => {});
    expect(loadRecent()).toEqual([]);
  });

  test("the first and last episode of the work have no previous or next link", async () => {
    open("RTL", [{ episodeId: "12", episodeNo: 2, title: "둘째", publishedAt: T }]);
    render(<ReadEpisodePage />);
    await ready();
    expect(screen.queryByRole("link", { name: /이전화|다음화/ })).toBeNull();
  });

  test("an episode that belongs to no public work (404) keeps the plain behaviour with neighbours from the whole list", async () => {
    nav.params = { id: "12" };
    mockFetch((call) => {
      if (call.path === "/api/public/episodes/12") return json(200, { episodeId: "12", title: "둘째", publishedAt: T, blocks: [] });
      if (call.path === "/api/public/episodes/12/pages") return json(200, { items: [{ pageNo: 1 }] });
      if (call.path === "/api/public/episodes/12/work") return json(404, errorBody("NOT_FOUND"));
      if (call.path === "/api/public/episodes") return json(200, { items: [{ episodeId: "1", title: "전체 첫째", publishedAt: T }, { episodeId: "12", title: "둘째", publishedAt: T }, { episodeId: "99", title: "전체 다음", publishedAt: T }], total: 3 });
      return new Response(null, { status: 204 });
    });
    render(<ReadEpisodePage />);
    await ready();
    expect(screen.getByRole("link", { name: "목록" }).getAttribute("href")).toBe("/read");
    await waitFor(() => expect(screen.getAllByRole("link", { name: /다음화/ })[0].getAttribute("href")).toBe("/read/99"));
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect((screen.getByLabelText("오른쪽→왼쪽 (일본 만화)") as HTMLInputElement).checked).toBe(true); // the default
  });

  test("one view is counted per session and episode, even when the episode is opened again", async () => {
    const { calls } = open();
    const first = render(<ReadEpisodePage />);
    await ready();
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    first.unmount();
    render(<ReadEpisodePage />);
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "POST")!.path).toBe("/api/public/episodes/12/views");
  });

  test("the text reader counts a view too, and a failing view request changes nothing on screen", async () => {
    nav.params = { id: "12" };
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/public/episodes/12") return json(200, { episodeId: "12", title: "둘째", publishedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "텍스트 본문" }] });
      if (call.path === "/api/public/episodes/12/views") return json(500, errorBody("INTERNAL_ERROR"));
      return json(200, { items: [], total: 0 });
    });
    render(<ReadEpisodePage />);
    expect(await screen.findByText("텍스트 본문")).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

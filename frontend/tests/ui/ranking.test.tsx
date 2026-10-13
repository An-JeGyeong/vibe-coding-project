import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HomePage from "@/app/(public)/page";
import RankingRoute from "@/app/(public)/ranking/page";
import WorkPage from "@/app/(public)/works/[id]/page";
import { getVoterKey, loadRecommended, RECOMMENDED_KEY, setRecommended, VOTER_KEY } from "@/lib/personal/voter";
import { getRanking, setRecommendation } from "@/lib/ranking/client";
import { deferred, errorBody, json, mockFetch, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ search: "", params: { id: "1" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/",
}));

const T = "2026-10-08T01:00:00.123456Z";
const work = (id: number, extra: Record<string, unknown> = {}) =>
  ({ workId: String(id), title: `작품${id}`, author: `작가${id}`, genres: ["판타지"], hasCover: false, episodeCount: 2, latestPublishedAt: T, views: 100, recommendCount: 3, ...extra });
const rankedItem = (id: number, rank: number, extra: Record<string, unknown> = {}) => ({ ...work(id), rank, score: 500 - rank, periodViews: 400, periodRecommends: 10 - rank, ...extra });
const detail = (extra: Record<string, unknown> = {}) => ({ ...work(1), description: "소개", readingDirection: "RTL", episodes: [], ...extra });
const homeBody = () => ({ banners: [], latest: [], popular: [work(7)], featured: [] });

beforeEach(() => { nav.search = ""; nav.params = { id: "1" }; });

/** A catalog server whose ranking answer depends on the period; `handler` can override any path. */
function server(handler?: (call: FetchCall) => Response | Promise<Response> | undefined) {
  return mockFetch((call) => {
    const special = handler?.(call);
    if (special) return special;
    if (call.path === "/api/public/home") return json(200, homeBody());
    if (call.path === "/api/public/rankings") {
      const period = new URL(call.url).searchParams.get("period");
      const base = period === "year" ? 30 : period === "month" ? 20 : 10;
      return json(200, { period, items: [rankedItem(base + 1, 1), rankedItem(base + 2, 2)] });
    }
    if (call.path === "/api/public/works/1") return json(200, detail());
    return json(404, errorBody("NOT_FOUND"));
  });
}
const periodOf = (call: FetchCall) => new URL(call.url).searchParams.get("period");

describe("voter identifier and recommended works (31.6)", () => {
  test("creates a 32-character lowercase hex identifier once and keeps it", () => {
    const first = getVoterKey();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(getVoterKey()).toBe(first);
    expect(JSON.parse(window.localStorage.getItem(VOTER_KEY)!)).toBe(first);
  });

  test("a stored value of the wrong shape is replaced", () => {
    window.localStorage.setItem(VOTER_KEY, JSON.stringify("ABC"));
    expect(getVoterKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  test("blocked storage still gives one identifier for the visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const key = getVoterKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(getVoterKey()).toBe(key);
  });

  test("the recommended list is validated, newest first and survives corrupt values", () => {
    setRecommended("1", true); setRecommended("2", true); setRecommended("1", true); setRecommended("x", true);
    expect(loadRecommended()).toEqual(["1", "2"]);
    setRecommended("1", false);
    expect(loadRecommended()).toEqual(["2"]);
    window.localStorage.setItem(RECOMMENDED_KEY, "{bad");
    expect(loadRecommended()).toEqual([]);
  });
});

describe("ranking client (31.3, 31.4)", () => {
  test("getRanking asks for the period and limit, sends no token and parses the items", async () => {
    window.sessionStorage.setItem("mangabridge.demoAuth.accessToken", "never-sent");
    const { calls } = server();
    const result = await getRanking("month", 5);
    expect(result.ok && result.value.items.map((item) => [item.workId, item.rank, item.score])).toEqual([["21", 1, 499], ["22", 2, 498]]);
    expect(new URL(calls[0].url).search).toBe("?period=month&limit=5");
    expect(calls[0].headers.Authorization ?? calls[0].headers.authorization).toBeUndefined();
  });

  test("a mismatching period or a broken item is an invalid response", async () => {
    mockFetch(() => json(200, { period: "year", items: [] }));
    expect((await getRanking("week")).ok).toBe(false);
    mockFetch(() => json(200, { period: "week", items: [{ ...rankedItem(1, 1), score: "x" }] }));
    expect((await getRanking("week")).ok).toBe(false);
  });

  test("setRecommendation posts only the identifier to the right path and parses the answer", async () => {
    const { calls } = mockFetch(() => json(200, { recommended: true, recommendCount: 4 }));
    const key = "a".repeat(32);
    expect(await setRecommendation("5", key, true)).toEqual({ ok: true, value: { recommended: true, recommendCount: 4 } });
    expect(calls[0].path).toBe("/api/public/works/5/recommend");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body!)).toEqual({ voterKey: key });
    await setRecommendation("5", key, false);
    expect(calls[1].path).toBe("/api/public/works/5/unrecommend");
  });

  test("404, 400 and a malformed answer are failures", async () => {
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    expect(await setRecommendation("5", "a".repeat(32), true)).toMatchObject({ ok: false, failure: { kind: "not_found" } });
    mockFetch(() => json(400, errorBody("INVALID_REQUEST")));
    expect((await setRecommendation("5", "a".repeat(32), true)).ok).toBe(false);
    mockFetch(() => json(200, { recommended: true, recommendCount: -1 }));
    expect((await setRecommendation("5", "a".repeat(32), true)).ok).toBe(false);
  });

  test("a server without recommendCount reads as 0, and a bad value is rejected", async () => {
    const plain: Record<string, unknown> = { ...work(1), rank: 1, score: 1, periodViews: 1, periodRecommends: 0 };
    delete plain.recommendCount;
    mockFetch(() => json(200, { period: "week", items: [plain] }));
    const ok = await getRanking("week");
    expect(ok.ok && ok.value.items[0].recommendCount).toBe(0);
    mockFetch(() => json(200, { period: "week", items: [{ ...rankedItem(1, 1), recommendCount: -2 }] }));
    expect((await getRanking("week")).ok).toBe(false);
  });
});

describe("recommend button on the work page (31.6)", () => {
  test("recommending sends this browser's identifier, shows the server count and remembers it; taking it back reverses both", async () => {
    const { calls } = server((call) => {
      if (call.path === "/api/public/works/1/recommend") return json(200, { recommended: true, recommendCount: 4 });
      if (call.path === "/api/public/works/1/unrecommend") return json(200, { recommended: false, recommendCount: 3 });
      return undefined;
    });
    render(<WorkPage />);
    const button = await screen.findByRole("button", { name: "작품1 추천 3" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    const on = await screen.findByRole("button", { name: "작품1 추천 4" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(loadRecommended()).toEqual(["1"]);
    const post = calls.find((call) => call.path.endsWith("/recommend"))!;
    expect(JSON.parse(post.body!)).toEqual({ voterKey: getVoterKey() });
    fireEvent.click(on);
    expect((await screen.findByRole("button", { name: "작품1 추천 3" })).getAttribute("aria-pressed")).toBe("false");
    expect(loadRecommended()).toEqual([]);
  });

  test("a failure keeps the state and shows a message; a retry then works", async () => {
    let fails = true;
    server((call) => {
      if (call.path !== "/api/public/works/1/recommend") return undefined;
      return fails ? json(503, errorBody("SERVICE_UNAVAILABLE")) : json(200, { recommended: true, recommendCount: 4 });
    });
    render(<WorkPage />);
    fireEvent.click(await screen.findByRole("button", { name: "작품1 추천 3" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "작품1 추천 3" }).getAttribute("aria-pressed")).toBe("false");
    expect(loadRecommended()).toEqual([]);
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "작품1 추천 3" }));
    expect(await screen.findByRole("button", { name: "작품1 추천 4" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a second click while the request is running sends nothing", async () => {
    const gate = deferred<Response>();
    const { calls } = server((call) => (call.path === "/api/public/works/1/recommend" ? gate.promise : undefined));
    render(<WorkPage />);
    const button = await screen.findByRole("button", { name: "작품1 추천 3" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    await act(async () => { gate.resolve(json(200, { recommended: true, recommendCount: 4 })); });
    await screen.findByRole("button", { name: "작품1 추천 4" });
    expect(calls.filter((call) => call.path.endsWith("/recommend"))).toHaveLength(1);
  });
});

describe("ranking page /ranking (31.6)", () => {
  test("shows the weekly ranking first, explains the points and asks for 50", async () => {
    const { calls } = server();
    render(<RankingRoute />);
    expect(await screen.findByRole("list", { name: "주간 랭킹" })).toBeTruthy();
    expect(screen.getByText("지난 7일 · 조회 1점, 추천 10점")).toBeTruthy();
    expect(screen.getByRole("button", { name: "주간" }).getAttribute("aria-pressed")).toBe("true");
    expect(new URL(calls.find((call) => call.path === "/api/public/rankings")!.url).search).toBe("?period=week&limit=50");
    expect(screen.getByText(/1위 · 499점 \(기간 조회 400 · 기간 추천 9\)/)).toBeTruthy();
    // the card above it names its own figures as totals, so the two kinds of numbers cannot be mixed up
    expect(screen.getAllByText(/2개 회차 · 누적 조회 100 · 누적 추천 3/).length).toBeGreaterThan(0);
  });

  test("switching the tab asks only for that period and updates the address", async () => {
    const { calls } = server();
    render(<RankingRoute />);
    await screen.findByRole("list", { name: "주간 랭킹" });
    fireEvent.click(screen.getByRole("button", { name: "연간" }));
    expect(await screen.findByRole("list", { name: "연간 랭킹" })).toBeTruthy();
    expect(screen.getByText("지난 365일 · 조회 1점, 추천 10점")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "작품31" })).toBeTruthy();
    expect(window.location.search).toBe("?period=year");
    expect(calls.filter((call) => call.path === "/api/public/rankings").map(periodOf)).toEqual(["week", "year"]);
    fireEvent.click(screen.getByRole("button", { name: "주간" }));
    await screen.findByRole("list", { name: "주간 랭킹" });
    expect(window.location.search).toBe("");
  });

  test("the address picks the first period; an unknown value means weekly", async () => {
    nav.search = "period=month";
    server();
    const first = render(<RankingRoute />);
    expect(await screen.findByRole("list", { name: "월간 랭킹" })).toBeTruthy();
    first.unmount();
    nav.search = "period=decade";
    render(<RankingRoute />);
    expect(await screen.findByRole("list", { name: "주간 랭킹" })).toBeTruthy();
  });

  test("an empty period shows a note, a failure shows a retry that loads the ranking", async () => {
    let state: "empty" | "fail" | "ok" = "empty";
    server((call) => {
      if (call.path !== "/api/public/rankings") return undefined;
      if (state === "empty") return json(200, { period: periodOf(call), items: [] });
      if (state === "fail") return json(503, errorBody("SERVICE_UNAVAILABLE"));
      return undefined;
    });
    render(<RankingRoute />);
    expect(await screen.findByText("이 기간에는 아직 집계된 작품이 없습니다.")).toBeTruthy();
    state = "fail";
    fireEvent.click(screen.getByRole("button", { name: "월간" }));
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    state = "ok";
    fireEvent.click(retry);
    expect(await screen.findByRole("list", { name: "월간 랭킹" })).toBeTruthy();
  });

  test("a slow answer for an earlier tab never replaces the tab chosen last", async () => {
    const slow = deferred<Response>();
    let held = false;
    server((call) => {
      if (call.path === "/api/public/rankings" && periodOf(call) === "week" && !held) { held = true; return slow.promise; }
      return undefined;
    });
    render(<RankingRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "월간" }));
    expect(await screen.findByRole("list", { name: "월간 랭킹" })).toBeTruthy();
    await act(async () => { slow.resolve(json(200, { period: "week", items: [rankedItem(99, 1)] })); });
    expect(screen.queryByRole("heading", { name: "작품99" })).toBeNull();
    expect(screen.getByRole("list", { name: "월간 랭킹" })).toBeTruthy();
  });
});

describe("main page ranking section (31.6)", () => {
  test("shows the ranking with tabs and the top ten request instead of the popular list", async () => {
    const { calls } = server();
    render(<HomePage />);
    const section = await screen.findByRole("region", { name: "랭킹" });
    expect(within(section).getByRole("button", { name: "주간" }).getAttribute("aria-pressed")).toBe("true");
    expect(await within(section).findByRole("list", { name: "주간 랭킹" })).toBeTruthy();
    expect(new URL(calls.find((call) => call.path === "/api/public/rankings")!.url).search).toBe("?period=week&limit=10");
    expect(screen.queryByRole("region", { name: "인기 작품" })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "월간" }));
    expect(await within(section).findByRole("list", { name: "월간 랭킹" })).toBeTruthy();
  });

  test("falls back to the cumulative popular list when the ranking fails or is empty", async () => {
    server((call) => (call.path === "/api/public/rankings" ? json(503, errorBody("SERVICE_UNAVAILABLE")) : undefined));
    const first = render(<HomePage />);
    const popular = await screen.findByRole("region", { name: "인기 작품" });
    expect(within(popular).getByRole("list", { name: "인기 작품 목록" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "랭킹" })).toBeNull());
    first.unmount();
    server((call) => (call.path === "/api/public/rankings" ? json(200, { period: "week", items: [] }) : undefined));
    render(<HomePage />);
    expect(await screen.findByRole("region", { name: "인기 작품" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "랭킹" })).toBeNull());
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import HomePage from "@/app/(public)/page";
import PublicLayout from "@/app/(public)/layout";
import { savePosition } from "@/lib/reader/position";
import { errorBody, json, mockFetch, type FetchCall } from "./helpers";

const T = "2026-10-08T01:00:00.123456Z";
const ep = (n: number) => ({ episodeId: String(n), title: `${n}화`, publishedAt: T });
// The public list is ordered by episode id ascending (CONTRACTS 20).
function listServer(total: number, extra?: (call: FetchCall) => Response | undefined) {
  return mockFetch((call) => {
    if (call.path === "/api/public/home") return json(503, errorBody("SERVICE_UNAVAILABLE")); // the catalog is down: the simple list is the page
    const special = extra?.(call);
    if (special) return special;
    const url = new URL(call.url);
    if (call.path !== "/api/public/episodes") throw new Error(`unexpected ${call.path}`);
    const limit = Number(url.searchParams.get("limit")), offset = Number(url.searchParams.get("offset"));
    const items = Array.from({ length: Math.max(Math.min(limit, total - offset), 0) }, (_, i) => ep(offset + i + 1));
    return json(200, { items, total });
  });
}

describe("reader main page when the catalog is unavailable: the simple latest list (28.7 a)", () => {
  test("many episodes: the newest 12 are shown newest first, read with the public list only and no token", async () => {
    window.sessionStorage.setItem("mangabridge.demoAuth.accessToken", "should-never-be-sent");
    const { calls } = listServer(30);
    render(<HomePage />);
    const cards = await screen.findAllByRole("link", { name: /화/ });
    const titles = cards.filter((link) => link.getAttribute("href")?.startsWith("/read/")).map((link) => within(link).getByRole("heading").textContent);
    expect(titles).toEqual(["30화", "29화", "28화", "27화", "26화", "25화", "24화", "23화", "22화", "21화", "20화", "19화"]);
    expect(calls.filter((call) => call.path === "/api/public/episodes").map((call) => new URL(call.url).search)).toEqual(["?limit=12&offset=0", "?limit=12&offset=18"]);
    // the public calls never carry the token; only the account's own data (/api/me) does (CONTRACTS 32.7)
    for (const call of calls.filter((item) => item.path.startsWith("/api/public"))) expect(call.headers.Authorization ?? call.headers.authorization).toBeUndefined();
    expect(screen.getByRole("link", { name: "30화 공개 2026-10-08" }).getAttribute("href")).toBe("/read/30");
    expect(screen.getByRole("heading", { name: "번역된 만화를 읽어 보세요" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "전체 회차 보기" }).getAttribute("href")).toBe("/read");
  });

  test("few episodes need one request and are shown newest first", async () => {
    const { calls } = listServer(3);
    render(<HomePage />);
    await screen.findByRole("heading", { name: "3화" });
    expect(calls.filter((call) => call.path === "/api/public/episodes")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["3화", "2화", "1화"]);
  });

  test("nothing published yet shows a plain note and no cards", async () => {
    listServer(0);
    render(<HomePage />);
    expect(await screen.findByText("아직 공개된 회차가 없습니다.")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  test("a failure shows a fixed message and a retry that loads the list", async () => {
    let healthy = false;
    listServer(2, () => (healthy ? undefined : json(503, errorBody("SERVICE_UNAVAILABLE"))));
    render(<HomePage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "다시 시도" })).toHaveLength(2)); // the catalog notice and the failed latest list
    healthy = true;
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[1]); // the latest-list retry (the first one retries the catalog)
    expect(await screen.findByRole("heading", { name: "2화" })).toBeTruthy();
    expect(screen.getByText("작품 정보를 불러오지 못해 최신 회차만 보여 드립니다.")).toBeTruthy();
  });

  test("a saved reading position is offered as a continue badge", async () => {
    savePosition("2", 1, T);
    listServer(2);
    render(<HomePage />);
    const card = (await screen.findByRole("heading", { name: "2화" })).closest("a")!;
    expect(within(card).getByText("이어 읽기")).toBeTruthy();
    expect(within((await screen.findByRole("heading", { name: "1화" })).closest("a")!).queryByText("이어 읽기")).toBeNull();
  });
});

describe("public shell", () => {
  test("header has home, episode list and login; the footer has the list and login links; no role-dependent content", () => {
    render(<PublicLayout><p>본문</p></PublicLayout>);
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(within(nav).queryByRole("link", { name: "홈" })).toBeNull(); // the brand leads home
    expect(screen.getByRole("link", { name: "망가브릿지" }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: "회차 목록" }).getAttribute("href")).toBe("/read");
    expect(within(nav).getByRole("link", { name: "작업 공간" }).getAttribute("href")).toBe("/demo"); // a way back to the signed-in screens; shown to everyone
    expect(screen.getAllByRole("link", { name: "로그인" }).map((link) => link.getAttribute("href"))).toEqual(["/login"]); // the footer; the header one is inside the profile popup
    expect(within(nav).queryByRole("link", { name: /내 서재|마이페이지/ })).toBeNull();
    expect(screen.getByRole("contentinfo").textContent).toContain("번역된 만화를 읽는 곳");
    expect(screen.getByText("본문")).toBeTruthy();
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HomePage from "@/app/(public)/page";
import { ROTATE_MS } from "@/components/HeroCarousel";
import { errorBody, json, mockFetch } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));

const T = "2026-10-08T01:00:00.123456Z";
const work = (id: number) => ({ workId: String(id), title: `배너작품${id}`, author: `작가${id}`, genres: ["판타지"], hasCover: false, episodeCount: 1, latestPublishedAt: T, views: 1, recommendCount: 0 });
function home(banners: unknown[]) {
  mockFetch((call) => (call.path === "/api/public/home" ? json(200, { banners, latest: [], popular: [], featured: [] }) : json(404, errorBody("NOT_FOUND"))));
}
const slide = () => screen.getByRole("group", { name: /\d+ \/ \d+/ });
const label = () => slide().getAttribute("aria-label");
async function loaded(count: number) { await screen.findByRole("button", { name: `${count + 1}번째 슬라이드` }); await act(async () => {}); } // and the passive effects (the timer) have run

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());

describe("hero carousel on the main page (28.6, D-061)", () => {
  test("without banners the hero is the plain intro with no controls", async () => {
    home([]);
    render(<HomePage />);
    expect(await screen.findByRole("heading", { level: 1, name: /번역된 만화를/ })).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "다음 슬라이드" })).toBeNull();
    expect(label()).toBe("1 / 1");
  });

  test("the intro is the first slide, the banner works follow; buttons and dots move, and it wraps around", async () => {
    home([work(1), work(2)]);
    render(<HomePage />);
    await loaded(2);
    expect(label()).toBe("1 / 3");
    fireEvent.click(screen.getByRole("button", { name: "다음 슬라이드" }));
    expect(within(slide()).getByRole("heading", { name: "배너작품1" })).toBeTruthy();
    expect(within(slide()).getByRole("link", { name: "작품 보기" }).getAttribute("href")).toBe("/works/1");
    expect(screen.getByRole("heading", { level: 1, name: /번역된 만화를/ })).toBeTruthy(); // the page keeps its h1 on a banner slide
    fireEvent.click(screen.getByRole("button", { name: "3번째 슬라이드" }));
    expect(within(slide()).getByRole("heading", { name: "배너작품2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3번째 슬라이드" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "다음 슬라이드" }));
    expect(label()).toBe("1 / 3");
    fireEvent.click(screen.getByRole("button", { name: "이전 슬라이드" }));
    expect(label()).toBe("3 / 3");
  });

  test("it rotates by itself, stops while paused or pointed at, and resumes", async () => {
    home([work(1), work(2)]);
    render(<HomePage />);
    await loaded(2);
    await act(async () => { vi.advanceTimersByTime(ROTATE_MS + 50); });
    expect(label()).toBe("2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
    await act(async () => { vi.advanceTimersByTime(ROTATE_MS * 3); });
    expect(label()).toBe("2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "자동 넘김 켜기" }));
    const region = screen.getByRole("region", { name: "소개와 추천 작품" });
    fireEvent.mouseEnter(region);
    await act(async () => { vi.advanceTimersByTime(ROTATE_MS * 2); });
    expect(label()).toBe("2 / 3");
    fireEvent.mouseLeave(region);
    await act(async () => { vi.advanceTimersByTime(ROTATE_MS + 50); });
    expect(label()).toBe("3 / 3");
  });

  test("with reduced motion requested it never rotates and offers no pause button", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    home([work(1)]);
    render(<HomePage />);
    await loaded(1);
    await act(async () => { vi.advanceTimersByTime(ROTATE_MS * 3); });
    expect(label()).toBe("1 / 2");
    expect(screen.queryByRole("button", { name: "일시정지" })).toBeNull();
  });
});

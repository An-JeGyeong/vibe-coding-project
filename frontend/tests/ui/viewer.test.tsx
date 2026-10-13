import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ReadEpisodePage from "@/app/(public)/read/[id]/page";
import { buildUnits, stepForKey, stepForSide, stepForSwipe, unitIndexOf } from "@/lib/viewer/navigation";
import { POSITION_KEY, SETTINGS_KEY } from "@/lib/viewer/storage";
import { errorBody, json, mockFetch, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "2" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-08T01:00:00.123456Z";
const detail = { episodeId: "2", title: "둘째 화", publishedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "텍스트 본문" }] };
const episodes = { items: [{ episodeId: "1", title: "첫째 화", publishedAt: T }, { episodeId: "2", title: "둘째 화", publishedAt: T }, { episodeId: "3", title: "셋째 화", publishedAt: T }], total: 3 };
const pages = (...numbers: number[]) => ({ items: numbers.map((pageNo) => ({ pageNo })) });

function open(pageList: unknown = pages(1, 2, 3), extra: (call: FetchCall) => Response | undefined = () => undefined) {
  return mockFetch((call) => {
    const special = extra(call);
    if (special) return special;
    if (call.path === "/api/public/episodes/2") return json(200, detail);
    if (call.path === "/api/public/episodes/2/pages") return json(200, pageList);
    if (call.path === "/api/public/episodes") return json(200, episodes);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
// the page is on screen AND the key listener (a passive effect) is registered, even on a loaded machine
async function ready() { await screen.findByRole("img", { name: "페이지 1" }); await act(async () => {}); }
const shownPages = () => screen.getAllByRole("img").map((image) => image.getAttribute("alt"));
const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  fireEvent(window, new Event("resize"));
}

// the default is two pages together on a wide screen; these tests exercise single-page turning unless they switch the spread on
const SINGLE = { mode: "page", spread: false, direction: "rtl" };
beforeEach(() => { nav.params = { id: "2" }; setWidth(1280); window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(SINGLE)); });
afterEach(() => { vi.unstubAllGlobals(); setWidth(1024); });

describe("page-turning rules (27.4)", () => {
  test("rtl: the LEFT side / left key goes forward; ltr is the mirror image", () => {
    expect(stepForSide("left", "rtl")).toBe(1);
    expect(stepForSide("right", "rtl")).toBe(-1);
    expect(stepForSide("left", "ltr")).toBe(-1);
    expect(stepForSide("right", "ltr")).toBe(1);
    expect(stepForKey("ArrowLeft", "rtl")).toBe(1);
    expect(stepForKey("ArrowRight", "rtl")).toBe(-1);
    expect(stepForKey("ArrowLeft", "ltr")).toBe(-1);
    expect(stepForKey("ArrowRight", "ltr")).toBe(1);
    expect(stepForKey("a", "rtl")).toBeNull();
  });
  test("swipes: long and mostly horizontal only; dragging the page to the right advances in rtl", () => {
    expect(stepForSwipe(120, 10, "rtl")).toBe(1);
    expect(stepForSwipe(-120, 10, "rtl")).toBe(-1);
    expect(stepForSwipe(-120, 10, "ltr")).toBe(1);
    expect(stepForSwipe(120, 10, "ltr")).toBe(-1);
    expect(stepForSwipe(30, 0, "rtl")).toBeNull();
    expect(stepForSwipe(100, 90, "rtl")).toBeNull();
  });
  test("a spread pairs the pages from the first one and shows an odd last page alone (D-062)", () => {
    expect(buildUnits([1, 2, 3, 4, 5], true)).toEqual([[1, 2], [3, 4], [5]]);
    expect(buildUnits([1, 2, 3, 4], true)).toEqual([[1, 2], [3, 4]]);
    expect(buildUnits([1, 2], true)).toEqual([[1, 2]]);
    expect(buildUnits([1], true)).toEqual([[1]]);
    expect(buildUnits([1, 2, 3], false)).toEqual([[1], [2], [3]]);
    expect(unitIndexOf([[1, 2], [3, 4]], 3)).toBe(1);
    expect(unitIndexOf([[1, 2], [3, 4]], 99)).toBe(0);
  });
});

describe("manga viewer (27.4)", () => {
  test("images come straight from the public API with no login token; the text is not shown", async () => {
    const { calls } = open();
    render(<ReadEpisodePage />);
    const image = (await screen.findByRole("img", { name: "페이지 1" })) as HTMLImageElement;
    expect(image.getAttribute("src")).toMatch(/\/api\/public\/episodes\/2\/pages\/1\/image$/);
    expect(screen.queryByText("텍스트 본문")).toBeNull();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    for (const call of calls) expect(call.headers.Authorization ?? call.headers.authorization).toBeUndefined();
  });

  test("right-to-left by default: clicking the left area goes to the next page, the right area goes back; edges stop", async () => {
    open();
    render(<ReadEpisodePage />);
    await ready();
    expect((screen.getByRole("button", { name: "다음 쪽" }) as HTMLButtonElement).className).toContain("viewer-arrow-left");
    fireEvent.click(screen.getByTestId("zone-right"));
    expect(shownPages()).toEqual(["페이지 1"]); // before the first page: nothing happens
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 2"]);
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 3"]);
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 3"]); // after the last page: nothing happens
    expect((screen.getByRole("button", { name: "다음 쪽" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("zone-right"));
    expect(shownPages()).toEqual(["페이지 2"]);
  });

  test("keys and the edge arrows follow the same rule; keys typed in the page picker do not turn pages", async () => {
    open();
    render(<ReadEpisodePage />);
    await ready();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(shownPages()).toEqual(["페이지 2"]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(shownPages()).toEqual(["페이지 1"]);
    fireEvent.keyDown(screen.getByLabelText("페이지 선택"), { key: "ArrowLeft" });
    expect(shownPages()).toEqual(["페이지 1"]);
    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    expect(shownPages()).toEqual(["페이지 1"]);
    click("다음 쪽");
    expect(shownPages()).toEqual(["페이지 2"]);
    click("이전 쪽");
    expect(shownPages()).toEqual(["페이지 1"]);
    fireEvent.change(screen.getByLabelText("페이지 선택"), { target: { value: "3" } });
    expect(shownPages()).toEqual(["페이지 3"]);
  });

  test("switching to left-to-right in the settings mirrors the rule and is remembered", async () => {
    open();
    const first = render(<ReadEpisodePage />);
    await ready();
    click("설정");
    fireEvent.click(screen.getByLabelText("왼쪽→오른쪽"));
    click("닫기");
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 1"]);
    fireEvent.click(screen.getByTestId("zone-right"));
    expect(shownPages()).toEqual(["페이지 2"]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(shownPages()).toEqual(["페이지 3"]);
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ direction: "ltr", mode: "page" });
    first.unmount();
    render(<ReadEpisodePage />); // the setting survives a new visit
    expect(await screen.findByRole("img", { name: "페이지 3" })).toBeTruthy(); // restored position
    fireEvent.click(screen.getByTestId("zone-left")); // left = previous in left-to-right
    expect(shownPages()).toEqual(["페이지 2"]);
  });

  test("swiping follows the direction rule", async () => {
    open();
    render(<ReadEpisodePage />);
    await ready();
    const stage = screen.getByTestId("zone-left").parentElement!;
    fireEvent.touchStart(stage, { changedTouches: [{ clientX: 100, clientY: 50 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 220, clientY: 55 }] });
    expect(shownPages()).toEqual(["페이지 2"]);
    fireEvent.touchStart(stage, { changedTouches: [{ clientX: 220, clientY: 50 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100, clientY: 55 }] });
    expect(shownPages()).toEqual(["페이지 1"]);
    fireEvent.touchStart(stage, { changedTouches: [{ clientX: 100, clientY: 50 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 120, clientY: 50 }] }); // too short
    expect(shownPages()).toEqual(["페이지 1"]);
  });

  test("two-page spread on a wide screen: pairs from the first page, the first page of a pair on the right in rtl, an odd last page alone", async () => {
    open(pages(1, 2, 3, 4, 5));
    render(<ReadEpisodePage />);
    await ready();
    click("설정");
    fireEvent.click(screen.getByLabelText("두 쪽 펼침"));
    click("닫기");
    expect(shownPages()).toEqual(["페이지 1", "페이지 2"]);
    expect(screen.getByText("1–2 / 5")).toBeTruthy();
    expect(screen.getAllByRole("img")[0].parentElement!.className).toContain("rtl");
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 3", "페이지 4"]);
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 5"]);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("마지막 쪽입니다");
  });

  test("by default a wide screen shows pages 1 and 2 together, then pairs; the reader can switch to one page", async () => {
    window.localStorage.removeItem(SETTINGS_KEY);
    open(pages(1, 2, 3, 4, 5));
    render(<ReadEpisodePage />);
    await ready();
    expect(shownPages()).toEqual(["페이지 1", "페이지 2"]);
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 3", "페이지 4"]);
    click("설정");
    expect((screen.getByLabelText("두 쪽 펼침") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("한 쪽"));
    click("닫기");
    expect(shownPages()).toEqual(["페이지 3"]);
  });

  test("on a narrow screen the spread is not offered and one page is shown", async () => {
    open(pages(1, 2, 3));
    render(<ReadEpisodePage />);
    await ready();
    click("설정");
    fireEvent.click(screen.getByLabelText("두 쪽 펼침"));
    click("닫기");
    expect(shownPages()).toEqual(["페이지 1", "페이지 2"]);
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(shownPages()).toEqual(["페이지 3"]);
    setWidth(600);
    await waitFor(() => expect(shownPages()).toEqual(["페이지 3"])); // the spread is dropped, the current page stays
    fireEvent.click(screen.getByTestId("zone-right"));
    expect(shownPages()).toEqual(["페이지 2"]); // one page at a time again
    click("설정");
    expect((screen.getByLabelText("두 쪽 펼침") as HTMLInputElement).matches(":disabled")).toBe(true);
    expect(screen.getByText(/넓은 화면에서만/)).toBeTruthy();
  });

  test("scroll mode shows every page in a column with the end notice and the next episode", async () => {
    open();
    render(<ReadEpisodePage />);
    await ready();
    click("설정");
    fireEvent.click(screen.getByLabelText("스크롤"));
    click("닫기");
    expect(shownPages()).toEqual(["페이지 1", "페이지 2", "페이지 3"]);
    expect((screen.getAllByRole("img")[1] as HTMLImageElement).getAttribute("loading")).toBe("lazy");
    expect(screen.getByText(/마지막 쪽입니다/)).toBeTruthy();
    expect(screen.queryByTestId("zone-left")).toBeNull();
    const second = screen.getAllByRole("img")[1] as HTMLImageElement;
    expect(second.style.minHeight).toBe("60vh"); // a placeholder height until loaded, so lazy images are not all zero-height
    fireEvent.load(second);
    expect(second.style.minHeight).toBe("");
    fireEvent.keyDown(window, { key: "ArrowLeft" }); // arrow keys keep their normal scrolling here
    expect(shownPages()).toHaveLength(3);
  });

  test("episode links: previous and next in the top and bottom bars, disabled at the ends", async () => {
    open();
    const { unmount } = render(<ReadEpisodePage />);
    await ready();
    expect(screen.getAllByRole("link", { name: /이전화/ }).map((link) => link.getAttribute("href"))).toEqual(["/read/1", "/read/1"]);
    expect(screen.getAllByRole("link", { name: /다음화/ }).map((link) => link.getAttribute("href"))).toEqual(["/read/3", "/read/3"]);
    expect(screen.getByRole("link", { name: "목록" }).getAttribute("href")).toBe("/read");
    unmount();
    nav.params = { id: "2" };
    open(pages(1), (call) => (call.path === "/api/public/episodes" ? json(503, errorBody("SERVICE_UNAVAILABLE")) : undefined));
    render(<ReadEpisodePage />);
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("link", { name: /이전화|다음화/ })).toBeNull(); // a failure only hides the links
  });

  test("an image that fails shows a notice for that page only, and retry loads it again", async () => {
    open();
    render(<ReadEpisodePage />);
    const image = await screen.findByRole("img", { name: "페이지 1" });
    fireEvent.error(image);
    const notice = screen.getByRole("group", { name: "페이지 1" });
    expect(within(notice).getByText("이미지를 불러오지 못했습니다.")).toBeTruthy();
    click("다시 시도");
    expect((screen.getByRole("img", { name: "페이지 1" }) as HTMLImageElement).getAttribute("src")).toMatch(/retry=1$/);
    fireEvent.error(screen.getByRole("img", { name: "페이지 1" }));
    fireEvent.click(screen.getByTestId("zone-left")); // other pages are still readable
    expect(shownPages()).toEqual(["페이지 2"]);
  });

  test("an episode without translated images, or when the list fails, uses the text reader", async () => {
    open({ items: [] });
    const first = render(<ReadEpisodePage />);
    expect(await screen.findByText("텍스트 본문")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "설정" })).toBeNull();
    first.unmount();
    open(pages(1), (call) => (call.path === "/api/public/episodes/2/pages" ? json(503, errorBody("SERVICE_UNAVAILABLE")) : undefined));
    render(<ReadEpisodePage />);
    expect(await screen.findByText("텍스트 본문")).toBeTruthy();
  });

  test("an unpublished episode (404) shows the usual notice, not a viewer", async () => {
    mockFetch(() => json(404, errorBody("NOT_FOUND")));
    render(<ReadEpisodePage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "설정" })).toBeNull();
  });

  test("the last page is remembered with the publication time and a replaced publication discards it", async () => {
    open();
    const first = render(<ReadEpisodePage />);
    await ready();
    fireEvent.click(screen.getByTestId("zone-left"));
    expect(JSON.parse(window.localStorage.getItem(POSITION_KEY)!)).toEqual({ "2": { pageNo: 2, publishedAt: T } });
    first.unmount();
    const second = render(<ReadEpisodePage />);
    expect(await screen.findByRole("img", { name: "페이지 2" })).toBeTruthy();
    second.unmount();
    mockFetch((call) => (call.path === "/api/public/episodes/2" ? json(200, { ...detail, publishedAt: "2026-10-09T01:00:00.000000Z" }) : call.path.endsWith("/pages") ? json(200, pages(1, 2, 3)) : json(200, episodes)));
    render(<ReadEpisodePage />);
    expect(await screen.findByRole("img", { name: "페이지 1" })).toBeTruthy();
  });

  test("the settings panel traps focus, closes with Escape and gives focus back; blocked storage changes nothing", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined });
    open();
    render(<ReadEpisodePage />);
    await ready();
    const opener = screen.getByRole("button", { name: "설정" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "뷰어 설정" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const close = within(dialog).getByRole("button", { name: "닫기" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(screen.getByTestId("zone-left")); // still works without storage, with the default two-page spread
    expect(shownPages()).toEqual(["페이지 3"]);
  });

  test("keys do not turn pages while the settings panel is open", async () => {
    open();
    render(<ReadEpisodePage />);
    await ready();
    click("설정");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(shownPages()).toEqual(["페이지 1"]);
  });
});

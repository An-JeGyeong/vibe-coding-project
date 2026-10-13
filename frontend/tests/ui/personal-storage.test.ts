import { describe, expect, test, vi } from "vitest";
import { filterWorks } from "@/lib/catalog/all";
import { addToLibrary, clearLibrary, isBookmarked, LIBRARY_KEY, LIBRARY_MAX, loadLibrary, removeFromLibrary } from "@/lib/personal/library";
import { clearRecent, loadRecent, recordRecent, RECENT_KEY, RECENT_MAX } from "@/lib/personal/recent";
import { applyTheme, loadTheme, saveTheme, THEME_BOOT_SCRIPT, THEME_KEY } from "@/lib/personal/theme";

const entry = (n: number) => ({ episodeId: String(n), title: `${n}화`, workId: "1", workTitle: "작품", episodeNo: n });

describe("library storage (30.1)", () => {
  test("adds newest first, ignores duplicates and bad ids, removes and clears", () => {
    addToLibrary("1"); addToLibrary("2"); addToLibrary("1"); addToLibrary("abc"); addToLibrary("0");
    expect(loadLibrary().map((item) => item.workId)).toEqual(["1", "2"]); // adding an existing work moves it to the front
    expect(isBookmarked("1")).toBe(true);
    removeFromLibrary("1");
    expect(isBookmarked("1")).toBe(false);
    clearLibrary();
    expect(loadLibrary()).toEqual([]);
  });

  test("keeps at most 200 entries, dropping the oldest", () => {
    for (let n = 1; n <= LIBRARY_MAX + 5; n++) addToLibrary(String(n));
    const items = loadLibrary();
    expect(items).toHaveLength(LIBRARY_MAX);
    expect(items[0].workId).toBe(String(LIBRARY_MAX + 5));
  });

  test("corrupt values are ignored, valid neighbours are kept", () => {
    window.localStorage.setItem(LIBRARY_KEY, "{not json");
    expect(loadLibrary()).toEqual([]);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify([{ workId: "3", addedAt: "x" }, { workId: 5 }, null, { workId: "3", addedAt: "y" }, "str"]));
    expect(loadLibrary().map((item) => item.workId)).toEqual(["3"]);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ workId: "1" }));
    expect(loadLibrary()).toEqual([]);
  });

  test("blocked storage never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadLibrary()).toEqual([]);
    expect(() => addToLibrary("1")).not.toThrow();
    expect(() => recordRecent(entry(1))).not.toThrow();
    expect(loadRecent()).toEqual([]);
    expect(loadTheme()).toBe("light");
    expect(() => saveTheme("dark")).not.toThrow();
  });
});

describe("recent episodes (30.1)", () => {
  test("one entry per episode, newest first, at most 20", () => {
    recordRecent(entry(1)); recordRecent(entry(2)); recordRecent(entry(1));
    expect(loadRecent().map((item) => item.episodeId)).toEqual(["1", "2"]);
    for (let n = 3; n < 3 + RECENT_MAX + 3; n++) recordRecent(entry(n));
    expect(loadRecent()).toHaveLength(RECENT_MAX);
    clearRecent();
    expect(loadRecent()).toEqual([]);
  });

  test("an episode without a work keeps null work fields; broken entries are dropped", () => {
    recordRecent({ episodeId: "7", title: "단독", workId: null, workTitle: null, episodeNo: null });
    expect(loadRecent()[0]).toMatchObject({ workId: null, workTitle: null, episodeNo: null });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ episodeId: "x", title: "a", readAt: "t" }, { episodeId: "9", title: "", readAt: "t" }, { episodeId: "8", title: "ok", workId: "2", workTitle: "w", episodeNo: 1.5, readAt: "t" }]));
    expect(loadRecent()).toEqual([{ episodeId: "8", title: "ok", workId: "2", workTitle: "w", episodeNo: null, readAt: "t" }]);
  });
});

describe("theme (30.2)", () => {
  test("light by default, dark is saved and applied, anything else is light", () => {
    expect(loadTheme()).toBe("light");
    saveTheme("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe('"dark"');
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
    expect(loadTheme()).toBe("dark");
    saveTheme("light");
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("light");
    window.localStorage.setItem(THEME_KEY, '"purple"');
    expect(loadTheme()).toBe("light");
    applyTheme("light");
  });

  test("the boot script applies a stored dark value before paint and does nothing otherwise", () => {
    document.documentElement.removeAttribute("data-bs-theme");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-bs-theme")).not.toBe("dark");
    window.localStorage.setItem(THEME_KEY, '"dark"');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
    document.documentElement.removeAttribute("data-bs-theme");
  });
});

describe("work filter (30.2)", () => {
  const works = [{ title: "Dragon Quest", author: "Kim" }, { title: "낯선 항구", author: "이작가" }] as never[];
  test("matches title or author, ignoring case and surrounding spaces", () => {
    expect(filterWorks(works, " dragon ")).toHaveLength(1);
    expect(filterWorks(works, "KIM")).toHaveLength(1);
    expect(filterWorks(works, "항구")).toHaveLength(1);
    expect(filterWorks(works, "이작가")).toHaveLength(1);
    expect(filterWorks(works, "없음")).toHaveLength(0);
    expect(filterWorks(works, "  ")).toHaveLength(2);
  });
});

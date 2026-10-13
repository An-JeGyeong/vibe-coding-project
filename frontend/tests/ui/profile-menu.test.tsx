import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import PublicLayout from "@/app/(public)/layout";
import PaymentsPage from "@/app/(public)/payments/page";
import SettingsPage from "@/app/(public)/settings/page";
import MyPage from "@/app/(public)/my/page";
import { TOKEN_STORAGE_KEY } from "@/lib/auth/storage";
import { addToLibrary } from "@/lib/personal/library";
import { checkProfile, loadProfile, PROFILE_KEY } from "@/lib/personal/profile";
import { TOKEN, errorBody, json, meBody, mockFetch, noContent } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));

const open = () => fireEvent.click(screen.getByRole("button", { name: /프로필|데모/ }));
const panel = () => screen.queryByRole("region", { name: "프로필 메뉴" });

describe("profile popup of the public header (30.2, D-063)", () => {
  test("opens and closes by the button, Escape (focus back on the button) and a click outside", () => {
    render(<PublicLayout>x</PublicLayout>);
    const button = screen.getByRole("button", { name: "프로필" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel()).toBeTruthy();
    fireEvent.keyDown(panel()!, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(panel()).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(panel()).toBeNull();
  });

  test("without a token it offers the login, the my page, the payments, the settings and the theme, and never asks the server", async () => {
    const { calls } = mockFetch(() => json(500, errorBody("X")));
    render(<PublicLayout>x</PublicLayout>);
    open();
    const popup = within(await screen.findByRole("region", { name: "프로필 메뉴" }));
    expect(popup.getByText("로그인하지 않았습니다.")).toBeTruthy();
    expect(popup.getByRole("link", { name: "로그인" }).getAttribute("href")).toBe("/login");
    expect(popup.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/login", "/signup", "/my", "/payments", "/settings"]);
    expect(popup.getByRole("button", { name: "다크 모드" })).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  test("with a token it shows the server-confirmed name, the work space link and a logout that clears the token and the name", async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody("TRANSLATOR")) : noContent()));
    render(<PublicLayout>x</PublicLayout>);
    const button = await screen.findByRole("button", { name: /데모 번역가/ });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    fireEvent.click(button);
    const popup = within(screen.getByRole("region", { name: "프로필 메뉴" }));
    expect(popup.getByRole("link", { name: "작업 공간" }).getAttribute("href")).toBe("/demo");
    expect(popup.queryByRole("link", { name: "로그인" })).toBeNull();
    fireEvent.click(popup.getByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull());
    expect(calls.some((call) => call.path === "/api/auth/logout" && call.method === "POST")).toBe(true);
    expect(await screen.findByRole("button", { name: "프로필" })).toBeTruthy();
    expect(screen.getByText("로그인하지 않았습니다.")).toBeTruthy();
  });

  test("a rejected token is dropped and the popup offers the login", async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    mockFetch(() => json(401, errorBody("UNAUTHORIZED")));
    render(<PublicLayout>x</PublicLayout>);
    await waitFor(() => expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull());
    open();
    expect(await within(screen.getByRole("region", { name: "프로필 메뉴" })).findByRole("link", { name: "로그인" })).toBeTruthy();
  });

  test("a stored profile name labels the button while nobody is signed in", async () => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ displayName: "독자1", bio: "" }));
    render(<PublicLayout>x</PublicLayout>);
    expect(await screen.findByRole("button", { name: /독자1/ })).toBeTruthy();
  });
});

describe("profile storage and settings page (D-063)", () => {
  test("checkProfile trims, limits the length and refuses control characters", () => {
    expect(checkProfile({ displayName: "  가나다  ", bio: " 안녕 " })).toEqual({ ok: true, value: { displayName: "가나다", bio: "안녕" } });
    expect(checkProfile({ displayName: "가".repeat(20), bio: "" }).ok).toBe(true);
    expect(checkProfile({ displayName: "가".repeat(21), bio: "" }).ok).toBe(false);
    expect(checkProfile({ displayName: "", bio: "a".repeat(101) }).ok).toBe(false);
    expect(checkProfile({ displayName: "a\u0007b", bio: "" }).ok).toBe(false);
  });

  test("a corrupt stored profile reads as empty", () => {
    window.localStorage.setItem(PROFILE_KEY, "{bad");
    expect(loadProfile()).toEqual({ displayName: "", bio: "" });
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ displayName: 5, bio: "x" }));
    expect(loadProfile()).toEqual({ displayName: "", bio: "" });
  });

  test("the settings page saves the profile in this browser only, refuses a bad value and clears it", async () => {
    const { calls } = mockFetch(() => json(500, errorBody("X")));
    render(<SettingsPage />);
    await screen.findByText(/로그인하지 않았습니다/);
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: "  독자  " } });
    fireEvent.change(screen.getByLabelText(/한 줄 소개/), { target: { value: "만화를 좋아합니다" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("저장했습니다.")).toBeTruthy();
    expect(loadProfile()).toEqual({ displayName: "독자", bio: "만화를 좋아합니다" });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: "가".repeat(21) } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect((await screen.findByRole("alert")).textContent).toContain("20자 이하");
    expect(loadProfile().displayName).toBe("독자");
    fireEvent.click(screen.getByRole("button", { name: "프로필 지우기" }));
    expect(loadProfile()).toEqual({ displayName: "", bio: "" });
    expect(calls).toHaveLength(0); // nothing is sent to the server
  });

  test("the settings page shows the signed-in account as read-only information", async () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
    mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody("REVIEWER")) : noContent()));
    render(<SettingsPage />);
    expect(await screen.findByText("데모 감수자")).toBeTruthy();
    expect(screen.getByText(/업무용 데모 계정의 역할은 바꿀 수 없습니다/)).toBeTruthy();
  });
});

describe("payments page and the library inside the my page (D-063)", () => {
  test("the payments page says honestly that there is nothing to list", () => {
    render(<PaymentsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "결제 내역" })).toBeTruthy();
    expect(screen.getByText(/결제 내역이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("the my page contains the library with its works and a way to find more", async () => {
    addToLibrary("1");
    mockFetch((call) => (call.path === "/api/public/works/1"
      ? json(200, { workId: "1", title: "낯선 항구", author: "작가", genres: ["판타지"], hasCover: false, episodeCount: 1, latestPublishedAt: "2026-10-08T01:00:00.123456Z", views: 1, recommendCount: 0, description: "", readingDirection: "RTL", episodes: [] })
      : json(404, errorBody("NOT_FOUND"))));
    render(<MyPage />);
    const library = await screen.findByRole("region", { name: "내 서재" });
    expect(await within(library).findByRole("heading", { name: "낯선 항구" })).toBeTruthy();
    expect(within(library).getByRole("link", { name: "작품 찾기" }).getAttribute("href")).toBe("/works");
  });
});

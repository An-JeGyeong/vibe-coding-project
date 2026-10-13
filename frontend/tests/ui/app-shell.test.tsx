import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { ROLE_INFO, ROLE_MENU_LINKS } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/types";
import { json, meBody, mockFetch, noContent, renderWithAuth, storedToken, storeToken, USERS } from "./helpers";

const nav = vi.hoisted(() => ({ pathname: "/demo" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
}));

beforeEach(() => { nav.pathname = "/demo"; });

function signedIn(role: Role) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    if (call.path === "/api/auth/logout") return noContent();
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}

describe("app shell", () => {
  test.each(["OPERATOR", "TRANSLATOR", "REVIEWER", "READER"] as const)("%s sees the server-confirmed user, the role label and exactly the implemented menu links", async (role) => {
    signedIn(role);
    renderWithAuth(<AppShell><p>본문</p></AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(USERS[role].displayName) })); // the profile button carries the confirmed name
    const user = within(await screen.findByLabelText("현재 사용자"));
    expect(user.getByText(new RegExp(USERS[role].displayName))).toBeTruthy();
    expect(user.getByText(ROLE_INFO[role].label)).toBeTruthy();
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    const links = nav.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["홈", "/demo"], ...Object.entries(ROLE_MENU_LINKS[role]), ["작품", "/works"], ["랭킹", "/ranking"], ["공개 회차", "/read"]]);
    expect(within(screen.getByRole("region", { name: "프로필 메뉴" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/demo", "/my", "/payments", "/settings"]);
    expect(screen.getByText("본문")).toBeTruthy();
  });

  test("the current section is marked active", async () => {
    nav.pathname = "/episodes/7";
    signedIn("OPERATOR");
    renderWithAuth(<AppShell>x</AppShell>);
    const link = await screen.findByRole("link", { name: "회차·원문 관리" });
    expect(link.className).toContain("active");
    expect(screen.getByRole("link", { name: "작업 이력 조회" }).className).not.toContain("active");
    expect(screen.getByRole("link", { name: "홈" }).className).not.toContain("active");
  });

  test("logout calls the server and clears the stored token", async () => {
    const { calls } = signedIn("REVIEWER");
    renderWithAuth(<AppShell>x</AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: /데모 감수자/ }));
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(storedToken()).toBeNull());
    expect(calls.some((call) => call.path === "/api/auth/logout" && call.method === "POST")).toBe(true);
  });

  test("without a login only the public link and a sign-in link are shown, and the sign-in link is hidden on /login", async () => {
    mockFetch(() => json(200, {}));
    nav.pathname = "/episodes";
    const first = renderWithAuth(<AppShell>x</AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: "프로필" }));
    expect(await screen.findByRole("link", { name: "로그인" })).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "주 메뉴" })[0].textContent).toBe("작품랭킹공개 회차");
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
    first.unmount();
    nav.pathname = "/login";
    renderWithAuth(<AppShell>x</AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: "프로필" }));
    expect(await screen.findByText("로그인하지 않았습니다.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "로그인" })).toBeNull();
  });

  test("the brand leads to the home screen when signed in", async () => {
    signedIn("TRANSLATOR");
    renderWithAuth(<AppShell>x</AppShell>);
    expect((await screen.findByRole("link", { name: "망가브릿지" })).getAttribute("href")).toBe("/demo");
  });
});

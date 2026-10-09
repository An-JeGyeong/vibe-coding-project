import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import DemoPage from "@/app/(auth)/demo/page";
import { ROLE_INFO } from "@/lib/auth/roles";
import { ROLES } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, noContent, renderWithAuth, storedToken, storeToken, TOKEN, USERS } from "./helpers";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => { replace.mockClear(); });

describe("protected /demo screen", () => {
  test("shows nothing protected until /me has confirmed the user", async () => {
    storeToken();
    const pending = deferred<Response>();
    mockFetch(() => pending.promise);
    renderWithAuth(<DemoPage />);
    expect(screen.getByText("로그인 상태를 확인하는 중…")).toBeTruthy();
    expect(screen.queryByText(USERS.OPERATOR.displayName)).toBeNull();
    expect(screen.queryByText("업무 메뉴")).toBeNull();
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
    await act(async () => { pending.resolve(json(200, meBody("OPERATOR"))); });
    expect(await screen.findByText(USERS.OPERATOR.displayName)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  test.each(ROLES)("%s: shows the server-confirmed user, role, guidance and disabled menus", async (role) => {
    storeToken();
    mockFetch(() => json(200, meBody(role)));
    renderWithAuth(<DemoPage />);
    expect(await screen.findByText(USERS[role].displayName)).toBeTruthy();
    const info = ROLE_INFO[role];
    expect(screen.getByText(info.label)).toBeTruthy();
    expect(screen.getByText(role)).toBeTruthy();
    expect(screen.getByText(info.summary)).toBeTruthy();
    expect(screen.getByText(/운영자는 다른 역할의 권한을 자동으로 갖지 않습니다/)).toBeTruthy();
    const menu = within(screen.getByRole("region", { name: "업무 메뉴" }));
    // Implemented menus: the operator's episodes, and the translator's / reviewer's assigned episodes. Everything else stays disabled.
    const links: Record<string, string> = role === "OPERATOR" ? { "회차·원문 관리": "/episodes", "작품 관리": "/works-admin", "작업 이력 조회": "/history" }
      : role === "READER" ? { "공개 회차 읽기": "/read" }
      : role === "REVIEWER" ? { "배정된 회차": "/assigned", "검수 대기 목록": "/reviews" } : { "배정된 회차": "/assigned" };
    const implemented = Object.keys(links);
    for (const label of info.menus) {
      if (implemented.includes(label)) {
        expect(menu.getByRole("link", { name: label }).getAttribute("href")).toBe(links[label]);
      } else {
        expect((menu.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
      }
    }
    expect(menu.queryAllByRole("button")).toHaveLength(info.menus.length - implemented.length);
    expect(menu.queryAllByRole("link")).toHaveLength(implemented.length);
    expect(screen.getByText(/후속 단계에서 제공됩니다/)).toBeTruthy();
    expect(screen.getByText(/접근 권한은 서버가 판단합니다/)).toBeTruthy();
  });

  test("the role comes from the server, not from anything stored in the browser", async () => {
    storeToken();
    window.sessionStorage.setItem("role", "OPERATOR");
    window.sessionStorage.setItem("mangabridge.demoAuth.role", "OPERATOR");
    mockFetch(() => json(200, meBody("READER")));
    renderWithAuth(<DemoPage />);
    expect(await screen.findByText(USERS.READER.displayName)).toBeTruthy();
    expect(screen.queryByText("운영자")).toBeNull();
    expect(screen.getByText(ROLE_INFO.READER.label)).toBeTruthy();
  });

  test("without a token it redirects to /login and renders no protected content", async () => {
    const { fn } = mockFetch(() => json(200, meBody()));
    renderWithAuth(<DemoPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(fn).not.toHaveBeenCalled();
    expect(screen.queryByText("업무 메뉴")).toBeNull();
  });

  test("an expired or revoked token (401) clears the token and redirects to /login", async () => {
    storeToken();
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    renderWithAuth(<DemoPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
    expect(screen.queryByText(USERS.OPERATOR.displayName)).toBeNull();
  });

  test("503 keeps the user signed in, hides protected content and retries", async () => {
    storeToken();
    let healthy = false;
    mockFetch(() => (healthy ? json(200, meBody("REVIEWER")) : json(503, errorBody("AUTH_UNAVAILABLE"))));
    renderWithAuth(<DemoPage />);
    expect(await screen.findByText(/인증 서비스를 사용할 수 없습니다/)).toBeTruthy();
    expect(screen.getByText(/로그아웃되지는 않았습니다/)).toBeTruthy();
    expect(screen.queryByText("업무 메뉴")).toBeNull();
    expect(storedToken()).toBe(TOKEN);
    expect(replace).not.toHaveBeenCalled();
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText(USERS.REVIEWER.displayName)).toBeTruthy();
  });

  test("network failure and timeout-like errors also keep the session and offer a retry", async () => {
    storeToken();
    mockFetch(() => { throw new TypeError("offline"); });
    renderWithAuth(<DemoPage />);
    expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(storedToken()).toBe(TOKEN);
    expect(replace).not.toHaveBeenCalled();
  });

  test("403 keeps the login and explains the missing permission", async () => {
    storeToken();
    mockFetch(() => json(403, errorBody("FORBIDDEN")));
    renderWithAuth(<DemoPage />);
    expect(await screen.findByText(/권한이 없습니다/)).toBeTruthy();
    expect(storedToken()).toBe(TOKEN);
    expect(replace).not.toHaveBeenCalled();
  });

  test("logout calls the server, clears local state and goes back to /login", async () => {
    storeToken();
    const { calls } = mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : noContent()));
    renderWithAuth(<DemoPage />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(calls.some((call) => call.path === "/api/auth/logout" && call.method === "POST")).toBe(true); // the dashboard cards may still be loading, so the logout is not necessarily the last request
    expect(storedToken()).toBeNull();
    expect(screen.queryByText(USERS.OPERATOR.displayName)).toBeNull();
    expect(screen.queryByText("업무 메뉴")).toBeNull();
  });

  test("the logout button is disabled while the request is pending", async () => {
    storeToken();
    const pending = deferred<Response>();
    mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : pending.promise));
    renderWithAuth(<DemoPage />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    const button = await screen.findByRole("button", { name: "로그아웃 중…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => { pending.resolve(noContent()); });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

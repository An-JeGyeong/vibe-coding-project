import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatRetryTime } from "@/lib/auth/messages";
import { deferred, errorBody, json, loginBody, meBody, mockFetch, noContent, NEW_TOKEN, renderWithAuth, storedToken, storeToken } from "./helpers";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => { replace.mockClear(); });

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /로그인( 중…)?$/ }) as HTMLButtonElement;

async function renderForm() {
  const view = renderWithAuth(<LoginPage />);
  await screen.findByRole("form", { name: "로그인" });
  return view;
}

function fill(loginId: string, password: string) {
  fireEvent.change(input("로그인 ID"), { target: { value: loginId } });
  fireEvent.change(input("비밀번호"), { target: { value: password } });
}

describe("login form", () => {
  test("shows role login ids only, never a password, and masks the password field", async () => {
    await renderForm();
    for (const id of ["demo.operator", "demo.translator", "demo.reviewer", "demo.reader"]) expect(screen.getByText(id)).toBeTruthy();
    expect(input("비밀번호").type).toBe("password");
    expect(document.body.textContent).not.toMatch(/비밀번호:/);
  });

  test("invalid input is rejected locally and nothing is sent", async () => {
    const { fn } = mockFetch(() => json(200, loginBody()));
    await renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByText("로그인 ID를 입력하세요.")).toBeTruthy();
    expect(screen.getByText("비밀번호를 입력하세요.")).toBeTruthy();

    fill(" demo.operator", "secret");
    fireEvent.click(submitButton());
    expect((await screen.findAllByRole("alert")).map((element) => element.textContent).join(" ")).toMatch(/소문자/);
    fill("Demo.Operator", "secret");
    fireEvent.click(submitButton());
    expect(await screen.findByText(/소문자·숫자/)).toBeTruthy();
    fill("demo.operator", "a".repeat(73));
    fireEvent.click(submitButton());
    expect(await screen.findByText(/72바이트/)).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  test("success sends the exact input, then leaves for /demo", async () => {
    const { calls } = mockFetch(() => json(200, loginBody("OPERATOR")));
    await renderForm();
    fill("demo.operator", "  pass word  ");
    fireEvent.click(submitButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/demo"));
    expect(JSON.parse(calls[0].body!)).toEqual({ loginId: "demo.operator", password: "  pass word  " });
    expect(storedToken()).toBe(NEW_TOKEN);
  });

  test("double submit sends one request and disables the button while it is pending", async () => {
    const pending = deferred<Response>();
    const { calls } = mockFetch(() => pending.promise);
    await renderForm();
    fill("demo.operator", "pw");
    const form = screen.getByRole("form", { name: "로그인" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(calls).toHaveLength(1);
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe("로그인 중…");
    await act(async () => { pending.resolve(json(200, loginBody())); });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });

  test("wrong credentials: generic message, password cleared, login id kept", async () => {
    mockFetch(() => json(401, errorBody("INVALID_CREDENTIALS")));
    await renderForm();
    fill("demo.operator", "wrong");
    fireEvent.click(submitButton());
    expect(await screen.findByText("로그인 ID 또는 비밀번호가 올바르지 않습니다.")).toBeTruthy();
    expect(input("비밀번호").value).toBe("");
    expect(input("로그인 ID").value).toBe("demo.operator");
    expect(submitButton().disabled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(storedToken()).toBeNull();
  });

  test("429 shows the retry time from Retry-After and blocks submits until then", async () => {
    mockFetch(() => json(429, errorBody("LOGIN_RATE_LIMITED"), { "Retry-After": "1" }));
    const now = Date.now();
    await renderForm();
    fill("demo.operator", "pw");
    fireEvent.click(submitButton());
    const alert = await screen.findByText(/너무 많습니다/);
    expect(alert.textContent).toMatch(/이후에 다시 시도/);
    expect(alert.textContent).toContain(formatRetryTime(Math.floor(now / 1000) * 1000 + 1000).slice(0, 5));
    expect(submitButton().disabled).toBe(true);
    await waitFor(() => expect(submitButton().disabled).toBe(false), { timeout: 2500 });
  });

  test("429 without a usable Retry-After falls back to a generic wait message", async () => {
    mockFetch(() => json(429, errorBody("LOGIN_RATE_LIMITED")));
    await renderForm();
    fill("demo.operator", "pw");
    fireEvent.click(submitButton());
    expect(await screen.findByText("로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.")).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  test.each([
    ["503", () => json(503, errorBody("AUTH_UNAVAILABLE")), /인증 서비스를 사용할 수 없습니다/],
    ["500", () => json(500, errorBody("INTERNAL_ERROR")), /서버 오류가 발생했습니다/],
    ["network failure", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
    ["400", () => json(400, errorBody("INVALID_REQUEST")), /입력값이 올바르지 않습니다/],
  ])("%s is shown without leaking server text and keeps the typed password", async (_name, respond, expected) => {
    mockFetch(respond);
    await renderForm();
    fill("demo.operator", "pw");
    fireEvent.click(submitButton());
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(input("비밀번호").value).toBe("pw");
    expect(document.body.textContent).not.toContain("fixed");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("login page states", () => {
  test("a stored token hides the form until /me answers, then moves to /demo", async () => {
    storeToken();
    const pending = deferred<Response>();
    mockFetch(() => pending.promise);
    renderWithAuth(<LoginPage />);
    expect(screen.getByText("로그인 상태를 확인하는 중…")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "로그인" })).toBeNull();
    await act(async () => { pending.resolve(json(200, meBody())); });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/demo"));
  });

  test("an unverifiable stored token offers a retry and still allows a fresh login", async () => {
    storeToken();
    mockFetch(() => json(503, errorBody("AUTH_UNAVAILABLE")));
    renderWithAuth(<LoginPage />);
    expect(await screen.findByText(/저장된 로그인 상태를 확인하지 못했습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "로그인" })).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("a rejected stored token (401) shows the expiry notice with the form", async () => {
    storeToken();
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    renderWithAuth(<LoginPage />);
    expect(await screen.findByText("인증이 만료되었거나 유효하지 않습니다. 다시 로그인하세요.")).toBeTruthy();
    expect(screen.getByRole("form", { name: "로그인" })).toBeTruthy();
    expect(storedToken()).toBeNull();
  });
});

// D-025 B: after a logout the server did not confirm, the login screen must say that the server token
// may stay valid until it expires. A confirmed logout must not show that warning.
describe("logout notice on the login screen", () => {
  function LogoutAndLogin() {
    const auth = useAuth();
    return <>
      <button type="button" onClick={() => void auth.logout()}>test-logout</button>
      <LoginPage />
    </>;
  }

  async function logoutWith(logoutResponse: () => Response) {
    storeToken();
    mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : logoutResponse()));
    renderWithAuth(<LogoutAndLogin />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/demo"));
    fireEvent.click(screen.getByRole("button", { name: "test-logout" }));
    await screen.findByRole("form", { name: "로그인" });
  }

  test.each([
    ["network failure", () => { throw new TypeError("offline"); }],
    ["503", () => json(503, errorBody("AUTH_UNAVAILABLE"))],
  ])("an unconfirmed logout (%s) warns that the server token may stay valid until expiry", async (_name, failLogout) => {
    await logoutWith(failLogout);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("서버 로그아웃을 확인하지 못했습니다");
    expect(notice.textContent).toContain("토큰은 만료 시각까지 서버에서 유효할 수 있습니다");
    expect(storedToken()).toBeNull();
  });

  test("a confirmed logout shows a plain notice without the server-validity warning", async () => {
    await logoutWith(noContent);
    expect(screen.getByText("로그아웃되었습니다.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("서버에서 유효할 수 있습니다");
  });
});

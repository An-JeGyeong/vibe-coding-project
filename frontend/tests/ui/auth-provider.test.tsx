import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAuth, type LoginOutcome } from "@/lib/auth/AuthProvider";
import { TOKEN_STORAGE_KEY } from "@/lib/auth/storage";
import {
  deferred, errorBody, json, loginBody, meBody, mockFetch, noContent, NEW_TOKEN, renderWithAuth,
  setVisibility, storedToken, storeToken, TOKEN, USERS,
} from "./helpers";

let outcomes: LoginOutcome[] = [];

function Probe() {
  const auth = useAuth();
  return <div>
    <p data-testid="status">{auth.status}</p>
    <p data-testid="user">{auth.user ? `${auth.user.displayName}|${auth.user.role}` : "none"}</p>
    <p data-testid="notice">{auth.notice ?? "none"}</p>
    <p data-testid="failure">{auth.failure?.kind ?? "none"}</p>
    <button onClick={() => void auth.logout()}>logout</button>
    <button onClick={() => auth.retry()}>retry</button>
    <button onClick={() => auth.handleUnauthorized()}>unauthorized</button>
    <button onClick={() => void auth.login("demo.operator", "pw").then((outcome) => outcomes.push(outcome))}>login</button>
  </div>;
}

const status = () => screen.getByTestId("status").textContent;
const waitForStatus = (expected: string) => waitFor(() => expect(status()).toBe(expected));
const text = (id: string) => screen.getByTestId(id).textContent;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => { outcomes = []; });

describe("initial authentication check", () => {
  test("without a stored token the user is signed out and no request is made", async () => {
    const { fn } = mockFetch(() => json(200, meBody()));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    expect(fn).not.toHaveBeenCalled();
  });

  test("a stored token keeps the app in initializing until /me confirms the user", async () => {
    storeToken();
    const pending = deferred<Response>();
    const { calls } = mockFetch(() => pending.promise);
    renderWithAuth(<Probe />);
    expect(status()).toBe("initializing");
    expect(text("user")).toBe("none");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].path).toBe("/api/auth/me");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(status()).toBe("initializing");
    await act(async () => { pending.resolve(json(200, meBody("REVIEWER"))); });
    await waitForStatus("authenticated");
    expect(text("user")).toBe("데모 감수자|REVIEWER");
  });

  test("401 removes the token and the user and records why", async () => {
    storeToken();
    mockFetch(() => json(401, errorBody("AUTH_REQUIRED")));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    expect(storedToken()).toBeNull();
    expect(text("user")).toBe("none");
    expect(text("notice")).toBe("unauthorized");
  });

  test.each([
    ["503", () => json(503, errorBody("AUTH_UNAVAILABLE")), "unavailable"],
    ["500", () => json(500, errorBody("INTERNAL_ERROR")), "server_error"],
    ["403", () => json(403, errorBody("FORBIDDEN")), "forbidden"],
    ["network", () => { throw new TypeError("offline"); }, "network"],
  ])("%s keeps the token and offers a retry instead of signing out", async (_name, respond, kind) => {
    storeToken();
    mockFetch(respond);
    renderWithAuth(<Probe />);
    await waitForStatus("check_failed");
    expect(text("failure")).toBe(kind);
    expect(storedToken()).toBe(TOKEN);
    expect(text("user")).toBe("none");
  });

  test("retry after a transient failure authenticates without a new login", async () => {
    storeToken();
    let healthy = false;
    mockFetch(() => (healthy ? json(200, meBody()) : json(503, errorBody("AUTH_UNAVAILABLE"))));
    renderWithAuth(<Probe />);
    await waitForStatus("check_failed");
    healthy = true;
    click("retry");
    expect(status()).toBe("initializing");
    await waitForStatus("authenticated");
    expect(storedToken()).toBe(TOKEN);
  });

  test("an unreadable sessionStorage is reported and no fallback store is used", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    const { fn } = mockFetch(() => json(200, meBody()));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    expect(text("notice")).toBe("storage_error");
    expect(fn).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("login", () => {
  test("stores only the token in sessionStorage and exposes the server-confirmed user", async () => {
    const { calls } = mockFetch(() => json(200, loginBody("TRANSLATOR")));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    click("login");
    await waitForStatus("authenticated");
    expect(outcomes).toEqual([{ ok: true }]);
    expect(storedToken()).toBe(NEW_TOKEN);
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(text("user")).toBe("데모 번역가|TRANSLATOR");
    expect(calls.map((call) => call.path)).toEqual(["/api/auth/login"]);
  });

  test("a failed login leaves the signed-out state unchanged", async () => {
    mockFetch(() => json(401, errorBody("INVALID_CREDENTIALS")));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    click("login");
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ ok: false, failure: { kind: "unauthorized", code: "INVALID_CREDENTIALS" } });
    expect(status()).toBe("unauthenticated");
    expect(storedToken()).toBeNull();
  });

  test("if the token cannot be stored the login fails and the issued token is revoked", async () => {
    const { calls } = mockFetch((call) => (call.path === "/api/auth/login" ? json(200, loginBody()) : noContent()));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    click("login");
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ ok: false, failure: { kind: "storage" } });
    expect(status()).toBe("unauthenticated");
    await waitFor(() => expect(calls.map((call) => call.path)).toEqual(["/api/auth/login", "/api/auth/logout"]));
    expect(calls[1].headers.Authorization).toBe(`Bearer ${NEW_TOKEN}`);
    expect(window.localStorage.length).toBe(0);
  });

  test("a second login while one is in flight is not sent", async () => {
    const pending = deferred<Response>();
    const { calls } = mockFetch(() => pending.promise);
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    click("login");
    click("login");
    expect(calls).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, loginBody())); });
    await waitForStatus("authenticated");
    expect(outcomes.map((outcome) => outcome.ok).sort()).toEqual([false, true]);
  });

  test("passwords and tokens never reach the console", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    mockFetch((call) => (call.path === "/api/auth/login" ? json(200, loginBody()) : noContent()));
    renderWithAuth(<Probe />);
    await waitForStatus("unauthenticated");
    click("login");
    await waitForStatus("authenticated");
    click("logout");
    await waitForStatus("unauthenticated");
    const printed = consoleSpies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(printed).not.toContain(NEW_TOKEN);
    expect(printed).not.toContain("pw");
  });
});

describe("expiry", () => {
  test("reaching expiresAt clears the local state without polling", async () => {
    storeToken();
    const { fn } = mockFetch(() => json(200, meBody("OPERATOR", 400)));
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    await waitFor(() => expect(status()).toBe("unauthenticated"), { timeout: 2000 });
    expect(storedToken()).toBeNull();
    expect(text("user")).toBe("none");
    expect(text("notice")).toBe("expired");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("tab reactivation after the expiry time signs out locally", async () => {
    storeToken();
    mockFetch(() => json(200, meBody("OPERATOR", 3_600_000)));
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 3_600_000);
    act(() => setVisibility("visible"));
    await waitForStatus("unauthenticated");
    expect(text("notice")).toBe("expired");
    expect(storedToken()).toBeNull();
  });

  test("tab reactivation re-checks with the server, whose verdict is final", async () => {
    storeToken();
    let revoked = false;
    const { fn } = mockFetch(() => (revoked ? json(401, errorBody("AUTH_REQUIRED")) : json(200, meBody())));
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    act(() => setVisibility("hidden"));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(status()).toBe("authenticated");
    revoked = true;
    act(() => setVisibility("visible"));
    await waitForStatus("unauthenticated");
    expect(text("notice")).toBe("unauthorized");
    expect(storedToken()).toBeNull();
  });

  test("a transient failure during the silent re-check does not sign the user out", async () => {
    storeToken();
    let down = false;
    mockFetch(() => { if (down) throw new TypeError("offline"); return json(200, meBody()); });
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    down = true;
    act(() => setVisibility("visible"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(status()).toBe("authenticated");
    expect(storedToken()).toBe(TOKEN);
  });
});

describe("logout and late responses", () => {
  test("logout revokes the token on the server and clears every local trace", async () => {
    storeToken();
    const { calls } = mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : noContent()));
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    click("logout");
    await waitForStatus("unauthenticated");
    expect(calls.at(-1)).toMatchObject({ path: "/api/auth/logout", method: "POST" });
    expect(calls.at(-1)!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(storedToken()).toBeNull();
    expect(text("user")).toBe("none");
    expect(text("notice")).toBe("logged_out");
  });

  test.each([
    ["network failure", () => { throw new TypeError("offline"); }],
    ["503", () => json(503, errorBody("AUTH_UNAVAILABLE"))],
    ["500", () => json(500, errorBody("INTERNAL_ERROR"))],
  ])("logout %s is shown as not confirmed on the server", async (_name, failLogout) => {
    storeToken();
    mockFetch((call) => (call.path === "/api/auth/me" ? json(200, meBody()) : failLogout()));
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    click("logout");
    await waitForStatus("unauthenticated");
    expect(text("notice")).toBe("logout_unconfirmed");
    expect(storedToken()).toBeNull();
  });

  test("a late /me response cannot restore the session after logout", async () => {
    storeToken();
    const late = deferred<Response>();
    let meCalls = 0;
    const { calls } = mockFetch((call) => {
      if (call.path === "/api/auth/logout") return noContent();
      meCalls += 1;
      return meCalls === 1 ? json(200, meBody()) : late.promise;
    });
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    act(() => setVisibility("visible"));
    await waitFor(() => expect(meCalls).toBe(2));
    const lateRequest = calls[1].init.signal as AbortSignal;

    click("logout");
    await waitForStatus("unauthenticated");
    expect(lateRequest.aborted).toBe(true);
    await act(async () => { late.resolve(json(200, meBody("OPERATOR"))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(status()).toBe("unauthenticated");
    expect(text("user")).toBe("none");
    expect(storedToken()).toBeNull();
  });

  test("a late initial /me response cannot undo a 401 handled in the meantime", async () => {
    storeToken();
    const late = deferred<Response>();
    mockFetch(() => late.promise);
    renderWithAuth(<Probe />);
    expect(status()).toBe("initializing");
    click("unauthorized");
    await waitForStatus("unauthenticated");
    await act(async () => { late.resolve(json(200, meBody())); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(status()).toBe("unauthenticated");
    expect(storedToken()).toBeNull();
    expect(text("notice")).toBe("unauthorized");
  });

  test("the previous user is not shown after a different account logs in", async () => {
    storeToken();
    let step = 0;
    mockFetch((call) => {
      if (call.path === "/api/auth/me") return json(200, meBody("OPERATOR"));
      if (call.path === "/api/auth/logout") return noContent();
      step += 1;
      return json(200, loginBody("READER"));
    });
    renderWithAuth(<Probe />);
    await waitForStatus("authenticated");
    expect(text("user")).toBe(`${USERS.OPERATOR.displayName}|OPERATOR`);
    click("logout");
    await waitForStatus("unauthenticated");
    expect(text("user")).toBe("none");
    click("login");
    await waitForStatus("authenticated");
    expect(step).toBe(1);
    expect(text("user")).toBe(`${USERS.READER.displayName}|READER`);
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(NEW_TOKEN);
  });
});


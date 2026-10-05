import { describe, expect, test, vi } from "vitest";
import { clearToken, readToken, TOKEN_STORAGE_KEY, writeToken } from "@/lib/auth/storage";
import { validateLoginId, validatePassword } from "@/lib/auth/validation";
import { TOKEN } from "./helpers";

describe("login input validation (same rules as the server contract)", () => {
  test("accepts the demo accounts and boundary lengths", () => {
    for (const id of ["demo.operator", "demo.translator", "demo.reviewer", "demo.reader", "abc", "a" + "b".repeat(63), "0a-_."]) {
      expect(validateLoginId(id), id).toBeNull();
    }
  });

  test("rejects invalid ids without trimming or case folding", () => {
    for (const id of ["", "ab", "a" + "b".repeat(64), "Demo.Operator", " demo.operator", "demo.operator ", ".demo", "-demo", "데모계정", "demo operator", "demo\n"]) {
      expect(validateLoginId(id), JSON.stringify(id)).not.toBeNull();
    }
  });

  test("password: required, not trimmed, at most 72 UTF-8 bytes", () => {
    expect(validatePassword("")).not.toBeNull();
    expect(validatePassword("   ")).toBeNull();
    expect(validatePassword("  pass word  ")).toBeNull();
    expect(validatePassword("a".repeat(72))).toBeNull();
    expect(validatePassword("a".repeat(73))).not.toBeNull();
    expect(validatePassword("가".repeat(24))).toBeNull(); // 72 bytes
    expect(validatePassword("가".repeat(25))).not.toBeNull(); // 75 bytes
  });
});

describe("token storage", () => {
  test("uses sessionStorage only and never localStorage or cookies", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    expect(writeToken(TOKEN)).toBe(true);
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(readToken()).toEqual({ ok: true, token: TOKEN });
    expect(clearToken()).toBe(true);
    expect(readToken()).toEqual({ ok: true, token: null });
    expect(local.mock.instances.every((instance) => instance === window.sessionStorage)).toBe(true);
  });

  test("a malformed stored value is discarded instead of being sent as a header", () => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, "bad token\r\nX-Injected: 1");
    expect(readToken()).toEqual({ ok: true, token: null });
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  test("storage failures are reported, with no fallback store", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(readToken()).toEqual({ ok: false });
    expect(writeToken(TOKEN)).toBe(false);
    expect(clearToken()).toBe(false);
    expect(document.cookie).toBe("");
  });
});

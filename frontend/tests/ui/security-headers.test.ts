import { afterEach, describe, expect, test, vi } from "vitest";

// next.config.mjs reads NEXT_PUBLIC_API_BASE_URL when it is loaded, so every case loads a fresh copy.
async function load(base: string | undefined, nodeEnv = "production") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", base as string);
  vi.stubEnv("NODE_ENV", nodeEnv);
  return (await import("../../next.config.mjs")) as { default: { poweredByHeader: boolean; headers(): Promise<{ source: string; headers: { key: string; value: string }[] }[]> }; securityHeaders: { key: string; value: string }[] };
}
const header = (headers: { key: string; value: string }[], key: string) => headers.find((item) => item.key === key)?.value;
afterEach(() => vi.unstubAllEnvs());

describe("security headers of the frontend (security review 2026-10-13)", () => {
  test("every path gets the headers and the framework signature stays off", async () => {
    const config = await load("http://localhost:8080");
    const rules = await config.default.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(config.default.poweredByHeader).toBe(false);
    const keys = rules[0].headers.map((item) => item.key).sort();
    expect(keys).toEqual(["Content-Security-Policy", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"]);
    expect(header(rules[0].headers, "X-Frame-Options")).toBe("DENY");
    expect(header(rules[0].headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(rules[0].headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  test("the policy blocks framing, plugins, a changed base and foreign form targets, and names only this site, the API and jsDelivr", async () => {
    const csp = header((await load("https://api.example.test")).securityHeaders, "Content-Security-Policy")!;
    const directive = (name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `));
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self' https://api.example.test");
    expect(directive("img-src")).toContain("https://api.example.test");
    expect(directive("img-src")).toContain("blob:"); // authenticated images are shown from object URLs
    expect(directive("style-src")).toContain("https://cdn.jsdelivr.net");
    expect(directive("font-src")).toContain("https://cdn.jsdelivr.net");
    expect(csp).not.toContain("*");
  });

  test("a production build allows no eval; only the development server does", async () => {
    expect(header((await load("http://localhost:8080", "production")).securityHeaders, "Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(header((await load("http://localhost:8080", "development")).securityHeaders, "Content-Security-Policy")).toContain("unsafe-eval");
  });

  test("the API address check still refuses a missing or malformed value", async () => {
    await expect(load(undefined)).rejects.toThrow(/required/);
    await expect(load("http://localhost:8080/")).rejects.toThrow(/required/);
    await expect(load("ftp://localhost")).rejects.toThrow(/HTTP\(S\)/);
    await expect(load("http://user:pw@localhost:8080")).rejects.toThrow(/HTTP\(S\)/);
  });
});

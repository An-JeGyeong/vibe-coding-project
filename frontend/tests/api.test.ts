import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkHealth, healthLabel } from "../src/lib/api.ts";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = originalUrl;
});

test("200 / 503 map to UP / DOWN display labels and uncached credential-free requests", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  for (const [status, db] of [[200, "UP"], [503, "DOWN"]] as const) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "http://localhost:8080/api/health");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.credentials, "omit");
      assert.ok(options?.signal);
      return new Response(JSON.stringify({ status: "UP", db, time: "2026-10-05T12:00:00Z" }), { status });
    };
    const result = await checkHealth();
    assert.equal(result.kind, db);
    assert.match(healthLabel(result), new RegExp(`^${db}`));
  }
});

test("network failure is a safe error label", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  globalThis.fetch = async () => { throw new Error("private exception"); };
  const result = await checkHealth();
  assert.equal(result.kind, "ERROR");
  assert.match(healthLabel(result), /^오류/);
  assert.doesNotMatch(healthLabel(result), /private exception/);
});

test("missing variable is understandable and does not fetch", async () => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  assert.match(healthLabel(await checkHealth()), /NEXT_PUBLIC_API_BASE_URL/);
});

test("unexpected status and malformed bodies cannot break the display", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  for (const response of [new Response("private", { status: 500 }), new Response("{}"),
    new Response('{"status":"UP","db":"DOWN","time":"2026-10-05T12:00:00Z"}', { status: 200 })]) {
    globalThis.fetch = async () => response;
    assert.equal((await checkHealth()).kind, "ERROR");
  }
});

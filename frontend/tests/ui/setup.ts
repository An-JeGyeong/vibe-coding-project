import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetPersonalStores } from "@/lib/personal/stores";

// The suite is large: under load a default 1s wait occasionally expired before a mocked response was rendered.
configure({ asyncUtilTimeout: 3000 });

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetPersonalStores();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

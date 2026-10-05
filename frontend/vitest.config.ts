import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Component and auth-state tests. The original node:test files in tests/*.test.ts keep running through `node --test`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["tests/ui/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ui/setup.ts"],
    restoreMocks: true,
  },
});

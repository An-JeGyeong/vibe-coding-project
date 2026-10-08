import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// CSS rules that keep layout bugs away cannot be exercised in jsdom (no layout), so the rule itself is pinned here.
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

describe("global css guards", () => {
  test("a scrolling table is a positioned scroller, so the absolutely positioned screen-reader header text cannot widen the page on phones", () => {
    expect(css).toMatch(/\.table-responsive\s*\{\s*position:\s*relative;?\s*\}/);
  });

  test("the brand colours win over Bootstrap whatever the stylesheet order (higher specificity than its own rules)", () => {
    expect(css).toMatch(/html:root\s*\{/);
    expect(css).toMatch(/header\.app-header\.bg-dark\s*\{/);
    expect(css).toMatch(/body \.btn-primary\s*\{/);
  });
});

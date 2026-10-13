"use client";

import { useLibrary, useTheme } from "@/lib/personal/hooks";

/** Heart button: puts a work into "my library" or takes it out (CONTRACTS 30.2). Never inside a link. */
export function BookmarkButton({ workId, title, className = "" }: { workId: string; title: string; className?: string }) {
  const library = useLibrary();
  const on = library.has(workId);
  return <button type="button" className={`bookmark-btn${on ? " on" : ""} ${className}`} aria-pressed={on}
    aria-label={`${title} ${on ? "내 서재에서 빼기" : "내 서재에 담기"}`} onClick={() => library.toggle(workId)}>
    <span aria-hidden="true">{on ? "♥" : "♡"}</span>
  </button>;
}

/** Light / dark switch of the header (CONTRACTS 30.2). The label names the mode it switches to. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return <button type="button" className="btn btn-outline-light btn-sm theme-toggle" aria-pressed={dark} onClick={() => setTheme(dark ? "light" : "dark")}>
    {dark ? "라이트 모드" : "다크 모드"}
  </button>;
}

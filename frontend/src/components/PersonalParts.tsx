"use client";

import { useState } from "react";
import { useLibrary, useRecommended, useTheme } from "@/lib/personal/hooks";
import { getVoterKey, setRecommended } from "@/lib/personal/voter";
import { setRecommendation } from "@/lib/ranking/client";

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
export function ThemeToggle({ className = "btn btn-outline-light btn-sm" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return <button type="button" className={`${className} theme-toggle`} aria-pressed={dark} onClick={() => setTheme(dark ? "light" : "dark")}>
    {dark ? "라이트 모드" : "다크 모드"}
  </button>;
}

/** Recommend button of a work page (CONTRACTS 31.6): one vote per browser, the server answers with the new count. */
export function RecommendButton({ workId, title, initialCount }: { workId: string; title: string; initialCount: number }) {
  const recommended = useRecommended();
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const on = recommended.has(workId);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const result = await setRecommendation(workId, getVoterKey(), !on);
    setBusy(false);
    if (result.ok) { setRecommended(workId, result.value.recommended); setCount(result.value.recommendCount); return; }
    setFailed(result.failure.kind === "not_found" ? "공개되지 않은 작품입니다." : "추천을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.");
  }

  return <span className="d-inline-flex flex-column">
    <button type="button" className={`btn btn-sm recommend-btn ${on ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={on} disabled={busy}
      aria-label={`${title} 추천 ${count}`} onClick={() => void toggle()}>
      <span aria-hidden="true">👍 추천 {count}</span>
    </button>
    {failed && <span className="small text-danger" role="alert">{failed}</span>}
  </span>;
}

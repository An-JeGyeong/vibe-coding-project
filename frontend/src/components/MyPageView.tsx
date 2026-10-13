"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LibraryView } from "./LibraryView";
import { ROLE_INFO } from "@/lib/auth/roles";
import { useAccount } from "@/lib/auth/useAccount";
import { clearLibraryEntries, clearRecentEpisodes, useRecent, useTheme } from "@/lib/personal/hooks";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ViewerSettings } from "@/lib/viewer/storage";

/** The only area of the page that looks at the sign-in state (CONTRACTS 30.2 area 1). The server is asked only when a token exists. */
function AccountArea() {
  const { account, leaving, logout } = useAccount();
  return <section aria-labelledby="my-account" className="card card-body mb-3">
    <h2 id="my-account" className="h5">계정</h2>
    {account.state === "checking" && <p role="status" className="mb-0">확인하는 중…</p>}
    {account.state === "none" && <p className="mb-0">로그인하지 않았습니다. 번역·감수 등 작업을 하려면 <Link href="/login">로그인</Link>하세요.</p>}
    {account.state === "unreachable" && <p className="mb-0 text-danger" role="alert">로그인 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.</p>}
    {account.state === "user" && <div className="d-flex flex-wrap align-items-center gap-3">
      <span>{account.user.displayName} <span className="badge text-bg-secondary">{ROLE_INFO[account.user.role].label}</span></span>
      <Link href="/demo" className="btn btn-outline-secondary btn-sm">작업 공간</Link>
      <button type="button" className="btn btn-outline-secondary btn-sm" disabled={leaving} onClick={() => void logout()}>{leaving ? "로그아웃 중…" : "로그아웃"}</button>
    </div>}
  </section>;
}

function LibraryArea() {
  return <section aria-labelledby="my-library" className="card card-body mb-3">
    <div className="d-flex justify-content-between align-items-center mb-2">
      <h2 id="my-library" className="h5 mb-0">내 서재</h2>
      <Link href="/works" className="btn btn-outline-secondary btn-sm">작품 찾기</Link>
    </div>
    <p className="small text-secondary">이 브라우저에만 저장됩니다. 계정과는 연결되지 않습니다.</p>
    <LibraryView nested />
  </section>;
}

function RecentArea() {
  const recent = useRecent();
  return <section aria-labelledby="my-recent" className="card card-body mb-3">
    <div className="d-flex justify-content-between align-items-center mb-2">
      <h2 id="my-recent" className="h5 mb-0">최근 본 회차</h2>
      {recent.length > 0 && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void clearRecentEpisodes()}>기록 지우기</button>}
    </div>
    {recent.length === 0 ? <p className="mb-0">최근 본 회차가 없습니다.</p> : <ul className="list-unstyled mb-0">
      {recent.map((item) => <li key={item.episodeId} className="py-1">
        <Link href={`/read/${encodeURIComponent(item.episodeId)}`}>{item.workTitle ? `${item.workTitle} · ` : ""}{item.title}</Link>
        <time className="small text-secondary ms-2" dateTime={item.readAt}>{item.readAt.slice(0, 10)}</time>
      </li>)}
    </ul>}
  </section>;
}

function SettingsArea() {
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_SETTINGS);
  useEffect(() => { setSettings(loadSettings()); }, []);
  const change = (patch: Partial<ViewerSettings>) => { const next = { ...settings, ...patch }; setSettings(next); saveSettings(next); };
  return <section aria-labelledby="my-settings" className="card card-body mb-3">
    <h2 id="my-settings" className="h5">읽기 설정</h2>
    <div className="d-flex flex-wrap gap-3">
      <div><label className="form-label small mb-1" htmlFor="my-mode">보기 방식</label>
        <select id="my-mode" className="form-select" value={settings.mode} onChange={(event) => change({ mode: event.target.value as ViewerSettings["mode"] })}>
          <option value="page">쪽 넘김</option><option value="scroll">세로 스크롤</option>
        </select></div>
      <div><label className="form-label small mb-1" htmlFor="my-spread">쪽 수</label>
        <select id="my-spread" className="form-select" value={settings.spread ? "2" : "1"} onChange={(event) => change({ spread: event.target.value === "2" })}>
          <option value="1">한 쪽씩</option><option value="2">두 쪽씩</option>
        </select></div>
      <div><label className="form-label small mb-1" htmlFor="my-direction">읽기 방향</label>
        <select id="my-direction" className="form-select" value={settings.direction} onChange={(event) => change({ direction: event.target.value as ViewerSettings["direction"] })}>
          <option value="rtl">오른쪽→왼쪽</option><option value="ltr">왼쪽→오른쪽</option>
        </select></div>
    </div>
  </section>;
}

function ThemeArea() {
  const [theme, setTheme] = useTheme();
  return <section aria-labelledby="my-theme" className="card card-body mb-3">
    <h2 id="my-theme" className="h5">화면 테마</h2>
    <div className="btn-group" role="group" aria-label="화면 테마">
      <button type="button" aria-pressed={theme === "light"} className={`btn btn-sm ${theme === "light" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTheme("light")}>라이트</button>
      <button type="button" aria-pressed={theme === "dark"} className={`btn btn-sm ${theme === "dark" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTheme("dark")}>다크</button>
    </div>
  </section>;
}

function ClearArea() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  function wipe() { setConfirming(false); void Promise.all([clearLibraryEntries(), clearRecentEpisodes()]).then(() => setDone(true)); }
  return <section aria-labelledby="my-clear" className="card card-body mb-3">
    <h2 id="my-clear" className="h5">내 기록 지우기</h2>
    <p className="small text-secondary">이 브라우저에 저장된 내 서재와 최근 본 회차를 지웁니다. 읽기 설정과 테마는 그대로입니다.</p>
    {!confirming
      ? <div><button type="button" className="btn btn-outline-danger btn-sm" onClick={() => { setDone(false); setConfirming(true); }}>내 기록 지우기</button></div>
      : <div className="d-flex flex-wrap align-items-center gap-2" role="group" aria-label="지우기 확인">
        <span>정말 지울까요? 되돌릴 수 없습니다.</span>
        <button type="button" className="btn btn-danger btn-sm" onClick={wipe}>지우기</button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setConfirming(false)}>취소</button>
      </div>}
    {done && <p role="status" className="small mt-2 mb-0">내 기록을 지웠습니다.</p>}
  </section>;
}

export function MyPageView() {
  return <>
    <AccountArea />
    <LibraryArea />
    <RecentArea />
    <SettingsArea />
    <ThemeArea />
    <ClearArea />
  </>;
}

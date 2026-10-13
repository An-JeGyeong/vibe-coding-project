"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ROLE_INFO } from "@/lib/auth/roles";
import { useAccount, type Account } from "@/lib/auth/useAccount";
import { useProfile } from "@/lib/personal/hooks";
import { ThemeToggle } from "./PersonalParts";

/**
 * The profile button of the header and its popup (CONTRACTS 30.2, D-063): the account (sign in or the signed-in name with the work
 * space and sign out), the my page and the theme switch. A disclosure: it opens by click, closes by Escape, by a click outside or by
 * leaving it with the keyboard, and Escape gives the focus back to the button.
 */
export function ProfileMenu({ account, onLogout, leaving = false, hideLogin = false }: { account: Account; onLogout: () => void; leaving?: boolean; hideLogin?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const profile = useProfile();
  const name = account.state === "user" ? account.user.displayName : profile.displayName || null;
  return <div className="profile-menu" ref={root}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); button.current?.focus(); } }}
    onBlur={(event) => { const next = event.relatedTarget as Node | null; if (open && next !== null && !event.currentTarget.contains(next)) setOpen(false); }}>
    <button type="button" ref={button} className="btn btn-outline-light btn-sm profile-btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">👤 </span>{name ?? "프로필"}
    </button>
    {open && <div id={panelId} className="profile-panel" role="region" aria-label="프로필 메뉴">
      <section aria-label="계정" className="profile-section">
        {account.state === "checking" && <p role="status" className="mb-0 small">확인하는 중…</p>}
        {account.state === "unreachable" && <p role="alert" className="mb-0 small text-danger">로그인 상태를 확인하지 못했습니다.</p>}
        {account.state === "none" && <>
          <p className="mb-2 small">로그인하지 않았습니다.</p>
          {!hideLogin && <div className="d-flex gap-2"><Link href="/login" className="btn btn-primary btn-sm flex-fill" onClick={() => setOpen(false)}>로그인</Link><Link href="/signup" className="btn btn-outline-secondary btn-sm flex-fill" onClick={() => setOpen(false)}>회원가입</Link></div>}
        </>}
        {account.state === "user" && <>
          <p className="mb-2" aria-label="현재 사용자">{account.user.displayName} <span className="badge text-bg-secondary">{ROLE_INFO[account.user.role].label}</span></p>
          <Link href="/demo" className="btn btn-outline-secondary btn-sm w-100 mb-2" onClick={() => setOpen(false)}>작업 공간</Link>
          <button type="button" className="btn btn-outline-secondary btn-sm w-100" disabled={leaving} onClick={onLogout}>{leaving ? "로그아웃 중…" : "로그아웃"}</button>
        </>}
      </section>
      <ul className="profile-section profile-links list-unstyled mb-0">
        <li><Link href="/my" className="profile-link" onClick={() => setOpen(false)}>마이페이지 <span className="small text-secondary">(내 서재·최근 본 회차)</span></Link></li>
        <li><Link href="/payments" className="profile-link" onClick={() => setOpen(false)}>결제 내역</Link></li>
        <li><Link href="/settings" className="profile-link" onClick={() => setOpen(false)}>설정 <span className="small text-secondary">(내 정보 수정)</span></Link></li>
      </ul>
      <div className="profile-section"><ThemeToggle className="btn btn-outline-secondary btn-sm w-100" /></div>
    </div>}
  </div>;
}

/** The profile menu of the public header: it follows the token of this browser tab by itself (no sign-in provider on public screens). */
export function PublicProfileMenu() {
  const { account, leaving, logout } = useAccount();
  return <ProfileMenu account={account} leaving={leaving} onLogout={() => void logout()} />;
}

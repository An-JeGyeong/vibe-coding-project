"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_INFO, ROLE_MENU_LINKS } from "@/lib/auth/roles";
import { ThemeToggle } from "./PersonalParts";

// The common header of the signed-in app (CONTRACTS-independent, display only). It shows who is signed in (as confirmed by the
// server through /api/auth/me) and the links of that role's implemented menus. Access is still enforced by the server.
export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname() ?? "";
  const user = auth.status === "authenticated" ? auth.user : null;
  const menu = user ? Object.entries(ROLE_MENU_LINKS[user.role]) : [];
  const current = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return <>
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <header className="app-header bg-dark text-white">
      <div className="container d-flex flex-wrap align-items-center gap-2 py-2">
        <Link href={user ? "/demo" : "/login"} className="app-brand text-white text-decoration-none fw-bold me-2">망가브릿지</Link>
        <nav aria-label="주 메뉴" className="d-flex flex-wrap gap-1 flex-grow-1">
          {user && <Link href="/demo" className={`app-nav-link${pathname === "/demo" ? " active" : ""}`}>홈</Link>}
          {menu.map(([label, href]) => <Link key={href} href={href} className={`app-nav-link${current(href) ? " active" : ""}`}>{label}</Link>)}
          <Link href="/works" className={`app-nav-link${current("/works") ? " active" : ""}`}>작품</Link>
          <Link href="/read" className={`app-nav-link${current("/read") ? " active" : ""}`}>공개 회차</Link>
          <Link href="/library" className={`app-nav-link${current("/library") ? " active" : ""}`}>내 서재</Link>
          <Link href="/my" className={`app-nav-link${current("/my") ? " active" : ""}`}>마이페이지</Link>
        </nav>
        <div className="d-flex align-items-center gap-2">
          <ThemeToggle />
          {user
            ? <>
              <span className="small" aria-label="현재 사용자">{user.displayName} <span className="badge text-bg-secondary">{ROLE_INFO[user.role].label}</span></span>
              <button type="button" className="btn btn-outline-light btn-sm" onClick={() => void auth.logout()} disabled={auth.loggingOut}>
                {auth.loggingOut ? "로그아웃 중…" : "로그아웃"}
              </button>
            </>
            : pathname !== "/login" && <Link href="/login" className="btn btn-outline-light btn-sm">로그인</Link>}
        </div>
      </div>
    </header>
    {children}
  </>;
}

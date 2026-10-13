"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_MENU_LINKS } from "@/lib/auth/roles";
import type { Account } from "@/lib/auth/useAccount";
import { ProfileMenu } from "./ProfileMenu";

// The common header of the signed-in app (CONTRACTS-independent, display only). It shows who is signed in (as confirmed by the
// server through /api/auth/me) and the links of that role's implemented menus. Access is still enforced by the server.
export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname() ?? "";
  const user = auth.status === "authenticated" ? auth.user : null;
  const account: Account = user ? { state: "user", user } : auth.status === "initializing" ? { state: "checking" } : { state: "none" };
  const menu = user ? Object.entries(ROLE_MENU_LINKS[user.role]) : [];
  const current = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return <>
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <header className="app-header bg-dark text-white">
      <div className="container d-flex flex-wrap align-items-center gap-2 py-2">
        <Link href={user ? "/demo" : "/login"} className="app-brand text-white text-decoration-none fw-bold me-2">망가브릿지</Link>
        <nav aria-label="주 메뉴" className="d-flex flex-wrap gap-1 flex-grow-1">
          {menu.map(([label, href]) => <Link key={href} href={href} className={`app-nav-link${current(href) ? " active" : ""}`}>{label}</Link>)}
          <Link href="/works" className={`app-nav-link${current("/works") ? " active" : ""}`}>작품</Link>
          <Link href="/ranking" className={`app-nav-link${current("/ranking") ? " active" : ""}`}>랭킹</Link>
          <Link href="/read" className={`app-nav-link${current("/read") ? " active" : ""}`}>공개 회차</Link>
        </nav>
        <form role="search" className="header-search" action="/works" method="get">
          <label className="visually-hidden" htmlFor="header-query">작품 제목·작가 검색</label>
          <input id="header-query" name="q" type="search" className="form-control form-control-sm" placeholder="작품 검색" />
          <button type="submit" className="btn btn-primary btn-sm">검색</button>
        </form>
        <ProfileMenu account={account} onLogout={() => void auth.logout()} leaving={auth.loggingOut} hideLogin={pathname === "/login"} />
      </div>
    </header>
    {children}
  </>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/PersonalParts";

export const metadata: Metadata = { title: "만화 읽기" };

// The public reader shell: no sign-in state, no token, nothing role dependent (CONTRACTS 23.3).
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <header className="app-header bg-dark text-white">
      <div className="container d-flex flex-wrap align-items-center justify-content-between py-2 gap-2 gap-md-3">
        <Link href="/" className="app-brand text-white text-decoration-none fw-bold">망가브릿지</Link>
        <nav aria-label="주요 메뉴" className="d-flex align-items-center gap-1 flex-grow-1">
          <Link href="/" className="app-nav-link">홈</Link>
          <Link href="/works" className="app-nav-link">작품</Link>
          <Link href="/ranking" className="app-nav-link">랭킹</Link>
          <Link href="/read" className="app-nav-link">회차 목록</Link>
          <Link href="/library" className="app-nav-link">내 서재</Link>
          <Link href="/my" className="app-nav-link">마이페이지</Link>
          {/* the same for everyone: it does not depend on who is signed in; /demo sends a visitor without a login to the login page */}
          <Link href="/demo" className="app-nav-link">작업 공간</Link>
        </nav>
        <form role="search" className="header-search" action="/works" method="get">
          <label className="visually-hidden" htmlFor="header-query">작품 제목·작가 검색</label>
          <input id="header-query" name="q" type="search" className="form-control form-control-sm" placeholder="작품 검색" />
          <button type="submit" className="btn btn-primary btn-sm">검색</button>
        </form>
        <ThemeToggle />
        <Link href="/login" className="btn btn-outline-light btn-sm">로그인</Link>
      </div>
    </header>
    {children}
    <footer className="public-footer mt-5 py-4 border-top">
      <div className="container small text-secondary d-flex flex-wrap justify-content-between gap-2">
        <span>망가브릿지 · 번역된 만화를 읽는 곳</span>
        <span className="d-flex gap-3"><Link href="/read">공개 회차 목록</Link><Link href="/login">로그인</Link></span>
      </div>
    </footer>
  </>;
}

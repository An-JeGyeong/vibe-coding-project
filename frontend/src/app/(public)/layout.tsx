import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "망가브릿지" };

// The public reader shell: no sign-in state, no token, nothing role dependent (CONTRACTS 23.3).
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <header className="app-header bg-dark text-white">
      <div className="container d-flex align-items-center justify-content-between py-2 gap-3">
        <Link href="/" className="app-brand text-white text-decoration-none fw-bold">망가브릿지</Link>
        <nav aria-label="주요 메뉴" className="d-flex align-items-center gap-3 flex-grow-1">
          <Link href="/" className="text-white text-decoration-none small">홈</Link>
          <Link href="/read" className="text-white text-decoration-none small">회차 목록</Link>
        </nav>
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

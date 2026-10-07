import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "공개 회차" };

// The public reader shell: no sign-in state, no token, nothing role dependent (CONTRACTS 23.3).
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <header className="app-header bg-dark text-white">
      <div className="container d-flex align-items-center justify-content-between py-2">
        <Link href="/read" className="app-brand text-white text-decoration-none fw-bold">망가브릿지</Link>
        <Link href="/login" className="btn btn-outline-light btn-sm">로그인</Link>
      </div>
    </header>
    {children}
  </>;
}

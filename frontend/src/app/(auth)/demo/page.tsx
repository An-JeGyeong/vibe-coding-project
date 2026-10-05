"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { failureMessage } from "@/lib/auth/messages";
import { ROLE_INFO } from "@/lib/auth/roles";

export default function DemoPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  // Nothing protected is rendered until the server has confirmed the user through /api/auth/me.
  if (auth.status === "initializing") return <main><p role="status">로그인 상태를 확인하는 중…</p></main>;
  if (auth.status === "unauthenticated") return <main><p role="status">로그인 화면으로 이동하는 중…</p></main>;
  if (auth.status === "check_failed") {
    return <main>
      <h1>로그인 상태를 확인하지 못했습니다</h1>
      <div className="notice" role="alert">
        <p>{auth.failure ? failureMessage(auth.failure) : "잠시 후 다시 시도하세요."} 로그아웃되지는 않았습니다.</p>
        <button type="button" onClick={auth.retry}>다시 시도</button>
      </div>
    </main>;
  }

  const user = auth.user!;
  const info = ROLE_INFO[user.role];
  return <main>
    <p className="eyebrow">MANGABRIDGE · DEMO AUTH</p>
    <h1>데모 화면</h1>
    <section aria-label="현재 사용자">
      <h2>현재 사용자</h2>
      <p>{user.displayName}</p>
      <p>역할: <strong>{info.label}</strong> (<code>{user.role}</code>)</p>
      {auth.expiresAt !== null && <p>세션 만료 시각 (UTC): <time>{new Date(auth.expiresAt).toISOString()}</time></p>}
      <p>{info.summary}</p>
      <p className="hint">서버에서 확인한 사용자와 역할입니다. 운영자는 다른 역할의 권한을 자동으로 갖지 않습니다.</p>
    </section>
    <section aria-label="업무 메뉴">
      <h2>업무 메뉴</h2>
      <ul className="menu">
        {info.menus.map((menu) => <li key={menu}><button type="button" disabled aria-disabled="true">{menu}</button></li>)}
      </ul>
      <p className="hint">업무 기능은 후속 단계에서 제공됩니다. 화면의 안내는 편의 기능이며 접근 권한은 서버가 판단합니다.</p>
    </section>
    <button type="button" onClick={() => void auth.logout()} disabled={auth.loggingOut}>
      {auth.loggingOut ? "로그아웃 중…" : "로그아웃"}
    </button>
  </main>;
}

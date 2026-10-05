"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/lib/auth/AuthProvider";
import { failureMessage, NOTICE_MESSAGE } from "@/lib/auth/messages";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "authenticated") router.replace("/demo");
  }, [auth.status, router]);

  return <main>
    <p className="eyebrow">MANGABRIDGE · DEMO AUTH</p>
    <h1>로그인</h1>
    {auth.status === "initializing" && <p role="status">로그인 상태를 확인하는 중…</p>}
    {auth.status === "authenticated" && <p role="status">데모 화면으로 이동하는 중…</p>}
    {(auth.status === "unauthenticated" || auth.status === "check_failed") && <>
      {auth.notice && <p className="notice" role="status">{NOTICE_MESSAGE[auth.notice]}</p>}
      {auth.status === "check_failed" && auth.failure && <div className="notice" role="alert">
        <p>저장된 로그인 상태를 확인하지 못했습니다. {failureMessage(auth.failure)}</p>
        <button type="button" onClick={auth.retry}>다시 확인</button>
      </div>}
      <section><LoginForm /></section>
    </>}
  </main>;
}

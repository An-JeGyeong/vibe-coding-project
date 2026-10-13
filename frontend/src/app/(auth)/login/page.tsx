"use client";

import Link from "next/link";
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

  return <main id="main-content" className="container login-main py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · DEMO AUTH</p>
    <h1 className="h2 mb-3">로그인</h1>
    {auth.status === "initializing" && <p role="status">로그인 상태를 확인하는 중…</p>}
    {auth.status === "authenticated" && <p role="status">데모 화면으로 이동하는 중…</p>}
    {(auth.status === "unauthenticated" || auth.status === "check_failed") && <>
      {auth.notice && <p className="alert alert-info" role="status">{NOTICE_MESSAGE[auth.notice]}</p>}
      {auth.status === "check_failed" && auth.failure && <div className="alert alert-warning" role="alert">
        <p>저장된 로그인 상태를 확인하지 못했습니다. {failureMessage(auth.failure)}</p>
        <button type="button" className="btn btn-primary" onClick={auth.retry}>다시 확인</button>
      </div>}
      <section className="card card-body shadow-sm"><LoginForm /></section>
      <p className="small mt-3">아직 계정이 없나요? <Link href="/signup">회원가입</Link></p>
    </>}
  </main>;
}

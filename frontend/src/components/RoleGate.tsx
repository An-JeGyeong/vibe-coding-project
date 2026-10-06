"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { failureMessage } from "@/lib/auth/messages";
import { ROLE_INFO } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/types";

// Convenience gate only: children (and their API calls) are mounted for a server-confirmed role in `roles`.
// The server enforces roles independently and answers 403 to everyone else.
export function RoleGate({ roles, deniedMessage, children }: { roles: readonly Role[]; deniedMessage: string; children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "initializing") return <p role="status">로그인 상태를 확인하는 중…</p>;
  if (auth.status === "unauthenticated") return <p role="status">로그인 화면으로 이동하는 중…</p>;
  if (auth.status === "check_failed") {
    return <div className="alert alert-warning" role="alert">
      <p>{auth.failure ? failureMessage(auth.failure) : "잠시 후 다시 시도하세요."} 로그아웃되지는 않았습니다.</p>
      <button type="button" className="btn btn-primary" onClick={auth.retry}>다시 시도</button>
    </div>;
  }
  if (!roles.includes(auth.user!.role)) {
    return <div className="alert alert-warning" role="alert">
      <p>{deniedMessage} 현재 역할: {ROLE_INFO[auth.user!.role].label}. 로그인 상태는 유지됩니다.</p>
      <Link href="/demo" className="btn btn-outline-secondary">데모 화면으로</Link>
    </div>;
  }
  return <>{children}</>;
}

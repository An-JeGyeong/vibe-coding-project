"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { failureMessage } from "@/lib/auth/messages";
import { DEMO_ACCOUNTS, ROLE_INFO } from "@/lib/auth/roles";
import { validateLoginId, validatePassword } from "@/lib/auth/validation";

export function LoginForm() {
  const { login } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ loginId: string | null; password: string | null }>({ loginId: null, password: null });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const submittingRef = useRef(false);

  // The submit button stays disabled until the server's Retry-After time has passed.
  useEffect(() => {
    if (retryAt === null) return;
    const timer = setTimeout(() => setRetryAt(null), Math.max(retryAt - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [retryAt]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const next = { loginId: validateLoginId(loginId), password: validatePassword(password) };
    setErrors(next);
    if (next.loginId || next.password) return;

    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    const outcome = await login(loginId, password);
    submittingRef.current = false;
    setSubmitting(false);
    if (outcome.ok) return; // The page moves to /demo once the auth state is authenticated.

    const { failure } = outcome;
    const until = failure.kind === "rate_limited" && failure.retryAfterSeconds !== null
      ? Date.now() + failure.retryAfterSeconds * 1000 : null;
    setRetryAt(until);
    setMessage(failureMessage(failure, { retryAt: until }));
    if (failure.kind === "unauthorized" || failure.kind === "rate_limited") setPassword("");
  }

  return <>
    <form onSubmit={onSubmit} noValidate aria-label="로그인">
      <label className="form-label w-100">로그인 ID
        <input className="form-control mt-1" name="loginId" type="text" value={loginId} autoComplete="username" autoCapitalize="none"
          autoCorrect="off" spellCheck={false} aria-invalid={errors.loginId ? true : undefined}
          aria-describedby={errors.loginId ? "loginId-error" : undefined}
          onChange={(event) => setLoginId(event.target.value)} />
      </label>
      {errors.loginId && <p id="loginId-error" className="text-danger small mt-1 mb-0" role="alert">{errors.loginId}</p>}
      <label className="form-label w-100 mt-2">비밀번호
        <input className="form-control mt-1" name="password" type="password" value={password} autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "password-error" : undefined}
          onChange={(event) => setPassword(event.target.value)} />
      </label>
      {errors.password && <p id="password-error" className="text-danger small mt-1 mb-0" role="alert">{errors.password}</p>}
      {message && <p className="alert alert-danger mt-3 mb-0" role="alert">{message}</p>}
      <button type="submit" className="btn btn-primary mt-3 w-100" disabled={submitting || retryAt !== null}>{submitting ? "로그인 중…" : "로그인"}</button>
    </form>
    <section aria-label="데모 계정 안내" className="mt-4 pt-3 border-top">
      <h2 className="h5">데모 로그인 ID</h2>
      <p>비밀번호는 데모 운영자에게 별도로 전달받습니다.</p>
      <ul className="mb-0">
        {DEMO_ACCOUNTS.map((account) => <li key={account.loginId}>
          {ROLE_INFO[account.role].label}: <code>{account.loginId}</code>
        </li>)}
      </ul>
    </section>
  </>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { registerAccount, type AccountFailure } from "@/lib/account/client";
import { loginIdProblem, nameProblem, passwordProblem } from "@/lib/account/rules";
import { AUTH_EVENT } from "@/lib/auth/events";
import { writeToken } from "@/lib/auth/storage";
import { useAccount } from "@/lib/auth/useAccount";

function failureText(failure: AccountFailure): string {
  switch (failure.kind) {
    case "taken": return "이미 사용 중인 아이디입니다. 다른 아이디를 입력하세요.";
    case "rate_limited": {
      const minutes = failure.retryAfterSeconds === null ? null : Math.max(1, Math.ceil(failure.retryAfterSeconds / 60));
      return `가입 요청이 너무 많습니다. ${minutes === null ? "잠시" : `${minutes}분`} 뒤에 다시 시도하세요.`;
    }
    case "invalid_request": return "입력한 내용을 서버가 받아들이지 않았습니다. 아이디·비밀번호·이름의 규칙을 다시 확인하세요.";
    case "network": case "timeout": case "unavailable": case "misconfigured": return "서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도하세요.";
    default: return "가입하지 못했습니다. 잠시 뒤에 다시 시도하세요.";
  }
}

/** Reader sign-up (CONTRACTS 32.7): the same rules as the server, a fixed message per failure, and a signed-in start. */
export function SignupForm() {
  const router = useRouter();
  const { account } = useAccount();
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const problems = {
    loginId: loginIdProblem(loginId),
    name: nameProblem(name),
    password: passwordProblem(loginId, password),
    confirm: password === confirm ? null : "비밀번호가 서로 다릅니다.",
  };
  const invalid = Object.values(problems).some((problem) => problem !== null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    setFailure(null);
    if (invalid) return;
    setBusy(true);
    const result = await registerAccount(loginId, password, name.trim());
    if (!result.ok) { setBusy(false); setFailure(failureText(result.failure)); return; }
    if (!writeToken(result.value.accessToken)) {
      setBusy(false);
      setFailure("계정은 만들어졌지만 이 브라우저가 로그인 정보를 저장하지 못했습니다. 로그인 화면에서 로그인해 주세요.");
      return;
    }
    try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* no window */ }
    router.push("/my");
  }

  if (account.state === "user") {
    return <p className="alert alert-info">이미 로그인되어 있습니다(<strong>{account.user.displayName}</strong>). <Link href="/my">마이페이지로</Link></p>;
  }

  const shown = (problem: string | null) => touched && problem !== null;
  return <form onSubmit={submit} noValidate className="card card-body shadow-sm" aria-label="회원가입">
    <div className="mb-3">
      <label className="form-label" htmlFor="su-id">아이디</label>
      <input id="su-id" className={`form-control${shown(problems.loginId) ? " is-invalid" : ""}`} value={loginId} autoComplete="username" autoCapitalize="none" spellCheck={false}
        aria-describedby="su-id-help" aria-invalid={shown(problems.loginId)} onChange={(event) => setLoginId(event.target.value)} />
      <div id="su-id-help" className={`form-text${shown(problems.loginId) ? " text-danger" : ""}`}>{shown(problems.loginId) ? problems.loginId : "영어 소문자·숫자와 . _ - 로 4~20자"}</div>
    </div>
    <div className="mb-3">
      <label className="form-label" htmlFor="su-name">표시 이름</label>
      <input id="su-name" className={`form-control${shown(problems.name) ? " is-invalid" : ""}`} value={name} autoComplete="nickname"
        aria-describedby="su-name-help" aria-invalid={shown(problems.name)} onChange={(event) => setName(event.target.value)} />
      <div id="su-name-help" className={`form-text${shown(problems.name) ? " text-danger" : ""}`}>{shown(problems.name) ? problems.name : "1~20자, 나중에 설정에서 바꿀 수 있습니다"}</div>
    </div>
    <div className="mb-3">
      <label className="form-label" htmlFor="su-pw">비밀번호</label>
      <input id="su-pw" type="password" className={`form-control${shown(problems.password) ? " is-invalid" : ""}`} value={password} autoComplete="new-password"
        aria-describedby="su-pw-help" aria-invalid={shown(problems.password)} onChange={(event) => setPassword(event.target.value)} />
      <div id="su-pw-help" className={`form-text${shown(problems.password) ? " text-danger" : ""}`}>{shown(problems.password) ? problems.password : "10자 이상, 아이디를 포함하지 않는 흔하지 않은 값"}</div>
    </div>
    <div className="mb-3">
      <label className="form-label" htmlFor="su-pw2">비밀번호 확인</label>
      <input id="su-pw2" type="password" className={`form-control${shown(problems.confirm) ? " is-invalid" : ""}`} value={confirm} autoComplete="new-password"
        aria-describedby="su-pw2-help" aria-invalid={shown(problems.confirm)} onChange={(event) => setConfirm(event.target.value)} />
      <div id="su-pw2-help" className={`form-text${shown(problems.confirm) ? " text-danger" : ""}`}>{shown(problems.confirm) ? problems.confirm : "같은 비밀번호를 한 번 더 입력하세요"}</div>
    </div>
    {failure && <p role="alert" className="text-danger">{failure}</p>}
    <div className="d-flex flex-wrap align-items-center gap-3">
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "가입하는 중…" : "가입하기"}</button>
      <span className="small">이미 계정이 있나요? <Link href="/login">로그인</Link></span>
    </div>
    <p className="small text-secondary mt-3 mb-0">이메일이나 전화번호는 받지 않습니다. 비밀번호를 잊으면 되찾을 수 없으니 잘 보관하세요.</p>
  </form>;
}

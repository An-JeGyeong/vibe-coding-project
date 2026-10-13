"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { changePassword, getProfile, saveProfile as saveServerProfile, type AccountFailure } from "@/lib/account/client";
import { bioProblem, nameProblem, passwordProblem } from "@/lib/account/rules";
import { AUTH_EVENT } from "@/lib/auth/events";
import { ROLE_INFO } from "@/lib/auth/roles";
import { useAccount } from "@/lib/auth/useAccount";
import { BIO_MAX, clearProfile, loadProfile, NAME_MAX, saveProfile } from "@/lib/personal/profile";
import { currentToken, dropToken } from "@/lib/personal/stores";

type Message = { kind: "ok" | "error"; text: string } | null;

function failureText(failure: AccountFailure, fallback: string): string {
  switch (failure.kind) {
    case "wrong_current_password": return "현재 비밀번호가 올바르지 않습니다.";
    case "invalid_request": return "입력한 내용을 서버가 받아들이지 않았습니다. 규칙을 다시 확인하세요.";
    case "unauthorized": return "로그인이 만료되었습니다. 다시 로그인하세요.";
    case "network": case "timeout": case "unavailable": return "서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도하세요.";
    default: return fallback;
  }
}

function Status({ message }: { message: Message }) {
  if (!message) return null;
  return <span role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-danger" : "text-success"}>{message.text}</span>;
}

/** The profile kept in this browser, for readers who are not signed in (D-063). */
function BrowserProfile() {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => { const profile = loadProfile(); setName(profile.displayName); setBio(profile.bio); }, []);

  function save(event: React.FormEvent) {
    event.preventDefault();
    const result = saveProfile({ displayName: name, bio });
    if (!result.ok) { setMessage({ kind: "error", text: result.message }); return; }
    setName(result.value.displayName);
    setBio(result.value.bio);
    setMessage({ kind: "ok", text: "저장했습니다." });
  }
  function reset() { clearProfile(); setName(""); setBio(""); setMessage({ kind: "ok", text: "프로필을 지웠습니다." }); }

  return <section aria-labelledby="set-profile" className="card card-body mb-3">
    <h2 id="set-profile" className="h5">내 정보</h2>
    <p className="small text-secondary">로그인하지 않았으므로 이 브라우저에만 저장되며 서버로 보내지 않습니다. 이름을 정하면 헤더의 프로필 버튼에 표시됩니다. <Link href="/signup">회원가입</Link>하면 계정에 저장할 수 있습니다.</p>
    <form onSubmit={save} noValidate>
      <div className="mb-3">
        <label className="form-label" htmlFor="set-name">표시 이름 <span className="small text-secondary">(최대 {NAME_MAX}자)</span></label>
        <input id="set-name" className="form-control" style={{ maxWidth: "24rem" }} value={name} onChange={(event) => { setName(event.target.value); setMessage(null); }} autoComplete="off" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="set-bio">한 줄 소개 <span className="small text-secondary">(최대 {BIO_MAX}자)</span></label>
        <input id="set-bio" className="form-control" style={{ maxWidth: "36rem" }} value={bio} onChange={(event) => { setBio(event.target.value); setMessage(null); }} autoComplete="off" />
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <button type="submit" className="btn btn-primary">저장</button>
        <button type="button" className="btn btn-outline-secondary" onClick={reset}>프로필 지우기</button>
        <Status message={message} />
      </div>
    </form>
  </section>;
}

/** The signed-in account's own profile and password, stored on the server (CONTRACTS 32.3, 32.7). */
function AccountProfile() {
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<Message>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    const token = currentToken();
    if (token === null) return;
    const request = new AbortController();
    void getProfile(token, request.signal).then((result) => {
      if (request.signal.aborted) return;
      if (result.ok) { setLoginId(result.value.loginId); setName(result.value.displayName); setBio(result.value.bio); setLoaded(true); return; }
      if (result.failure.kind === "unauthorized") dropToken();
      else setMessage({ kind: "error", text: failureText(result.failure, "내 정보를 불러오지 못했습니다.") });
    });
    return () => request.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = nameProblem(name) ?? bioProblem(bio);
    if (problem) { setMessage({ kind: "error", text: problem }); return; }
    const token = currentToken();
    if (token === null) return;
    setSaving(true);
    const result = await saveServerProfile(token, name.trim(), bio.trim());
    setSaving(false);
    if (!result.ok) {
      if (result.failure.kind === "unauthorized") dropToken();
      setMessage({ kind: "error", text: failureText(result.failure, "저장하지 못했습니다.") });
      return;
    }
    setName(result.value.displayName);
    setBio(result.value.bio);
    setMessage({ kind: "ok", text: "저장했습니다." });
    try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* no window */ }   // the name in the header follows
  }

  async function password(event: React.FormEvent) {
    event.preventDefault();
    if (changing) return;
    const problem = passwordProblem(loginId, next) ?? (next === confirm ? null : "새 비밀번호가 서로 다릅니다.");
    if (current === "") { setPasswordMessage({ kind: "error", text: "현재 비밀번호를 입력하세요." }); return; }
    if (problem) { setPasswordMessage({ kind: "error", text: problem }); return; }
    const token = currentToken();
    if (token === null) return;
    setChanging(true);
    const result = await changePassword(token, current, next);
    setChanging(false);
    if (!result.ok) {
      if (result.failure.kind === "unauthorized") dropToken();
      setPasswordMessage({ kind: "error", text: failureText(result.failure, "비밀번호를 바꾸지 못했습니다.") });
      return;
    }
    setCurrent(""); setNext(""); setConfirm("");
    setPasswordMessage({ kind: "ok", text: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 풀렸습니다." });
  }

  return <>
    <section aria-labelledby="set-profile" className="card card-body mb-3">
      <h2 id="set-profile" className="h5">내 정보</h2>
      <p className="small text-secondary">계정에 저장되어 다른 기기에서도 같게 보입니다. 이메일·전화번호는 받지 않습니다.</p>
      <form onSubmit={save} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="set-name">표시 이름 <span className="small text-secondary">(최대 {NAME_MAX}자)</span></label>
          <input id="set-name" className="form-control" style={{ maxWidth: "24rem" }} value={name} disabled={!loaded} onChange={(event) => { setName(event.target.value); setMessage(null); }} autoComplete="off" />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="set-bio">한 줄 소개 <span className="small text-secondary">(최대 {BIO_MAX}자)</span></label>
          <input id="set-bio" className="form-control" style={{ maxWidth: "36rem" }} value={bio} disabled={!loaded} onChange={(event) => { setBio(event.target.value); setMessage(null); }} autoComplete="off" />
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button type="submit" className="btn btn-primary" disabled={!loaded || saving}>{saving ? "저장하는 중…" : "저장"}</button>
          <Status message={message} />
        </div>
      </form>
    </section>
    <section aria-labelledby="set-password" className="card card-body mb-3">
      <h2 id="set-password" className="h5">비밀번호 변경</h2>
      <form onSubmit={password} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="set-current">현재 비밀번호</label>
          <input id="set-current" type="password" className="form-control" style={{ maxWidth: "24rem" }} value={current} autoComplete="current-password" onChange={(event) => { setCurrent(event.target.value); setPasswordMessage(null); }} />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="set-new">새 비밀번호</label>
          <input id="set-new" type="password" className="form-control" style={{ maxWidth: "24rem" }} value={next} autoComplete="new-password" aria-describedby="set-new-help" onChange={(event) => { setNext(event.target.value); setPasswordMessage(null); }} />
          <div id="set-new-help" className="form-text">10자 이상, 아이디를 포함하지 않는 흔하지 않은 값</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="set-confirm">새 비밀번호 확인</label>
          <input id="set-confirm" type="password" className="form-control" style={{ maxWidth: "24rem" }} value={confirm} autoComplete="new-password" onChange={(event) => { setConfirm(event.target.value); setPasswordMessage(null); }} />
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button type="submit" className="btn btn-primary" disabled={changing}>{changing ? "바꾸는 중…" : "비밀번호 바꾸기"}</button>
          <Status message={passwordMessage} />
        </div>
      </form>
    </section>
  </>;
}

/** User settings (D-063, CONTRACTS 32.7): the signed-in account's profile and password, or the browser's own profile when nobody is signed in. */
export function SettingsView() {
  const { account } = useAccount();
  return <>
    <section aria-labelledby="set-account" className="card card-body mb-3">
      <h2 id="set-account" className="h5">로그인 계정</h2>
      {account.state === "user"
        ? <p className="mb-1">{account.user.displayName} <span className="badge text-bg-secondary">{ROLE_INFO[account.user.role].label}</span></p>
        : <p className="mb-1">{account.state === "checking" ? "확인하는 중…" : <>로그인하지 않았습니다. <Link href="/login">로그인</Link> 또는 <Link href="/signup">회원가입</Link></>}</p>}
      <p className="small text-secondary mb-0">{account.state === "user" ? "업무용 데모 계정의 역할은 바꿀 수 없습니다." : "계정이 있으면 서재·최근 본 회차·추천이 계정에 저장됩니다."}</p>
    </section>
    {account.state === "user" ? <AccountProfile /> : account.state === "checking" ? null : <BrowserProfile />}
  </>;
}

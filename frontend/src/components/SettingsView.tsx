"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROLE_INFO } from "@/lib/auth/roles";
import { useAccount } from "@/lib/auth/useAccount";
import { BIO_MAX, clearProfile, loadProfile, NAME_MAX, saveProfile } from "@/lib/personal/profile";

/** User settings (D-063): for now only the personal information of the profile kept in this browser can be edited. */
export function SettingsView() {
  const { account } = useAccount();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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

  return <>
    <section aria-labelledby="set-account" className="card card-body mb-3">
      <h2 id="set-account" className="h5">로그인 계정</h2>
      {account.state === "user"
        ? <p className="mb-1">{account.user.displayName} <span className="badge text-bg-secondary">{ROLE_INFO[account.user.role].label}</span></p>
        : <p className="mb-1">{account.state === "checking" ? "확인하는 중…" : <>로그인하지 않았습니다. <Link href="/login">로그인</Link></>}</p>}
      <p className="small text-secondary mb-0">계정의 이름과 역할은 서버 정보라 여기서 바꿀 수 없습니다.</p>
    </section>
    <section aria-labelledby="set-profile" className="card card-body mb-3">
      <h2 id="set-profile" className="h5">내 정보</h2>
      <p className="small text-secondary">이 브라우저에만 저장되며 서버로 보내지 않습니다. 이름을 정하면 로그인하지 않았을 때 헤더의 프로필 버튼에 표시됩니다.</p>
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
          {message && <span role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-danger" : "text-success"}>{message.text}</span>}
        </div>
      </form>
    </section>
  </>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getEpisodeLink, linkEpisode, listAdminWorks, unlinkEpisode } from "@/lib/works/client";
import { workFailureMessage } from "@/lib/works/messages";
import type { AdminWork, EpisodeWorkLink } from "@/lib/works/types";

type Notice = { tone: "success" | "danger" | "warning"; text: string };

/** Links an episode to a work with an episode number, or removes the link (CONTRACTS 28.6). Operator screen only. */
export function EpisodeWorkPanel({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [link, setLink] = useState<EpisodeWorkLink | null | undefined>(undefined); // undefined: not loaded yet
  const [works, setWorks] = useState<AdminWork[] | null>(null);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [workId, setWorkId] = useState("");
  const [episodeNo, setEpisodeNo] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    const [current, list] = await Promise.all([getEpisodeLink(episodeId, request.signal), listAdminWorks(100, 0, request.signal)]);
    if (active.current !== request) return;
    active.current = null;
    for (const result of [current, list]) {
      if (!result.ok && result.failure.kind === "aborted") return;
      if (!result.ok && result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    }
    if (!current.ok) { setFailure(current.failure); return; }
    setFailure(null);
    setLink(current.value);
    setWorks(list.ok ? list.value.items : null);
    if (current.value) { setWorkId(current.value.workId); setEpisodeNo(String(current.value.episodeNo)); }
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  async function run(action: () => Promise<{ ok: boolean; failure?: EpisodeFailure }>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const result = await action();
    busyRef.current = false;
    setBusy(false);
    if (result.ok) { setNotice({ tone: "success", text: success }); await load(); return; }
    const reason = result.failure as EpisodeFailure;
    if (reason.kind === "unauthorized") { handleUnauthorized(); return; }
    setNotice({ tone: reason.kind === "state_conflict" ? "warning" : "danger", text: workFailureMessage(reason) });
  }

  const number = Number(episodeNo);
  const numberValid = /^[0-9]{1,4}$/.test(episodeNo) && number >= 1 && number <= 9999;
  const canSubmit = workId !== "" && numberValid && !busy;

  return <section id="section-work" aria-label="작품 연결" className="card card-body shadow-sm mb-3">
    <h2 className="h5">작품 연결</h2>
    <p className="text-secondary small">이 회차가 속한 작품과 회차 번호를 정합니다. 작품에 연결되지 않은 회차도 공개 회차 목록에서는 읽을 수 있습니다.</p>
    {failure && <div className="alert alert-warning" role="alert">
      <p>{workFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>다시 시도</button>
    </div>}
    {!failure && link === undefined && <p role="status">불러오는 중…</p>}
    {!failure && link !== undefined && <>
      <p className="mb-2">{link
        ? <>현재 작품: <Link href={`/works-admin/${encodeURIComponent(link.workId)}`}><strong>{link.title}</strong></Link> · {link.episodeNo}화</>
        : <span className="text-secondary">연결된 작품이 없습니다.</span>}</p>
      {notice && <p className={`alert alert-${notice.tone}`} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p>}
      {works === null && <p className="text-danger small" role="alert">작품 목록을 불러오지 못했습니다. 새로고침한 뒤 다시 시도하세요.</p>}
      {works !== null && works.length === 0 && <p className="text-secondary small">먼저 <Link href="/works-admin">작품을 만드세요</Link>.</p>}
      {works !== null && works.length > 0 && <form className="row g-2 align-items-end" onSubmit={(event) => { event.preventDefault(); if (canSubmit) void run(() => linkEpisode(episodeId, workId, number), "작품에 연결했습니다."); }}>
        <div className="col-12 col-md-6">
          <label className="form-label small mb-1" htmlFor="episode-work-select">작품</label>
          <select id="episode-work-select" className="form-select" value={workId} onChange={(event) => setWorkId(event.target.value)}>
            <option value="">작품 선택</option>
            {works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1" htmlFor="episode-work-no">회차 번호</label>
          <input id="episode-work-no" className="form-control" inputMode="numeric" value={episodeNo} aria-invalid={episodeNo !== "" && !numberValid ? true : undefined}
            onChange={(event) => setEpisodeNo(event.target.value)} />
        </div>
        <div className="col-6 col-md-3 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>{busy ? "처리 중…" : link ? "변경" : "연결"}</button>
          {link && <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => void run(() => unlinkEpisode(episodeId), "작품 연결을 해제했습니다.")}>해제</button>}
        </div>
        {episodeNo !== "" && !numberValid && <p className="text-danger small mb-0" role="alert">회차 번호는 1~9999의 정수입니다.</p>}
      </form>}
    </>}
  </section>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getMyEpisode, listMyEpisodes } from "@/lib/assignment/client";
import { ASSIGNEE_LABEL, type MyEpisodeDetail, type MyEpisodeList } from "@/lib/assignment/types";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { TranslationWorkspace } from "./TranslationWorkspace";

const PAGE_SIZE = 20;

// Read-only views for the translator / reviewer. There is deliberately no edit or save UI here.
export function AssignedListView() {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<MyEpisodeList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listMyEpisodes(PAGE_SIZE, nextOffset, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setOffset(nextOffset); setError(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setError(episodeFailureMessage(result.failure));
  }, [handleUnauthorized]);

  useEffect(() => {
    void load(0);
    return () => activeLoad.current?.abort();
  }, [load]);

  const total = list?.total ?? 0;
  return <section aria-label="배정된 회차 목록" className="card card-body shadow-sm">
    <h2 className="h5">내게 배정된 회차</h2>
    {loading && <p role="status">불러오는 중…</p>}
    {error && <div className="alert alert-warning" role="alert">
      <p>{error}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
    </div>}
    {!loading && !error && list && list.items.length === 0 && <p className="text-secondary">배정된 회차가 없습니다.</p>}
    {list && list.items.length > 0 && <table className="table align-middle">
      <thead><tr><th>제목</th><th>내 담당</th><th>최신 원문 버전</th><th>배정 시각 (UTC)</th></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={item.id}>
          <td><Link href={`/assigned/${encodeURIComponent(item.id)}`}>{item.title}</Link></td>
          <td>{ASSIGNEE_LABEL[item.assignedRole]}</td>
          <td>{item.latestSourceVersion === 0 ? "원문 없음" : `v${item.latestSourceVersion}`}</td>
          <td><time>{item.assignedAt}</time></td>
        </tr>)}
      </tbody>
    </table>}
    {list && total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0}
        onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total}
        onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

export function AssignedDetailView({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [detail, setDetail] = useState<MyEpisodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  // The translation workspace re-reads the latest source version after every change; the header must follow it.
  const [liveSourceVersion, setLiveSourceVersion] = useState<number | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await getMyEpisode(episodeId, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setDetail(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setDetail(null); // never keep showing a source the server no longer lets this user see
    setFailure(result.failure);
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  if (loading && !detail) return <p role="status">불러오는 중…</p>;
  if (failure) {
    return <div className="alert alert-warning" role="alert">
      <p>{failure.kind === "not_found" ? "배정되지 않았거나 존재하지 않는 회차입니다." : episodeFailureMessage(failure)}</p>
      {failure.kind === "not_found"
        ? <Link href="/assigned" className="btn btn-outline-secondary">배정된 회차 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!detail) return null;

  return <>
    <p><Link href="/assigned">← 배정된 회차</Link></p>
    <h1 className="h2 mb-1">{detail.title}</h1>
    <p className="text-secondary">내 담당: <strong>{ASSIGNEE_LABEL[detail.assignedRole]}</strong> ·
      {detail.source ? ` 최신 원문 v${Math.max(detail.source.version, liveSourceVersion ?? 0)}` : " 아직 저장된 원문이 없습니다."}</p>
    {detail.assignedRole === "TRANSLATOR" && detail.source !== null
      ? <TranslationWorkspace episodeId={episodeId} onLatestSourceVersion={setLiveSourceVersion} />
      : <section aria-label="원문 (읽기 전용)" className="card card-body shadow-sm">
      <h2 className="h5">원문 (읽기 전용)</h2>
      {detail.source === null
        ? <p className="text-secondary">운영자가 원문을 저장하면 여기에 표시됩니다.</p>
        : <ol>{detail.source.blocks.map((block) => <li key={block.seq} style={{ whiteSpace: "pre-wrap" }}>
          {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.text}
        </li>)}</ol>}
    </section>}
  </>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getPublicEpisode, listPublicEpisodes } from "@/lib/publication/client";
import { publicFailureMessage } from "@/lib/publication/messages";
import type { PublicEpisode, PublicEpisodeList, PublicEpisodeView } from "@/lib/publication/types";
import { filterByTitle, loadAllPublicEpisodes, neighbours, type AllPublicEpisodes } from "@/lib/reader/episodes";
import { hasPosition, loadPosition, savePosition, type ReadPosition } from "@/lib/reader/position";

const PAGE_SIZE = 20;

// Public reader screens. No login, no token, no role: nothing here depends on who is looking.
export function PublicListView() {
  const [list, setList] = useState<PublicEpisodeList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<AllPublicEpisodes | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allFailure, setAllFailure] = useState<EpisodeFailure | null>(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const activeLoad = useRef<AbortController | null>(null);
  const activeAll = useRef<AbortController | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listPublicEpisodes(PAGE_SIZE, nextOffset, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setOffset(nextOffset); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setFailure(result.failure);
  }, []);

  const loadAll = useCallback(async () => {
    activeAll.current?.abort();
    const request = new AbortController();
    activeAll.current = request;
    setAllLoading(true);
    const result = await loadAllPublicEpisodes(request.signal);
    if (activeAll.current !== request) return;
    activeAll.current = null;
    setAllLoading(false);
    if (result.ok) { setAll(result.value); setAllFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setAllFailure(result.failure);
  }, []);

  useEffect(() => {
    void load(0);
    return () => { activeLoad.current?.abort(); activeAll.current?.abort(); };
  }, [load]);

  const searching = query.trim() !== "";
  useEffect(() => {
    // the full list is loaded once, only when a search is typed, and reused while this screen stays open
    if (searching && all === null && !allLoading && allFailure === null) void loadAll();
  }, [searching, all, allLoading, allFailure, loadAll]);

  const matches = searching && all ? filterByTitle(all.items, query) : [];
  const shown: PublicEpisode[] = searching ? matches.slice(searchOffset, searchOffset + PAGE_SIZE) : list?.items ?? [];
  const total = searching ? matches.length : list?.total ?? 0;
  const currentOffset = searching ? searchOffset : offset;
  const busy = searching ? allLoading : loading;
  const currentFailure = searching ? allFailure : failure;
  const retry = () => { if (searching) { setAllFailure(null); } else void load(offset); };
  const go = (next: number) => { if (searching) setSearchOffset(next); else void load(next); };

  return <section aria-label="공개 회차 목록">
    <div className="mb-3">
      <label className="form-label small mb-1" htmlFor="read-search">제목 검색</label>
      <input id="read-search" type="search" className="form-control" value={query} placeholder="제목으로 검색"
        onChange={(event) => { setQuery(event.target.value); setSearchOffset(0); }} />
    </div>
    {busy && <p role="status">불러오는 중…</p>}
    {currentFailure && <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(currentFailure)}</p>
      <button type="button" className="btn btn-primary" onClick={retry}>다시 시도</button>
    </div>}
    {searching && all?.truncated && <p className="text-secondary small">처음 1000개 회차 안에서 검색했습니다.</p>}
    {!busy && !currentFailure && searching && all && matches.length === 0 && <p className="text-secondary">검색 결과가 없습니다.</p>}
    {!busy && !currentFailure && !searching && list && list.items.length === 0 && <p className="text-secondary">아직 공개된 회차가 없습니다.</p>}
    {shown.length > 0 && <ul className="list-group mb-3">
      {shown.map((item) => <li key={item.episodeId} className="list-group-item d-flex justify-content-between align-items-center">
        <span>
          <Link href={`/read/${encodeURIComponent(item.episodeId)}`}>{item.title}</Link>
          {hasPosition(item.episodeId, item.publishedAt) && <span className="badge text-bg-info ms-2">이어 읽기</span>}
        </span>
        <span className="small text-secondary">공개 <time>{item.publishedAt}</time></span>
      </li>)}
    </ul>}
    {total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={busy || currentOffset === 0}
        onClick={() => go(Math.max(currentOffset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{currentOffset + 1}–{Math.min(currentOffset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={busy || currentOffset + PAGE_SIZE >= total}
        onClick={() => go(currentOffset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

export function PublicEpisodeReader({ episodeId }: { episodeId: string }) {
  const [view, setView] = useState<PublicEpisodeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [near, setNear] = useState<{ previous: PublicEpisode | null; next: PublicEpisode | null } | null>(null);
  const [position, setPosition] = useState<ReadPosition | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await getPublicEpisode(episodeId, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setView(result.value); setFailure(null); setPosition(loadPosition(episodeId, result.value.publishedAt)); return; }
    if (result.failure.kind === "aborted") return;
    setView(null); // never keep showing a text the server no longer publishes
    setPosition(null);
    setFailure(result.failure);
  }, [episodeId]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  const shown = view !== null;
  useEffect(() => {
    // previous / next episode: best effort, a failure only hides the links (CONTRACTS 23.3)
    if (!shown) return;
    const request = new AbortController();
    void loadAllPublicEpisodes(request.signal).then((result) => {
      if (request.signal.aborted) return;
      setNear(result.ok ? neighbours(result.value.items, episodeId) : null);
    });
    return () => request.abort();
  }, [shown, episodeId]);

  function jumpTo(seq: number) {
    const element = document.getElementById(`block-${seq}`);
    element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  function markRead(seq: number) {
    if (!view) return;
    savePosition(episodeId, seq, view.publishedAt);
    setPosition({ seq, publishedAt: view.publishedAt });
  }

  if (loading && !view) return <p role="status">불러오는 중…</p>;
  if (failure && !view) {
    return <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(failure)}</p>
      {failure.kind === "not_found"
        ? <Link href="/read" className="btn btn-outline-secondary">공개 회차 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!view) return null;

  const resume = position && view.blocks.some((block) => block.seq === position.seq) ? position : null;
  const neighbourLinks = near && (near.previous || near.next) && <nav aria-label="이웃 회차" className="d-flex justify-content-between my-3">
    <span>{near.previous && <Link href={`/read/${encodeURIComponent(near.previous.episodeId)}`}>← 이전 회차 {near.previous.title}</Link>}</span>
    <span>{near.next && <Link href={`/read/${encodeURIComponent(near.next.episodeId)}`}>다음 회차 {near.next.title} →</Link>}</span>
  </nav>;
  return <article className="reader-article">
    <p><Link href="/read">← 공개 회차 목록</Link></p>
    <h1 className="h2 mb-1">{view.title}</h1>
    <p className="text-secondary small">공개 <time>{view.publishedAt}</time></p>
    {resume && <p><button type="button" className="btn btn-outline-info btn-sm" onClick={() => jumpTo(resume.seq)}>이어 읽기: 블록 {resume.seq}로 이동</button></p>}
    <ol className="list-unstyled">
      {view.blocks.map((block) => <li key={block.seq} id={`block-${block.seq}`} className={`border rounded bg-body p-3 mb-2 reader-block${resume?.seq === block.seq ? " current" : ""}`}>
        <div style={{ whiteSpace: "pre-wrap" }}>
          {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.text}
        </div>
        <div className="mt-2 d-flex align-items-center gap-2">
          {resume?.seq === block.seq && <span className="badge text-bg-info">읽던 위치</span>}
          <button type="button" className="btn btn-outline-secondary btn-sm" aria-label={`블록 ${block.seq} 여기까지 읽음`} onClick={() => markRead(block.seq)}>여기까지 읽음</button>
        </div>
      </li>)}
    </ol>
    {neighbourLinks}
  </article>;
}

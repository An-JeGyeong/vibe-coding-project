"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getPublicEpisode, listPublicEpisodes } from "@/lib/publication/client";
import { publicFailureMessage } from "@/lib/publication/messages";
import type { PublicEpisodeList, PublicEpisodeView } from "@/lib/publication/types";

const PAGE_SIZE = 20;

// Public reader screens. No login, no token, no role: nothing here depends on who is looking.
export function PublicListView() {
  const [list, setList] = useState<PublicEpisodeList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

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

  useEffect(() => {
    void load(0);
    return () => activeLoad.current?.abort();
  }, [load]);

  const total = list?.total ?? 0;
  return <section aria-label="공개 회차 목록">
    {loading && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
    </div>}
    {!loading && !failure && list && list.items.length === 0 && <p className="text-secondary">아직 공개된 회차가 없습니다.</p>}
    {list && list.items.length > 0 && <ul className="list-group mb-3">
      {list.items.map((item) => <li key={item.episodeId} className="list-group-item d-flex justify-content-between align-items-center">
        <Link href={`/read/${encodeURIComponent(item.episodeId)}`}>{item.title}</Link>
        <span className="small text-secondary">공개 <time>{item.publishedAt}</time></span>
      </li>)}
    </ul>}
    {list && total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0}
        onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total}
        onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

export function PublicEpisodeReader({ episodeId }: { episodeId: string }) {
  const [view, setView] = useState<PublicEpisodeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
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
    if (result.ok) { setView(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setView(null); // never keep showing a text the server no longer publishes
    setFailure(result.failure);
  }, [episodeId]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

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

  return <article>
    <p><Link href="/read">← 공개 회차 목록</Link></p>
    <h1 className="h2 mb-1">{view.title}</h1>
    <p className="text-secondary small">공개 <time>{view.publishedAt}</time></p>
    <ol className="list-unstyled">
      {view.blocks.map((block) => <li key={block.seq} className="border rounded bg-body p-3 mb-2" style={{ whiteSpace: "pre-wrap" }}>
        {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.text}
      </li>)}
    </ol>
  </article>;
}

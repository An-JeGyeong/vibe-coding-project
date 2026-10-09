"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getWork } from "@/lib/catalog/client";
import type { WorkDetail } from "@/lib/catalog/types";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import { loadViewerPosition } from "@/lib/viewer/storage";
import { Cover, GenreBadges } from "./CatalogParts";

/** Work page (CONTRACTS 28.6): cover, facts, description and the public episodes. No login, no token, nothing role dependent. */
export function WorkDetailView({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await getWork(workId, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setWork(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setWork(null); // never keep showing a work the server no longer publishes
    setFailure(result.failure);
  }, [workId]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  if (loading && !work) return <p role="status">불러오는 중…</p>;
  if (failure && !work) {
    return <div className="alert alert-warning" role="alert">
      <p>{failure.kind === "not_found" ? "공개되지 않았거나 존재하지 않는 작품입니다." : publicFailureMessage(failure)}</p>
      {failure.kind === "not_found"
        ? <Link href="/" className="btn btn-outline-secondary">메인으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!work) return null;

  const ascending = [...work.episodes].sort((a, b) => a.episodeNo - b.episodeNo);
  const shown = newestFirst ? [...ascending].reverse() : ascending;
  // "continue reading": the furthest episode that has a saved page for the publication shown now
  const resume = [...ascending].reverse().find((entry) => loadViewerPosition(entry.episodeId, entry.publishedAt) !== null) ?? null;
  const first = ascending[0] ?? null;
  return <article className="work-detail">
    <p><Link href="/">← 메인</Link></p>
    <div className="work-hero row g-4 mb-4">
      <div className="col-12 col-md-4 col-lg-3"><Cover workId={work.workId} title={work.title} hasCover={work.hasCover} className="work-detail-cover" /></div>
      <div className="col-12 col-md-8 col-lg-9">
        <h1 className="h2 mb-1">{work.title}</h1>
        <p className="mb-2">{work.author}</p>
        <p className="mb-2"><GenreBadges genres={work.genres} /></p>
        <p className="small text-secondary mb-3">
          {work.episodeCount}개 회차 · 조회 {work.views.toLocaleString("ko-KR")} · 읽기 방향 {work.readingDirection === "RTL" ? "오른쪽→왼쪽" : "왼쪽→오른쪽"}
        </p>
        <p style={{ whiteSpace: "pre-wrap" }}>{work.description}</p>
        <div className="d-flex gap-2 flex-wrap">
          {first && <Link href={`/read/${encodeURIComponent(first.episodeId)}`} className="btn btn-primary">첫 화 보기</Link>}
          {resume && <Link href={`/read/${encodeURIComponent(resume.episodeId)}`} className="btn btn-outline-primary">이어 읽기 ({resume.episodeNo}화)</Link>}
        </div>
      </div>
    </div>
    <section aria-label="회차 목록">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h2 className="h5 mb-0">회차</h2>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setNewestFirst(!newestFirst)}>
          {newestFirst ? "첫 화부터 보기" : "최신 화부터 보기"}
        </button>
      </div>
      <ul className="list-group reader-list">
        {shown.map((entry) => <li key={entry.episodeId} className="list-group-item d-flex justify-content-between align-items-center">
          <Link href={`/read/${encodeURIComponent(entry.episodeId)}`}>{entry.episodeNo}화 · {entry.title}</Link>
          <span className="small text-secondary">공개 <time>{entry.publishedAt.slice(0, 10)}</time></span>
        </li>)}
      </ul>
    </section>
  </article>;
}

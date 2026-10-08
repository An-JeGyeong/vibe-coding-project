"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import type { PublicEpisode } from "@/lib/publication/types";
import { loadLatestPublicEpisodes } from "@/lib/reader/episodes";
import { hasPosition } from "@/lib/reader/position";

const LATEST_COUNT = 12;

/**
 * Reader main page, simple form (CONTRACTS 28.7 step a): the newest public episodes as cards, from the existing public episode list.
 * Works, covers, banners and genres arrive with the catalog API; this is also the fallback when that API is unavailable.
 */
export function HomeView() {
  const [items, setItems] = useState<PublicEpisode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await loadLatestPublicEpisodes(LATEST_COUNT, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setItems(result.value.items); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setFailure(result.failure);
  }, []);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  return <main id="main-content" className="container py-5">
    <section aria-label="소개" className="home-hero mb-4">
      <h1 className="h2 mb-2">번역된 만화를 읽어 보세요</h1>
      <p className="text-secondary mb-0">망가브릿지에서 번역·감수를 마치고 공개된 회차를 바로 읽을 수 있습니다.</p>
    </section>
    <section aria-label="최신 공개 회차">
      <div className="d-flex align-items-baseline justify-content-between">
        <h2 className="h4">최신 공개 회차</h2>
        <Link href="/read" className="small">전체 회차 보기</Link>
      </div>
      {loading && items === null && <p role="status">불러오는 중…</p>}
      {failure && <div className="alert alert-warning" role="alert">
        <p>{publicFailureMessage(failure)}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
      </div>}
      {!loading && !failure && items !== null && items.length === 0 && <p className="text-secondary empty-note">아직 공개된 회차가 없습니다.</p>}
      {items !== null && items.length > 0 && <ul className="home-cards list-unstyled row g-3">
        {items.map((item) => <li key={item.episodeId} className="col-6 col-md-4 col-lg-3">
          <Link href={`/read/${encodeURIComponent(item.episodeId)}`} className="home-card card h-100 text-decoration-none shadow-sm">
            <div className="home-card-cover" aria-hidden="true">{item.title.slice(0, 1)}</div>
            <div className="card-body">
              <h3 className="h6 card-title mb-1">{item.title}</h3>
              <p className="small text-secondary mb-0">공개 <time>{item.publishedAt.slice(0, 10)}</time></p>
              {hasPosition(item.episodeId, item.publishedAt) && <span className="badge text-bg-info mt-2">이어 읽기</span>}
            </div>
          </Link>
        </li>)}
      </ul>}
    </section>
  </main>;
}

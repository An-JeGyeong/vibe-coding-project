"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHome, listWorks } from "@/lib/catalog/client";
import { GENRES, type HomeData, type LatestEpisode, type WorkSummary } from "@/lib/catalog/types";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import type { PublicEpisode } from "@/lib/publication/types";
import { loadLatestPublicEpisodes } from "@/lib/reader/episodes";
import { hasPosition } from "@/lib/reader/position";
import { Cover, GenreBadges, WorkGrid } from "./CatalogParts";

const LATEST_COUNT = 12;

type Card = { episodeId: string; title: string; publishedAt: string; workId: string | null; subtitle: string | null };
const fromEpisode = (item: PublicEpisode): Card => ({ ...item, workId: null, subtitle: null });
const fromLatest = (item: LatestEpisode): Card => ({
  episodeId: item.episodeId, title: item.title, publishedAt: item.publishedAt, workId: item.workId,
  subtitle: item.workTitle === null ? null : item.episodeNo === null ? item.workTitle : `${item.workTitle} · ${item.episodeNo}화`,
});

function EpisodeCards({ cards }: { cards: Card[] }) {
  return <ul className="home-cards list-unstyled row g-3">
    {cards.map((item) => <li key={item.episodeId} className="col-6 col-md-4 col-lg-3">
      <Link href={`/read/${encodeURIComponent(item.episodeId)}`} className="home-card card h-100 text-decoration-none shadow-sm">
        {item.workId !== null
          ? <Cover workId={item.workId} title={item.subtitle ?? item.title} hasCover className="home-card-cover" />
          : <div className="home-card-cover cover-placeholder" aria-hidden="true">{item.title.slice(0, 1)}</div>}
        <div className="card-body">
          <h3 className="h6 card-title mb-1">{item.title}</h3>
          {item.subtitle && <p className="small text-secondary mb-1">{item.subtitle}</p>}
          <p className="small text-secondary mb-0">공개 <time>{item.publishedAt.slice(0, 10)}</time></p>
          {hasPosition(item.episodeId, item.publishedAt) && <span className="badge text-bg-info mt-2">이어 읽기</span>}
        </div>
      </Link>
    </li>)}
  </ul>;
}

/** Latest public episodes from the plain public list: the whole page when the catalog is unavailable (CONTRACTS 28.7 step a). */
function SimpleLatest() {
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

  return <section aria-label="최신 공개 회차">
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
    {items !== null && items.length > 0 && <EpisodeCards cards={items.map(fromEpisode)} />}
  </section>;
}

/** Banners: the cover shown large, moved by buttons only (no automatic rotation). */
function Banners({ banners }: { banners: WorkSummary[] }) {
  const [index, setIndex] = useState(0);
  const current = banners[Math.min(index, banners.length - 1)];
  return <section aria-label="추천 배너" aria-roledescription="carousel" className="home-banner mb-4">
    <div className="home-banner-slide" role="group" aria-roledescription="slide" aria-label={`${Math.min(index, banners.length - 1) + 1} / ${banners.length}`}>
      <Cover workId={current.workId} title={current.title} hasCover className="home-banner-cover" />
      <div className="home-banner-text">
        <h2 className="h3 mb-1">{current.title}</h2>
        <p className="mb-2">{current.author}</p>
        <p className="mb-3"><GenreBadges genres={current.genres} /></p>
        <Link href={`/works/${encodeURIComponent(current.workId)}`} className="btn btn-light">작품 보기</Link>
      </div>
    </div>
    {banners.length > 1 && <div className="home-banner-controls">
      <button type="button" className="btn btn-outline-light btn-sm" onClick={() => setIndex((index - 1 + banners.length) % banners.length)}>이전 배너</button>
      <span className="small" aria-live="polite">{Math.min(index, banners.length - 1) + 1} / {banners.length}</span>
      <button type="button" className="btn btn-outline-light btn-sm" onClick={() => setIndex((index + 1) % banners.length)}>다음 배너</button>
    </div>}
  </section>;
}

/** Works of one genre; nothing is requested until a tab is chosen (CONTRACTS 28.6). */
function GenreSection() {
  const [selected, setSelected] = useState<string | null>(null); // "" means all genres
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (genre: string) => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    setFailure(null);
    const result = await listWorks({ genre: genre === "" ? undefined : genre, sort: "popular", limit: 12 }, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setWorks(result.value.items); return; }
    if (result.failure.kind === "aborted") return;
    setWorks(null);
    setFailure(result.failure);
  }, []);

  useEffect(() => () => active.current?.abort(), []);
  const choose = (genre: string) => { setSelected(genre); setWorks(null); void load(genre); };

  return <section aria-label="장르별 작품" className="mb-4">
    <h2 className="h4">장르별 작품</h2>
    <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="장르 선택">
      {["", ...GENRES].map((genre) => <button key={genre || "all"} type="button" aria-pressed={selected === genre}
        className={`btn btn-sm ${selected === genre ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => choose(genre)}>{genre || "전체"}</button>)}
    </div>
    {selected === null && <p className="text-secondary small">장르를 선택하면 작품을 볼 수 있습니다.</p>}
    {loading && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void load(selected ?? "")}>다시 시도</button>
    </div>}
    {works !== null && works.length === 0 && <p className="text-secondary empty-note">이 장르의 공개 작품이 아직 없습니다.</p>}
    {works !== null && works.length > 0 && <WorkGrid works={works} label={`${selected || "전체"} 작품`} />}
  </section>;
}

/**
 * Reader main page (CONTRACTS 28.6): banners, latest episodes, popular works, featured works, genre tabs.
 * One home request feeds the first four sections; when it fails the plain latest-episode list is shown with a retry.
 */
export function HomeView() {
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await getHome(request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setHome(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setFailure(result.failure);
  }, []);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  const empty = home !== null && home.latest.length === 0 && home.popular.length === 0 && home.featured.length === 0 && home.banners.length === 0;
  return <main id="main-content" className="container py-5">
    {home !== null && home.banners.length > 0 && <Banners banners={home.banners} />}
    <section aria-label="소개" className="home-hero mb-4">
      <h1 className="h2 mb-2">번역된 만화를 읽어 보세요</h1>
      <p className="text-secondary mb-0">망가브릿지에서 번역·감수를 마치고 공개된 회차를 바로 읽을 수 있습니다.</p>
    </section>
    {loading && home === null && failure === null && <p role="status">불러오는 중…</p>}
    {failure !== null && <>
      <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
        <span>작품 정보를 불러오지 못해 최신 회차만 보여 드립니다.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>다시 시도</button>
      </div>
      <SimpleLatest />
    </>}
    {empty && <p className="text-secondary empty-note">아직 공개된 회차가 없습니다.</p>}
    {home !== null && home.latest.length > 0 && <section aria-label="최신 공개 회차" className="mb-4">
      <div className="d-flex align-items-baseline justify-content-between">
        <h2 className="h4">최신 공개 회차</h2>
        <Link href="/read" className="small">전체 회차 보기</Link>
      </div>
      <EpisodeCards cards={home.latest.map(fromLatest)} />
    </section>}
    {home !== null && home.popular.length > 0 && <section aria-label="인기 작품" className="mb-4">
      <h2 className="h4">인기 작품</h2>
      <WorkGrid works={home.popular} label="인기 작품 목록" />
    </section>}
    {home !== null && home.featured.length > 0 && <section aria-label="운영자 추천" className="mb-4">
      <h2 className="h4">운영자 추천</h2>
      <WorkGrid works={home.featured} label="운영자 추천 작품 목록" />
    </section>}
    {home !== null && <GenreSection />}
  </main>;
}

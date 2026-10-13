"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHome, listWorks } from "@/lib/catalog/client";
import { GENRES, type HomeData, type LatestEpisode, type WorkSummary } from "@/lib/catalog/types";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import type { PublicEpisode } from "@/lib/publication/types";
import { useRecent } from "@/lib/personal/hooks";
import { loadLatestPublicEpisodes } from "@/lib/reader/episodes";
import { hasPosition } from "@/lib/reader/position";
import { Cover, WorkGrid } from "./CatalogParts";
import { HeroCarousel } from "./HeroCarousel";
import { HomeRanking } from "./RankingViews";

const LATEST_COUNT = 12;
const NEW_WITHIN_MS = 3 * 24 * 60 * 60 * 1000; // an episode counts as new for three days
const isRecent = (publishedAt: string) => Date.now() - Date.parse(publishedAt) < NEW_WITHIN_MS;

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
        {isRecent(item.publishedAt) && <span className="new-badge" aria-hidden="true">NEW</span>}
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

/** The last episodes opened in this browser (CONTRACTS 30.2); the section is absent when there are none. */
function ContinueReading() {
  const recent = useRecent().slice(0, 4);
  if (recent.length === 0) return null;
  return <section aria-label="이어 읽기" className="mb-4">
    <h2 className="h4">이어 읽기</h2>
    <ul className="list-unstyled row g-3">
      {recent.map((item) => <li key={item.episodeId} className="col-12 col-md-6 col-lg-3">
        <Link href={`/read/${encodeURIComponent(item.episodeId)}`} className="card h-100 text-decoration-none shadow-sm">
          <div className="card-body">
            <h3 className="h6 card-title mb-1">{item.title}</h3>
            {item.workTitle && <p className="small text-secondary mb-0">{item.workTitle}{item.episodeNo !== null ? ` · ${item.episodeNo}화` : ""}</p>}
          </div>
        </Link>
      </li>)}
    </ul>
  </section>;
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
 * Reader main page (CONTRACTS 28.6, revised D-058: the hero only, no banner): latest episodes, popular works, featured works, genre tabs.
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

  const empty = home !== null && home.latest.length === 0 && home.popular.length === 0 && home.featured.length === 0;
  return <main id="main-content" className="container py-5">
    <HeroCarousel banners={home?.banners ?? []} />
    <ContinueReading />
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
    {home !== null && <HomeRanking popular={home.popular} />}
    {home !== null && home.featured.length > 0 && <section aria-label="운영자 추천" className="mb-4">
      <h2 className="h4">운영자 추천</h2>
      <WorkGrid works={home.featured} label="운영자 추천 작품 목록" />
    </section>}
    {home !== null && <GenreSection />}
  </main>;
}

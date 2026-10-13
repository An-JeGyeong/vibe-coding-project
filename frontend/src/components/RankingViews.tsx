"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkSummary } from "@/lib/catalog/types";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import { getRanking } from "@/lib/ranking/client";
import { PERIOD_DAYS, PERIOD_LABEL, PERIODS, RECOMMEND_WEIGHT, type Period, type RankedWork } from "@/lib/ranking/types";
import { WorkCard, WorkGrid } from "./CatalogParts";
import { BookmarkButton } from "./PersonalParts";

export function periodNote(period: Period): string {
  return `지난 ${PERIOD_DAYS[period]}일 · 조회 1점, 추천 ${RECOMMEND_WEIGHT}점`;
}

export function PeriodTabs({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return <div className="d-flex flex-wrap gap-2 mb-2" role="group" aria-label="랭킹 기간">
    {PERIODS.map((value) => <button key={value} type="button" aria-pressed={period === value}
      className={`btn btn-sm ${period === value ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => onChange(value)}>{PERIOD_LABEL[value]}</button>)}
  </div>;
}

export function RankedGrid({ items, label }: { items: RankedWork[]; label: string }) {
  return <ul className="list-unstyled row g-3" aria-label={label}>
    {items.map((work) => <li key={work.workId} className="col-6 col-md-4 col-lg-3 col-xl-2 position-relative">
      <span className={`rank-badge${work.rank <= 3 ? " top" : ""}`} aria-hidden="true">{work.rank}</span>
      <WorkCard work={work} cumulative />
      <BookmarkButton workId={work.workId} title={work.title} className="bookmark-corner" />
      <p className="small text-secondary mt-1 mb-0">{work.rank}위 · {work.score.toLocaleString("ko-KR")}점 (기간 조회 {work.periodViews.toLocaleString("ko-KR")} · 기간 추천 {work.periodRecommends.toLocaleString("ko-KR")})</p>
    </li>)}
  </ul>;
}

type State = { items: RankedWork[] | null; loading: boolean; failure: EpisodeFailure | null };

/** Loads one period (CONTRACTS 31.4). A newer request cancels the older one, so a slow answer never overwrites the tab chosen last. */
function useRanking(period: Period, limit: number) {
  const [state, setState] = useState<State>({ items: null, loading: true, failure: null });
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setState({ items: null, loading: true, failure: null });
    const result = await getRanking(period, limit, request.signal);
    if (active.current !== request) return;
    active.current = null;
    if (result.ok) { setState({ items: result.value.items, loading: false, failure: null }); return; }
    if (result.failure.kind === "aborted") return;
    setState({ items: null, loading: false, failure: result.failure });
  }, [period, limit]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  return { ...state, reload: load };
}

function RankingBody({ period, state, label }: { period: Period; state: ReturnType<typeof useRanking>; label: string }) {
  return <>
    <p className="small text-secondary" id={`ranking-note-${label}`}>{periodNote(period)}</p>
    {state.loading && <p role="status">불러오는 중…</p>}
    {state.failure && <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(state.failure)}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void state.reload()}>다시 시도</button>
    </div>}
    {state.items !== null && state.items.length === 0 && <p className="text-secondary empty-note">이 기간에는 아직 집계된 작품이 없습니다.</p>}
    {state.items !== null && state.items.length > 0 && <RankedGrid items={state.items} label={`${PERIOD_LABEL[period]} 랭킹`} />}
  </>;
}

/** The ranking screen /ranking (CONTRACTS 31.6). */
export function RankingPage({ initialPeriod = "week" }: { initialPeriod?: Period }) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const state = useRanking(period, 50);
  useEffect(() => {
    try { window.history.replaceState(null, "", period === "week" ? window.location.pathname : `${window.location.pathname}?period=${period}`); } catch { /* no history */ }
  }, [period]);
  return <section aria-label="랭킹">
    <PeriodTabs period={period} onChange={setPeriod} />
    <RankingBody period={period} state={state} label="page" />
  </section>;
}

/**
 * The main page section (CONTRACTS 31.6): period tabs with the top ten. When the first request fails or the ranking is empty the
 * section is the plain "popular works" list (total views) of the home answer, as before.
 */
export function HomeRanking({ popular }: { popular: WorkSummary[] }) {
  const [period, setPeriod] = useState<Period>("week");
  const [usable, setUsable] = useState<boolean | null>(null); // null until the first answer
  const state = useRanking(period, 10);
  useEffect(() => {
    if (usable !== null || state.loading) return;
    setUsable(state.items !== null && state.items.length > 0);
  }, [usable, state.loading, state.items]);

  if (usable === false) {
    return popular.length === 0 ? null : <section aria-label="인기 작품" className="mb-4">
      <h2 className="h4">인기 작품</h2>
      <WorkGrid works={popular} label="인기 작품 목록" ranked />
    </section>;
  }
  if (usable === null) {
    return popular.length === 0 ? null : <section aria-label="인기 작품" className="mb-4">
      <h2 className="h4">인기 작품</h2>
      <WorkGrid works={popular} label="인기 작품 목록" ranked />
    </section>;
  }
  return <section aria-label="랭킹" className="mb-4">
    <h2 className="h4">랭킹</h2>
    <PeriodTabs period={period} onChange={setPeriod} />
    <RankingBody period={period} state={state} label="home" />
  </section>;
}

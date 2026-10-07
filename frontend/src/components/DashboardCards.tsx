"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMyEpisodes } from "@/lib/assignment/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Role } from "@/lib/auth/types";
import { type Chip, mapLimited, operatorChip, translatorChip, translatorSummary } from "@/lib/dashboard/status";
import { listEpisodes } from "@/lib/episodes/client";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure, EpisodeResult } from "@/lib/episodes/types";
import { getPublication, listPublicEpisodes } from "@/lib/publication/client";
import { publicFailureMessage } from "@/lib/publication/messages";
import { listOperatorTranslations, listPendingReviews } from "@/lib/review/client";
import { listTranslations } from "@/lib/translation/client";

// "My to-do" cards on /demo (CONTRACTS 23.4). Each card loads on its own: a failing card never affects the others or the page.
// A card is only mounted for the role the server confirmed, so other roles' requests are never sent.
function useCard<T>(loader: (signal: AbortSignal) => Promise<EpisodeResult<T>>) {
  const { handleUnauthorized } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const active = useRef<AbortController | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await loaderRef.current(request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setData(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailure(result.failure);
  }, [handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  return { data, loading, failure, retry: () => void load() };
}

function Card({ title, label, loading, failure, retry, message, children }: {
  title: string; label: string; loading: boolean; failure: EpisodeFailure | null; retry: () => void; message: (failure: EpisodeFailure) => string; children?: React.ReactNode;
}) {
  return <section aria-label={label} className="card card-body shadow-sm mb-3">
    <h3 className="h6">{title}</h3>
    {loading && <p role="status" className="text-secondary mb-0">불러오는 중…</p>}
    {failure && <div className="alert alert-warning mb-0" role="alert">
      <p className="mb-2">{message(failure)}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={retry}>다시 시도</button>
    </div>}
    {!loading && !failure && children}
  </section>;
}

const ChipView = ({ chip }: { chip: Chip }) => <span className={`badge text-bg-${chip.tone}`}>{chip.label}</span>;
type Row = { id: string; title: string; chip: Chip | null; href: string };

function RowList({ rows }: { rows: Row[] }) {
  return <ul className="list-group">
    {rows.map((row) => <li key={row.id} className="list-group-item d-flex justify-content-between align-items-center">
      <Link href={row.href}>{row.title}</Link>
      {row.chip ? <ChipView chip={row.chip} /> : <span className="text-secondary small">불러오지 못함</span>}
    </li>)}
  </ul>;
}

function OperatorCard() {
  const card = useCard<{ total: number; rows: Row[] }>(async (signal) => {
    const episodes = await listEpisodes(10, 0, signal);
    if (!episodes.ok) return episodes;
    let unauthorized: EpisodeResult<never> | null = null;
    const rows = await mapLimited(episodes.value.items, 5, async (episode): Promise<Row> => {
      const [translations, publication] = await Promise.all([listOperatorTranslations(episode.id, signal), getPublication(episode.id, signal)]);
      for (const result of [translations, publication]) if (!result.ok && result.failure.kind === "unauthorized") unauthorized = result;
      const chip = translations.ok ? operatorChip(translations.value.items, publication.ok ? publication.value : null) : null;
      return { id: episode.id, title: episode.title, chip, href: `/episodes/${encodeURIComponent(episode.id)}` };
    });
    if (unauthorized) return unauthorized;
    return { ok: true, value: { total: episodes.value.total, rows } };
  });
  return <Card title="회차 현황" label="회차 현황" {...card} message={episodeFailureMessage}>
    {card.data && <>
      <p className="small">회차 {card.data.total}개 · 최근 {card.data.rows.length}개의 진행 상태</p>
      {card.data.rows.length === 0 ? <p className="text-secondary empty-note mb-0">아직 회차가 없습니다.</p> : <RowList rows={card.data.rows} />}
    </>}
  </Card>;
}

function TranslatorCard() {
  const card = useCard<{ rows: Row[] }>(async (signal) => {
    const mine = await listMyEpisodes(10, 0, signal);
    if (!mine.ok) return mine;
    let unauthorized: EpisodeResult<never> | null = null;
    const rows = await mapLimited(mine.value.items, 5, async (episode): Promise<Row> => {
      const translations = await listTranslations(episode.id, signal);
      if (!translations.ok && translations.failure.kind === "unauthorized") unauthorized = translations;
      return { id: episode.id, title: episode.title, chip: translations.ok ? translatorChip(translations.value.items) : null, href: `/assigned/${encodeURIComponent(episode.id)}` };
    });
    if (unauthorized) return unauthorized;
    return { ok: true, value: { rows } };
  });
  const counts = translatorSummary((card.data?.rows ?? []).flatMap((row) => (row.chip ? [row.chip] : [])));
  return <Card title="내 번역" label="내 번역" {...card} message={episodeFailureMessage}>
    {card.data && <>
      <p className="small">반려 {counts.rejected}건 · 작성 중 {counts.drafting}건 · 시작 전 {counts.notStarted}건</p>
      {card.data.rows.length === 0 ? <p className="text-secondary empty-note mb-0">배정된 회차가 없습니다.</p> : <RowList rows={card.data.rows} />}
    </>}
  </Card>;
}

function ReviewerCard() {
  const card = useCard<{ total: number; items: { episodeId: string; title: string; versionNo: number }[] }>(async (signal) => {
    const pending = await listPendingReviews(5, 0, signal);
    return pending.ok ? { ok: true, value: { total: pending.value.total, items: pending.value.items } } : pending;
  });
  return <Card title="검수 대기" label="검수 대기" {...card} message={episodeFailureMessage}>
    {card.data && (card.data.total === 0
      ? <p className="mb-0">검수할 번역이 없습니다.</p>
      : <>
        <p className="small">검수 대기 {card.data.total}건</p>
        <ul className="list-group">
          {card.data.items.map((item) => <li key={`${item.episodeId}-${item.versionNo}`} className="list-group-item">
            <Link href={`/reviews/${encodeURIComponent(item.episodeId)}/${item.versionNo}`}>{item.title} · v{item.versionNo} 검토</Link>
          </li>)}
        </ul>
      </>)}
  </Card>;
}

function ReaderCard() {
  // the public list is ordered by episode id ascending: the latest five are at the end (a second request when there are more than five)
  const card = useCard<{ items: { episodeId: string; title: string }[] }>(async (signal) => {
    const first = await listPublicEpisodes(5, 0, signal);
    if (!first.ok) return first;
    if (first.value.total <= 5) return { ok: true, value: { items: [...first.value.items].reverse() } };
    const last = await listPublicEpisodes(5, first.value.total - 5, signal);
    return last.ok ? { ok: true, value: { items: [...last.value.items].reverse() } } : last;
  });
  return <Card title="최근 공개 회차" label="최근 공개 회차" {...card} message={publicFailureMessage}>
    {card.data && (card.data.items.length === 0
      ? <p className="text-secondary empty-note mb-0">아직 공개된 회차가 없습니다.</p>
      : <ul className="list-group">
        {card.data.items.map((item) => <li key={item.episodeId} className="list-group-item"><Link href={`/read/${encodeURIComponent(item.episodeId)}`}>{item.title}</Link></li>)}
      </ul>)}
  </Card>;
}

export function DashboardCards({ role }: { role: Role }) {
  return <section aria-label="내 할 일" className="mt-3">
    <h2 className="h5">내 할 일</h2>
    {role === "OPERATOR" && <OperatorCard />}
    {role === "TRANSLATOR" && <TranslatorCard />}
    {role === "REVIEWER" && <ReviewerCard />}
    {role === "READER" && <ReaderCard />}
  </section>;
}

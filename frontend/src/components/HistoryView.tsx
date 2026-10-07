"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { listHistory } from "@/lib/history/client";
import { describeEvent, EVENT_LABEL } from "@/lib/history/labels";
import { EPISODE_ID_PATTERN, HISTORY_EVENTS, type HistoryList } from "@/lib/history/types";

const PAGE_SIZE = 20;

// Operator-only, read-only work history (CONTRACTS 24.3). The page mounts it behind the operator gate; the server enforces the role.
export function HistoryView({ initialEpisodeId = "" }: { initialEpisodeId?: string }) {
  const { handleUnauthorized } = useAuth();
  const [event, setEvent] = useState("");
  const [episodeInput, setEpisodeInput] = useState(initialEpisodeId);
  const [episodeId, setEpisodeId] = useState(EPISODE_ID_PATTERN.test(initialEpisodeId) ? initialEpisodeId : "");
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<HistoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listHistory({ episodeId: episodeId || undefined, event: event || undefined, limit: PAGE_SIZE, offset }, request.signal);
    if (activeLoad.current !== request) return; // a newer request (filter or page change) wins
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailure(result.failure);
  }, [episodeId, event, offset, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  function applyEpisode() {
    const value = episodeInput.trim();
    if (value !== "" && !EPISODE_ID_PATTERN.test(value)) { setEpisodeError("회차 ID는 숫자여야 합니다."); return; }
    setEpisodeError(null);
    setEpisodeId(value);
    setOffset(0); // changing a filter returns to the first page
  }

  const total = list?.total ?? 0;
  return <section aria-label="작업 이력" className="card card-body shadow-sm">
    <div className="d-flex flex-wrap gap-3 align-items-end mb-3">
      <div>
        <label className="form-label small mb-1" htmlFor="history-event">작업 종류</label>
        <select id="history-event" className="form-select form-select-sm" value={event} onChange={(e) => { setEvent(e.target.value); setOffset(0); }}>
          <option value="">전체</option>
          {HISTORY_EVENTS.map((name) => <option key={name} value={name}>{EVENT_LABEL[name]}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label small mb-1" htmlFor="history-episode">회차 ID</label>
        <div className="input-group input-group-sm">
          <input id="history-episode" className="form-control" inputMode="numeric" value={episodeInput} placeholder="전체"
            aria-invalid={episodeError ? true : undefined}
            onChange={(e) => setEpisodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyEpisode(); }} />
          <button type="button" className="btn btn-outline-secondary" onClick={applyEpisode}>적용</button>
        </div>
        {episodeError && <p className="text-danger small mb-0" role="alert">{episodeError}</p>}
      </div>
      <button type="button" className="btn btn-outline-primary btn-sm" disabled={loading} onClick={() => void load()}>새로고침</button>
    </div>
    {loading && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>}
    {!loading && !failure && list && list.items.length === 0 && <p className="text-secondary">조건에 맞는 작업 이력이 없습니다.</p>}
    {list && list.items.length > 0 && <div className="table-responsive">
      <table className="table align-middle">
        <thead><tr><th>시각 (UTC)</th><th>작업</th><th>회차</th><th>수행자</th><th>대상</th></tr></thead>
        <tbody>
          {list.items.map((row) => <tr key={row.id}>
            <td><time>{row.occurredAt}</time></td>
            <td>{describeEvent(row)}</td>
            <td><Link href={`/episodes/${encodeURIComponent(row.episodeId)}`}>{row.episodeTitle}</Link></td>
            <td>{row.actor.displayName}</td>
            <td>{row.subject ? row.subject.displayName : "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getOperatorTranslation, listOperatorTranslations } from "@/lib/review/client";
import type { OperatorTranslationDetail, OperatorTranslationList } from "@/lib/review/types";
import { STATUS_LABEL } from "@/lib/translation/types";
import { DecisionBox, decisionLabel, SideBySide } from "./ReviewParts";

// Operator-only, read-only overview of every translation version of an episode (all states, drafts included).
export function TranslationOverviewPanel({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<OperatorTranslationList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [view, setView] = useState<OperatorTranslationDetail | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const activeLoad = useRef<AbortController | null>(null);
  const viewTicket = useRef(0);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listOperatorTranslations(episodeId, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailure(result.failure);
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  async function onView(versionNo: number) {
    const ticket = ++viewTicket.current;
    setViewError(null);
    const result = await getOperatorTranslation(episodeId, versionNo);
    if (ticket !== viewTicket.current) return; // a newer click wins
    if (result.ok) { setView(result.value); return; }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setView(null);
    setViewError(episodeFailureMessage(result.failure));
  }

  return <section aria-label="번역 현황" className="card card-body shadow-sm mb-3">
    <h2 className="h5">번역 현황</h2>
    <p className="text-secondary small">모든 번역 버전을 읽기 전용으로 확인합니다. 작성 중인 초안도 포함됩니다.</p>
    {loading && !list && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>}
    {list && list.items.length === 0 && <p className="text-secondary">아직 번역이 없습니다.</p>}
    {list && list.items.length > 0 && <table className="table align-middle">
      <thead><tr><th>버전</th><th>상태</th><th>기준 원문</th><th>제출 시각 (UTC)</th><th>결정</th><th /></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={item.versionNo}>
          <td>v{item.versionNo}</td>
          <td>{STATUS_LABEL[item.status]}</td>
          <td>{item.sourceVersion === list.latestSourceVersion ? `원문 v${item.sourceVersion} (최신)` : `원문 v${item.sourceVersion} (이전)`}</td>
          <td>{item.submittedAt ? <time>{item.submittedAt}</time> : "—"}</td>
          <td>{decisionLabel(item.decision)}</td>
          <td><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void onView(item.versionNo)}>번역 v{item.versionNo} 보기</button></td>
        </tr>)}
      </tbody>
    </table>}
    {viewError && <p className="alert alert-warning" role="alert">{viewError}</p>}
    {view && <div role="region" aria-label={`번역 v${view.versionNo} 내용`}>
      <h3 className="h6">번역 v{view.versionNo} · {STATUS_LABEL[view.status]} (읽기 전용)</h3>
      {view.invalidatedAt && <p className="text-secondary small">무효화 시각 (UTC): <time>{view.invalidatedAt}</time></p>}
      <DecisionBox decision={view.decision} />
      <SideBySide blocks={view.blocks} />
    </div>}
  </section>;
}

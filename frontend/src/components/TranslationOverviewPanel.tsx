"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getPublication, holdPublication, publishTranslation, resumePublication } from "@/lib/publication/client";
import { holdResumeFailureMessage, publicationFailureMessage } from "@/lib/publication/messages";
import type { Publication } from "@/lib/publication/types";
import { getOperatorTranslation, listOperatorTranslations } from "@/lib/review/client";
import type { OperatorTranslationDetail, OperatorTranslationList } from "@/lib/review/types";
import { STATUS_LABEL } from "@/lib/translation/types";
import { translationProgress } from "@/lib/translation/progress";
import { ProgressBar } from "./ProgressBar";
import { DecisionBox, decisionLabel, SideBySide } from "./ReviewParts";
import { VersionCompare } from "./VersionCompare";

type Notice = { tone: "success" | "warning" | "danger"; text: string };

// Operator-only overview of every translation version of an episode (all states, drafts included) with the publication state.
// Reading is read-only; the only action is publishing an approved version, which needs a confirmation.
export function TranslationOverviewPanel({ episodeId, refreshKey = 0 }: { episodeId: string; refreshKey?: number }) {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<OperatorTranslationList | null>(null);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [publicationFailure, setPublicationFailure] = useState<EpisodeFailure | null>(null);
  const [view, setView] = useState<OperatorTranslationDetail | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [confirmingState, setConfirmingState] = useState<"hold" | "resume" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const activeLoad = useRef<AbortController | null>(null);
  const viewTicket = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const [translations, published] = await Promise.all([
      listOperatorTranslations(episodeId, request.signal), getPublication(episodeId, request.signal),
    ]);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    const kinds = [translations, published].map((result) => (result.ok ? null : result.failure.kind));
    if (kinds.includes("aborted")) return;
    if (kinds.includes("unauthorized")) { handleUnauthorized(); return; }
    if (translations.ok) { setList(translations.value); setFailure(null); } else setFailure(translations.failure);
    if (published.ok) { setPublication(published.value); setPublicationFailure(null); } else setPublicationFailure(published.failure);
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    viewTicket.current++; // a source save changes every version's standing: drop any opened (now stale) detail
    setView(null);
    setViewError(null);
    setConfirming(null);
    setConfirmingState(null);
    void load();
    return () => activeLoad.current?.abort();
  }, [load, refreshKey]);

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

  async function onPublish(versionNo: number) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const result = await publishTranslation(episodeId, versionNo);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setConfirming(null);
      setNotice({ tone: "success", text: `번역 v${versionNo}을 발행했습니다. 독자에게 공개됩니다.` });
      await load();
      return;
    }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    const conflict = result.failure.kind === "state_conflict" || result.failure.kind === "not_found";
    setNotice({ tone: conflict ? "warning" : "danger", text: publicationFailureMessage(result.failure) });
    if (conflict) { setConfirming(null); await load(); }
  }

  async function onHoldResume(action: "hold" | "resume") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const result = action === "hold" ? await holdPublication(episodeId) : await resumePublication(episodeId);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setConfirmingState(null);
      setNotice({ tone: "success", text: action === "hold" ? "공개를 보류했습니다. 독자에게 더 이상 보이지 않습니다." : "공개를 재개했습니다. 독자에게 다시 공개됩니다." });
      await load();
      return;
    }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    const conflict = result.failure.kind === "state_conflict" || result.failure.kind === "not_found";
    setNotice({ tone: conflict ? "warning" : "danger", text: holdResumeFailureMessage(result.failure, action) });
    if (conflict) { setConfirmingState(null); await load(); }
  }

  const current = publication?.current ?? null;
  const held = publication?.held ?? null;
  return <section aria-label="번역 현황" className="card card-body shadow-sm mb-3">
    <h2 className="h5">번역 현황</h2>
    <p className="text-secondary small">모든 번역 버전을 확인합니다. 작성 중인 초안도 포함됩니다. 승인된 번역만 발행할 수 있습니다.</p>
    {loading && !list && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>}
    {notice && <p className={`alert alert-${notice.tone}`} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p>}
    <div role="region" aria-label="공개 상태" className="mb-3">
      <h3 className="h6">공개 상태</h3>
      {publicationFailure && <p className="text-danger small" role="alert">{publicationFailureMessage(publicationFailure)}</p>}
      {publication && (current
        ? <p className="mb-1">현재 공개 중: <strong>번역 v{current.versionNo}</strong> (기준 원문 v{current.sourceVersion}) · 발행 <time>{current.publishedAt}</time></p>
        : held ? <p className="mb-1">보류 중: <strong>번역 v{held.versionNo}</strong> (독자에게 보이지 않음) · 마지막 발행 <time>{held.publishedAt}</time></p>
          : <p className="mb-1 text-secondary">공개 중인 번역 없음</p>)}
      {publication && (current || held) && (confirmingState === null
        ? <button type="button" className={`btn btn-sm ${current ? "btn-outline-warning" : "btn-outline-success"} mb-1`} disabled={busy}
          onClick={() => { setNotice(null); setConfirmingState(current ? "hold" : "resume"); }}>{current ? "공개 보류" : "공개 재개"}</button>
        : <div className="d-flex gap-2 align-items-center flex-wrap mb-1">
          <span>{confirmingState === "hold" ? "보류하면 독자에게 더 이상 보이지 않습니다. 나중에 공개를 재개할 수 있습니다." : "재개하면 다시 독자에게 공개됩니다."}</span>
          <button type="button" className="btn btn-sm btn-warning" disabled={busy} onClick={() => void onHoldResume(confirmingState)}>
            {busy ? "처리 중…" : confirmingState === "hold" ? "보류 확정" : "재개 확정"}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => setConfirmingState(null)}>취소</button>
        </div>)}
      {publication && publication.history.length > 0 && <details>
        <summary className="small">발행 이력 {publication.history.length}건</summary>
        <ul className="small mb-0">
          {publication.history.map((entry) => <li key={`${entry.versionNo}-${entry.publishedAt}`}>번역 v{entry.versionNo} (기준 원문 v{entry.sourceVersion}) · <time>{entry.publishedAt}</time></li>)}
        </ul>
      </details>}
    </div>
    {list && list.items.length === 0 && <p className="text-secondary">아직 번역이 없습니다.</p>}
    {list && list.items.length > 0 && <table className="table align-middle">
      <thead><tr><th>버전</th><th>상태</th><th>기준 원문</th><th>제출 시각 (UTC)</th><th>결정</th><th /></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={item.versionNo}>
          <td>v{item.versionNo}{current?.versionNo === item.versionNo && <span className="badge text-bg-success ms-2">공개 중</span>}{held?.versionNo === item.versionNo && <span className="badge text-bg-warning ms-2">보류 중</span>}</td>
          <td>{STATUS_LABEL[item.status]}</td>
          <td>{item.sourceVersion === list.latestSourceVersion ? `원문 v${item.sourceVersion} (최신)` : `원문 v${item.sourceVersion} (이전)`}</td>
          <td>{item.submittedAt ? <time>{item.submittedAt}</time> : "—"}</td>
          <td>{decisionLabel(item.decision)}</td>
          <td>
            <div className="d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void onView(item.versionNo)}>번역 v{item.versionNo} 보기</button>
              {item.status === "APPROVED" && confirming !== item.versionNo && <button type="button" className="btn btn-success btn-sm" disabled={busy}
                onClick={() => { setNotice(null); setConfirming(item.versionNo); }}>v{item.versionNo} 발행</button>}
            </div>
            {item.status === "APPROVED" && confirming === item.versionNo && <div className="mt-2 d-flex gap-2 align-items-center flex-wrap">
              <span>{current
                ? `발행하면 독자에게 공개됩니다. 현재 공개 중인 v${current.versionNo}을 대체합니다. 발행할까요?`
                : held ? `발행하면 독자에게 공개됩니다. 보류 중인 v${held.versionNo} 대신 공개됩니다. 발행할까요?`
                : "발행하면 독자에게 공개됩니다. 발행할까요?"}</span>
              <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => void onPublish(item.versionNo)}>{busy ? "처리 중…" : "발행 확정"}</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setConfirming(null)}>취소</button>
            </div>}
          </td>
        </tr>)}
      </tbody>
    </table>}
    {list && list.items.length >= 2 && <VersionCompare key={refreshKey} versions={list.items} load={(versionNo, signal) => getOperatorTranslation(episodeId, versionNo, signal)} />}
    {viewError && <p className="alert alert-warning" role="alert">{viewError}</p>}
    {view && <div role="region" aria-label={`번역 v${view.versionNo} 내용`}>
      <h3 className="h6">번역 v{view.versionNo} · {STATUS_LABEL[view.status]} (읽기 전용)</h3>
      {view.invalidatedAt && <p className="text-secondary small">무효화 시각 (UTC): <time>{view.invalidatedAt}</time></p>}
      <DecisionBox decision={view.decision} />
      <ProgressBar progress={translationProgress(view.blocks)} />
      <SideBySide blocks={view.blocks} comments={view.blockComments} />
    </div>}
  </section>;
}

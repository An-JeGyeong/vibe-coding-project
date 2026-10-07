"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { approveReview, getReview, listEpisodeReviews, listPendingReviews, rejectReview } from "@/lib/review/client";
import { reviewFailureMessage } from "@/lib/review/messages";
import type { PendingReviewList, ReviewDetail, ReviewVersionList } from "@/lib/review/types";
import { COMMENT_MAX, COMMENTS_MAX, REASON_MAX, validateComment, validateReason } from "@/lib/review/validation";
import { STATUS_LABEL } from "@/lib/translation/types";
import { translationProgress } from "@/lib/translation/progress";
import { ProgressBar } from "./ProgressBar";
import { DecisionBox, decisionLabel, SideBySide } from "./ReviewParts";
import { VersionCompare } from "./VersionCompare";

const PAGE_SIZE = 20;

// Reviewer-only screens (the pages mount them for a server-confirmed REVIEWER; the server enforces the role).
export function ReviewListView() {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<PendingReviewList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listPendingReviews(PAGE_SIZE, nextOffset, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setOffset(nextOffset); setError(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setError(reviewFailureMessage(result.failure));
  }, [handleUnauthorized]);

  useEffect(() => {
    void load(0);
    return () => activeLoad.current?.abort();
  }, [load]);

  const total = list?.total ?? 0;
  return <section aria-label="검수 대기 목록" className="card card-body shadow-sm">
    <h2 className="h5">검수 대기 번역</h2>
    {loading && <p role="status">불러오는 중…</p>}
    {error && <div className="alert alert-warning" role="alert">
      <p>{error}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
    </div>}
    {!loading && !error && list && list.items.length === 0 && <p className="text-secondary">검수를 기다리는 번역이 없습니다.</p>}
    {list && list.items.length > 0 && <div className="table-responsive"><table className="table align-middle">
      <thead><tr><th>회차</th><th>번역 버전</th><th>기준 원문</th><th>제출 시각 (UTC)</th></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={`${item.episodeId}-${item.versionNo}`}>
          <td>{item.title}</td>
          <td><Link href={`/reviews/${encodeURIComponent(item.episodeId)}/${item.versionNo}`}>v{item.versionNo} 검토</Link></td>
          <td>원문 v{item.sourceVersion}</td>
          <td><time>{item.submittedAt}</time></td>
        </tr>)}
      </tbody>
    </table></div>}
    {list && total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0}
        onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total}
        onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

type Notice = { tone: "success" | "info" | "danger" | "warning"; text: string };
type Mode = "idle" | "approve" | "reject";

export function ReviewDetailView({ episodeId, versionNo }: { episodeId: string; versionNo: number }) {
  const { handleUnauthorized } = useAuth();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<number, string>>({});
  const [commentsNotice, setCommentsNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busyRef = useRef(false);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await getReview(episodeId, versionNo, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setDetail(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setDetail(null); // never keep showing a translation the server no longer lets this reviewer see
    setFailure(result.failure);
  }, [episodeId, versionNo, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  async function decide(kind: "approve" | "reject") {
    if (busyRef.current || !detail) return;
    let drafted: { seq: number; text: string }[] = [];
    if (kind === "reject") {
      const error = validateReason(reason);
      setReasonError(error);
      const found: Record<number, string> = {};
      for (const block of detail.blocks) {
        const problem = validateComment(comments[block.seq] ?? "");
        if (problem) found[block.seq] = problem;
        else if ((comments[block.seq] ?? "") !== "") drafted.push({ seq: block.seq, text: comments[block.seq] });
      }
      setCommentErrors(found);
      const tooMany = drafted.length > COMMENTS_MAX;
      setCommentsNotice(tooMany ? `의견은 최대 ${COMMENTS_MAX}개까지 남길 수 있습니다.` : null);
      if (error || Object.keys(found).length > 0 || tooMany) return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const result = kind === "approve" ? await approveReview(episodeId, versionNo) : await rejectReview(episodeId, versionNo, reason, drafted);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setMode("idle");
      setReason("");
      setComments({});
      setCommentErrors({});
      setCommentsNotice(null);
      setNotice({ tone: "success", text: kind === "approve" ? "번역을 승인했습니다." : "번역을 반려했습니다. 번역가가 사유를 보고 새 번역을 작성합니다." });
      await load();
      return;
    }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    if (result.failure.kind === "not_found") {
      // the assignment or the version is gone: stop showing the translation and its decision buttons right away
      setMode("idle");
      setNotice(null);
      setDetail(null);
      setFailure(result.failure);
      return;
    }
    setNotice({ tone: result.failure.kind === "state_conflict" ? "warning" : "danger", text: reviewFailureMessage(result.failure) });
    if (result.failure.kind === "state_conflict") { setMode("idle"); await load(); }
  }

  if (loading && !detail) return <p role="status">불러오는 중…</p>;
  if (failure && !detail) {
    return <div className="alert alert-warning" role="alert">
      {notice && <p><strong>{notice.text}</strong></p>}
      <p>{reviewFailureMessage(failure)}</p>
      {failure.kind === "not_found"
        ? <Link href="/reviews" className="btn btn-outline-secondary">검수 대기 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!detail) return null;

  return <>
    <p><Link href="/reviews">← 검수 대기 목록</Link></p>
    <h1 className="h2 mb-1">번역 v{detail.versionNo} 검토</h1>
    <p className="text-secondary">상태: {STATUS_LABEL[detail.status]} · 기준 원문 v{detail.sourceVersion}{detail.submittedAt && <> · 제출 <time>{detail.submittedAt}</time></>}</p>
    <DecisionBox decision={detail.decision} />
    <ProgressBar progress={translationProgress(detail.blocks)} />
    {notice && <p className={`alert alert-${notice.tone}`} role={notice.tone === "danger" || notice.tone === "warning" ? "alert" : "status"}>{notice.text}</p>}
    <section aria-label="원문과 번역 (읽기 전용)" className="card card-body shadow-sm mb-3">
      <h2 className="h5">원문과 번역 (읽기 전용)</h2>
      <SideBySide blocks={detail.blocks} comments={detail.blockComments}
        editor={mode === "reject" ? { values: comments, errors: commentErrors, max: COMMENT_MAX, onChange: (seq, text) => { setComments((previous) => ({ ...previous, [seq]: text })); setCommentErrors((previous) => { const next = { ...previous }; delete next[seq]; return next; }); } } : undefined} />
    </section>
    {detail.decidable && <section aria-label="검수 결정" className="card card-body shadow-sm">
      <h2 className="h5">검수 결정</h2>
      <p className="text-secondary small">승인과 반려는 되돌릴 수 없습니다. 원문과 번역을 모두 확인한 뒤 결정하세요.</p>
      {mode === "idle" && <div className="d-flex gap-2">
        <button type="button" className="btn btn-success" disabled={busy} onClick={() => setMode("approve")}>승인</button>
        <button type="button" className="btn btn-outline-danger" disabled={busy} onClick={() => setMode("reject")}>반려</button>
      </div>}
      {mode === "approve" && <div className="d-flex gap-2 align-items-center flex-wrap">
        <span>승인하면 되돌릴 수 없습니다. 승인할까요?</span>
        <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => void decide("approve")}>{busy ? "처리 중…" : "승인 확정"}</button>
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setMode("idle")}>취소</button>
      </div>}
      {mode === "reject" && <div>
        <label className="form-label w-100" htmlFor="reject-reason">반려 사유 (필수, {REASON_MAX}자 이하)
          <textarea id="reject-reason" className="form-control mt-1" rows={4} value={reason} aria-invalid={reasonError ? true : undefined}
            onChange={(event) => { setReason(event.target.value); setReasonError(null); }} />
        </label>
        {reasonError && <p className="text-danger small mt-1" role="alert">{reasonError}</p>}
        {commentsNotice && <p className="text-danger small" role="alert">{commentsNotice}</p>}
        <p className="text-secondary small">반려하면 번역가가 이 사유{Object.values(comments).some((text) => text !== "") ? `와 블록별 의견 ${Object.values(comments).filter((text) => text !== "").length}개` : ""}를 보고 새 번역을 작성해야 합니다. 위 각 블록에 의견을 남길 수 있습니다.</p>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void decide("reject")}>{busy ? "처리 중…" : "반려 확정"}</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => { setMode("idle"); setReasonError(null); }}>취소</button>
        </div>
      </div>}
    </section>}
  </>;
}

/** The reviewer's list of reviewable versions on /assigned/{id}; links go to the review page. */
export function ReviewVersionsPanel({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<ReviewVersionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listEpisodeReviews(episodeId, request.signal);
    if (activeLoad.current !== request) return;
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setError(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setError(reviewFailureMessage(result.failure));
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  return <>
  <section aria-label="검수 버전" className="card card-body shadow-sm mb-3">
    <h2 className="h5">검수 버전</h2>
    {loading && !list && <p role="status">불러오는 중…</p>}
    {error && <div className="alert alert-warning" role="alert">
      <p>{error}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>}
    {list && list.items.length === 0 && <p className="text-secondary">검수할 번역이 아직 없습니다. 번역가가 제출하면 여기에 표시됩니다.</p>}
    {list && list.items.length > 0 && <div className="table-responsive"><table className="table align-middle">
      <thead><tr><th>버전</th><th>상태</th><th>기준 원문</th><th>제출 시각 (UTC)</th><th>결정</th><th /></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={item.versionNo}>
          <td>v{item.versionNo}</td>
          <td>{STATUS_LABEL[item.status]}</td>
          <td>{item.sourceVersion === list.latestSourceVersion ? `원문 v${item.sourceVersion} (최신)` : `원문 v${item.sourceVersion} (이전)`}</td>
          <td>{item.submittedAt ? <time>{item.submittedAt}</time> : "—"}</td>
          <td>{decisionLabel(item.decision)}</td>
          <td><Link href={`/reviews/${encodeURIComponent(episodeId)}/${item.versionNo}`}>v{item.versionNo} 검토</Link></td>
        </tr>)}
      </tbody>
    </table></div>}
  </section>
  {list && list.items.length >= 2 && <VersionCompare versions={list.items} load={(versionNo, signal) => getReview(episodeId, versionNo, signal)} />}
  </>;
}

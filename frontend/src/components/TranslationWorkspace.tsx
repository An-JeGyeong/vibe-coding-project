"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { createTranslation, getTranslation, listTranslations, requestAiDraft, saveTranslation, submitTranslation } from "@/lib/translation/client";
import { STATUS_LABEL, type TranslationDetail, type TranslationList } from "@/lib/translation/types";
import { validateTranslationText } from "@/lib/translation/validation";
import { translationProgress } from "@/lib/translation/progress";
import { PageImageSlot, usePageImages } from "./PageImage";
import { PagedBlocks } from "./PagedBlocks";
import { ProgressBar } from "./ProgressBar";
import { DecisionBox, decisionLabel, decisionSummary } from "./ReviewParts";
import { VersionCompare } from "./VersionCompare";

type Notice = { tone: "success" | "info" | "danger" | "warning"; text: string };
type Busy = "save" | "submit" | "create" | "ai" | null;
const isOpen = (status: string) => status === "DRAFT" || status === "REVIEW_PENDING";

// Translator-only workspace (mounted by the page for a server-confirmed TRANSLATOR; the server enforces the role).
// Drafts live in memory only — never in localStorage — until they are saved to the server.
export function TranslationWorkspace({ episodeId, onLatestSourceVersion }: { episodeId: string; onLatestSourceVersion?: (version: number) => void }) {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<TranslationList | null>(null);
  const [detail, setDetail] = useState<TranslationDetail | null>(null);
  const [previous, setPrevious] = useState<TranslationDetail | null>(null); // the latest rejected version while a new draft is edited
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [missing, setMissing] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<EpisodeFailure | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiFailed, setAiFailed] = useState(false);
  const [aiMarks, setAiMarks] = useState<Set<number>>(new Set()); // blocks currently holding an unedited AI proposal
  const aiTicket = useRef(0);
  const textsRef = useRef<Record<number, string>>({});
  const busyRef = useRef(false);
  const selectedRef = useRef<number | null>(null);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async (prefer?: number) => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const finish = (failure: EpisodeFailure) => {
      if (failure.kind === "aborted") return;
      if (failure.kind === "unauthorized") { handleUnauthorized(); return; }
      setLoadFailure(failure);
    };
    const listed = await listTranslations(episodeId, request.signal);
    if (activeLoad.current !== request) return; // superseded or unmounted
    if (!listed.ok) { activeLoad.current = null; setLoading(false); finish(listed.failure); return; }
    onLatestSourceVersion?.(listed.value.latestSourceVersion); // keep the page header in step with what the server just said
    const items = listed.value.items;
    const wanted = prefer ?? selectedRef.current;
    const chosen = items.find((item) => item.versionNo === wanted) ?? items.find((item) => isOpen(item.status)) ?? items[0] ?? null;
    if (!chosen) {
      activeLoad.current = null;
      setLoading(false); setLoadFailure(null); setList(listed.value);
      selectedRef.current = null; setDetail(null); setPrevious(null); setTexts({}); setErrors({}); setMissing([]); setNeedsReload(false);
      return;
    }
    const fetched = await getTranslation(episodeId, chosen.versionNo, request.signal);
    if (activeLoad.current !== request) return;
    // While a new draft is edited, the reviewer's remarks on the latest rejected version stay readable (CONTRACTS 22.4). Best effort.
    let rejected: TranslationDetail | null = null;
    const lastRejected = items.filter((item) => item.status === "REJECTED" && item.versionNo !== chosen.versionNo).sort((a, b) => b.versionNo - a.versionNo)[0];
    if (fetched.ok && fetched.value.editable && lastRejected) {
      const earlier = await getTranslation(episodeId, lastRejected.versionNo, request.signal);
      if (activeLoad.current !== request) return;
      if (earlier.ok && earlier.value.blockComments.length > 0) rejected = earlier.value;
    }
    activeLoad.current = null;
    setLoading(false);
    if (!fetched.ok) { finish(fetched.failure); return; }
    selectedRef.current = chosen.versionNo;
    setLoadFailure(null); setList(listed.value); setDetail(fetched.value); setPrevious(rejected);
    setTexts(Object.fromEntries(fetched.value.blocks.map((block) => [block.seq, block.text ?? ""])));
    setErrors({}); setMissing([]); setNeedsReload(false); setConfirming(false);
    setAiConfirm(false); setAiFailed(false); setAiMarks(new Set()); aiTicket.current++; // marks and a pending AI answer belong to the loaded text
  }, [episodeId, handleUnauthorized, onLatestSourceVersion]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  textsRef.current = texts;
  const images = usePageImages("mine", episodeId, !!detail && detail.blocks.some((block) => block.pageNo !== null));
  const dirty = !!detail && detail.editable && detail.blocks.some((block) => (texts[block.seq] ?? "") !== (block.text ?? ""));

  // Shared outcome handling for a failed action (401 signs out, conflicts offer a reload, anything else is a fixed message).
  function handleFailure(failure: EpisodeFailure) {
    if (failure.kind === "unauthorized") { handleUnauthorized(); return; }
    if (failure.kind === "revision_conflict" || failure.kind === "state_conflict") setNeedsReload(true);
    if (failure.kind === "incomplete") setMissing(failure.missingSeqs);
    setNotice({ tone: failure.kind === "revision_conflict" || failure.kind === "state_conflict" ? "warning" : "danger", text: episodeFailureMessage(failure) });
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setNotice(null);
    try { await action(); } finally { busyRef.current = false; setBusy(null); }
  }

  const onSave = () => run("save", async () => {
    if (!detail || !detail.editable) return;
    const found: Record<number, string> = {};
    const draft: { seq: number; text: string }[] = [];
    for (const block of detail.blocks) {
      const text = texts[block.seq] ?? "";
      const error = validateTranslationText(text);
      if (error) found[block.seq] = error;
      else if (text !== "") draft.push({ seq: block.seq, text });
    }
    setErrors(found);
    if (Object.keys(found).length > 0) { setNotice({ tone: "danger", text: "입력 내용을 확인하세요." }); return; }
    const result = await saveTranslation(episodeId, detail.versionNo, detail.revision, draft);
    if (!result.ok) { handleFailure(result.failure); return; }
    setNotice(result.value.changed ? { tone: "success", text: "번역을 저장했습니다." } : { tone: "info", text: "변경 사항이 없어 저장하지 않았습니다." });
    await load(detail.versionNo);
  });

  const onSubmit = () => run("submit", async () => {
    if (!detail || !detail.editable) return;
    setConfirming(false);
    const absent = detail.blocks.filter((block) => (block.text ?? "").trim() === "").map((block) => block.seq);
    if (absent.length > 0) {
      setMissing(absent);
      setNotice({ tone: "danger", text: episodeFailureMessage({ kind: "incomplete", missingSeqs: absent }) });
      return;
    }
    const result = await submitTranslation(episodeId, detail.versionNo, detail.revision);
    if (!result.ok) { handleFailure(result.failure); return; }
    setNotice({ tone: "success", text: "검수에 제출했습니다. 제출한 번역은 수정할 수 없습니다." });
    await load(detail.versionNo);
  });

  // AI proposals only ever fill blocks that are still empty in the editor (CONTRACTS 25.4); nothing is saved or submitted.
  const onAiDraft = () => run("ai", async () => {
    if (!detail || !detail.editable) return;
    const versionNo = detail.versionNo;
    const ticket = ++aiTicket.current;
    setAiConfirm(false);
    setAiFailed(false);
    const result = await requestAiDraft(episodeId, versionNo);
    if (ticket !== aiTicket.current || selectedRef.current !== versionNo) return; // another version or a reload happened meanwhile
    if (!result.ok) {
      if (result.failure.kind === "ai_unavailable") setAiFailed(true);
      handleFailure(result.failure);
      return;
    }
    const known = new Set(detail.blocks.map((block) => block.seq));
    const fill = result.value.suggestions.filter((item) => known.has(item.seq) && (textsRef.current[item.seq] ?? "") === ""); // typed meanwhile -> dropped
    if (fill.length === 0) { setNotice({ tone: "info", text: "채울 블록이 없거나 제안을 받지 못했습니다." }); return; }
    setTexts((previous) => {
      const next = { ...previous };
      for (const item of fill) if ((previous[item.seq] ?? "") === "") next[item.seq] = item.text;
      return next;
    });
    setAiMarks((previous) => new Set([...previous, ...fill.map((item) => item.seq)]));
    setNotice({ tone: "success", text: `AI 초안 ${fill.length}개를 채웠습니다. 검토하고 수정한 뒤 저장해야 반영됩니다.` });
  });

  const onCreate = () => run("create", async () => {
    const result = await createTranslation(episodeId);
    if (!result.ok) {
      handleFailure(result.failure);
      if (result.failure.kind === "state_conflict") await load();
      return;
    }
    setNotice({ tone: "success", text: `새 번역(버전 ${result.value.versionNo})을 시작했습니다.` });
    await load(result.value.versionNo);
  });

  if (loading && !list) return <p role="status">번역을 불러오는 중…</p>;
  if (loadFailure && !list) {
    return <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(loadFailure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>;
  }
  if (!list) return null;

  const hasOpen = list.items.some((item) => isOpen(item.status));
  return <>
    <section aria-label="번역 버전" className="card card-body shadow-sm mb-3">
      <h2 className="h5">번역 버전</h2>
      {loadFailure && <div className="alert alert-warning" role="alert">
        <p>{episodeFailureMessage(loadFailure)}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
      </div>}
      {list.items.length === 0
        ? <p className="text-secondary">아직 번역이 없습니다. 새 번역을 시작하면 최신 원문(v{list.latestSourceVersion}) 기준으로 작성할 수 있습니다.</p>
        : <div className="table-responsive"><table className="table align-middle">
          <thead><tr><th>버전</th><th>상태</th><th>기준 원문</th><th>제출 시각 (UTC)</th><th>결정</th><th /></tr></thead>
          <tbody>
            {list.items.map((item) => <tr key={item.versionNo}>
              <td>v{item.versionNo}</td>
              <td>{STATUS_LABEL[item.status]}</td>
              <td>{item.sourceVersion === list.latestSourceVersion ? `원문 v${item.sourceVersion} (최신)` : `원문 v${item.sourceVersion} (이전)`}</td>
              <td>{item.submittedAt ? <time>{item.submittedAt}</time> : "—"}</td>
              <td>{decisionLabel(item.decision)}{decisionSummary(item.decision) && <div className="small text-secondary">{decisionSummary(item.decision)}</div>}</td>
              <td><button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading || dirty || detail?.versionNo === item.versionNo}
                onClick={() => void load(item.versionNo)}>v{item.versionNo} 보기</button></td>
            </tr>)}
          </tbody>
        </table></div>}
      {dirty && <p className="text-secondary small">저장하지 않은 변경이 있어 다른 버전으로 이동할 수 없습니다.</p>}
      {!hasOpen && <button type="button" className="btn btn-primary" disabled={busy !== null || loading} onClick={() => void onCreate()}>
        {busy === "create" ? "시작하는 중…" : "새 번역 시작"}
      </button>}
    </section>

    {list.items.length >= 2 && <VersionCompare versions={list.items} load={(versionNo, signal) => getTranslation(episodeId, versionNo, signal)} />}

    {notice && <p className={`alert alert-${notice.tone}`} role={notice.tone === "danger" || notice.tone === "warning" ? "alert" : "status"}>{notice.text}</p>}
    {needsReload && <div className="mb-3">
      <button type="button" className="btn btn-warning" disabled={loading} onClick={() => void load(detail?.versionNo)}>최신 내용 불러오기 (작성 중인 내용은 사라집니다)</button>
    </div>}

    {detail && previous && <section aria-label="직전 반려 의견" className="card card-body shadow-sm mb-3">
      <h2 className="h5">직전 반려 의견 (v{previous.versionNo})</h2>
      <p className="text-secondary small">감수자가 블록별로 남긴 의견입니다. 읽기 전용이며, 새 번역을 고칠 때 참고하세요.</p>
      <ul className="list-unstyled mb-0">
        {previous.blockComments.map((comment) => <li key={comment.seq} className="border rounded p-2 mb-2">
          <span className="badge text-bg-secondary me-2">블록 {comment.seq}</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{comment.text}</span>
        </li>)}
      </ul>
    </section>}

    {detail && <section aria-label="원문과 번역" className="card card-body shadow-sm">
      <h2 className="h5">v{detail.versionNo} · {STATUS_LABEL[detail.status]}</h2>
      <DecisionBox decision={detail.decision} />
      <ProgressBar progress={translationProgress(detail.blocks, detail.editable ? texts : undefined)} unsaved={detail.editable && dirty} />
      <p className="text-secondary small">
        {detail.editable ? "왼쪽 원문을 보고 오른쪽에 번역을 입력합니다. 저장한 뒤에 제출할 수 있으며, 제출하면 수정할 수 없습니다."
          : detail.status === "INVALIDATED" ? "원문이 바뀌어 무효화된 번역입니다. 읽기 전용이며, 새 번역을 시작할 수 있습니다."
          : "읽기 전용입니다."}
      </p>
      <PagedBlocks blocks={detail.blocks} resetKey={detail.versionNo} imageSlot={(pageNo) => <PageImageSlot scope="mine" episodeId={episodeId} pageNo={pageNo} images={images} />} note={(group) => {
        const done = translationProgress(group, detail.editable ? texts : undefined);
        const gap = missing.some((seq) => group.some((block) => block.seq === seq));
        return `번역 ${done.done}/${done.total} 블록${gap ? " · 번역이 필요한 블록 있음" : ""}`;
      }} renderPage={(pageBlocks) => <ol className="list-unstyled">
        {pageBlocks.map((block) => {
          const absent = missing.includes(block.seq);
          const value = texts[block.seq] ?? "";
          return <li key={block.seq} className={`border rounded p-2 mb-2 ${absent ? "border-danger" : ""}`}>
            <div className="row g-2">
              <div className="col-md-6" style={{ whiteSpace: "pre-wrap" }}>
                {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.source}
              </div>
              <div className="col-md-6">
                {detail.editable
                  ? <>
                    <label className="form-label small mb-1" htmlFor={`tr-${block.seq}`}>블록 {block.seq} 번역</label>
                    {aiMarks.has(block.seq) && <span className="badge text-bg-info ms-2" title="AI가 제안한 초안입니다. 직접 검토하세요.">AI 초안</span>}
                    <textarea id={`tr-${block.seq}`} className="form-control" rows={3} value={value}
                      aria-invalid={errors[block.seq] || absent ? true : undefined}
                      onChange={(event) => {
                        const next = event.target.value;
                        setTexts((previous) => ({ ...previous, [block.seq]: next }));
                        setAiMarks((previous) => { if (!previous.has(block.seq)) return previous; const marks = new Set(previous); marks.delete(block.seq); return marks; });
                        setMissing((previous) => previous.filter((seq) => seq !== block.seq));
                      }} />
                    {errors[block.seq] && <p className="text-danger small mt-1 mb-0" role="alert">{errors[block.seq]}</p>}
                  </>
                  : <div style={{ whiteSpace: "pre-wrap" }}>{block.text ?? <span className="text-secondary">(번역 없음)</span>}</div>}
                {detail.blockComments.filter((comment) => comment.seq === block.seq).map((comment) =>
                  <div key={comment.seq} className="alert alert-warning py-1 px-2 mt-2 mb-0 small" style={{ whiteSpace: "pre-wrap" }}>감수 의견: {comment.text}</div>)}
                {absent && <p className="text-danger small mt-1 mb-0">번역이 필요합니다.</p>}
              </div>
            </div>
          </li>;
        })}
      </ol>} />
      {detail.editable && <div className="d-flex gap-2 flex-wrap align-items-center">
        <button type="button" className="btn btn-primary" disabled={busy !== null || !dirty} onClick={() => void onSave()}>{busy === "save" ? "저장 중…" : "저장"}</button>
        {!confirming
          ? <button type="button" className="btn btn-outline-primary" disabled={busy !== null || dirty} onClick={() => setConfirming(true)}>검수에 제출</button>
          : <span className="d-flex gap-2 align-items-center">
            <span className="small">제출하면 수정할 수 없습니다. 제출할까요?</span>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void onSubmit()}>{busy === "submit" ? "제출 중…" : "제출 확정"}</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy !== null} onClick={() => setConfirming(false)}>취소</button>
          </span>}
        {dirty && <span className="text-secondary small">저장한 뒤에 제출할 수 있습니다.</span>}
        {!aiConfirm && <button type="button" className="btn btn-outline-secondary" disabled={busy !== null || confirming || loading} onClick={() => { setNotice(null); setAiConfirm(true); }}>
          {busy === "ai" ? "AI 초안을 만드는 중…" : aiFailed ? "AI 초안 다시 시도" : "AI 초안 불러오기"}</button>}
      </div>}
      {detail.editable && aiConfirm && <div className="alert alert-secondary mt-2 mb-0" role="group" aria-label="AI 초안 확인">
        <p className="mb-2">원문이 외부 AI 서비스로 전송됩니다(데모 데이터만 사용하세요). 번역이 비어 있는 블록에만 제안이 채워지며, 직접 검토·수정하고 저장해야 반영됩니다.</p>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void onAiDraft()}>AI 초안 요청</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy !== null} onClick={() => setAiConfirm(false)}>취소</button>
        </div>
      </div>}
    </section>}
  </>;
}

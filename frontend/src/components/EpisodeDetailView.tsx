"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssignmentPanel } from "@/components/AssignmentPanel";
import { PageImagesPanel } from "@/components/PageImagesPanel";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getEpisode, getVersion, listVersions, saveSource } from "@/lib/episodes/client";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeDetail, EpisodeFailure, SourceBlock, SourceView, VersionSummary } from "@/lib/episodes/types";
import { BLOCKS_MAX, parsePageNo, validateBlockText } from "@/lib/episodes/validation";

// Drafts live in memory only (never localStorage); the page number stays a string while it is being typed.
type EditorBlock = { key: number; pageNo: string; text: string };
type BlockErrors = Record<number, { pageNo?: string; text?: string }>;
type Notice = { tone: "success" | "info" | "danger" | "warning"; text: string };

export function EpisodeDetailView({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<EpisodeFailure | null>(null);
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [errors, setErrors] = useState<BlockErrors>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState<number | null | false>(false);
  const [viewing, setViewing] = useState<SourceView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [sourceSaves, setSourceSaves] = useState(0);
  const keyCounter = useRef(1);
  const savingRef = useRef(false);
  const activeLoad = useRef<AbortController | null>(null);
  const activeView = useRef<number>(0);

  const toEditor = useCallback((source: SourceBlock[] | undefined): EditorBlock[] => {
    const rows = source && source.length > 0 ? source : [{ seq: 1, pageNo: null, text: "" }];
    return rows.map((row) => ({ key: keyCounter.current++, pageNo: row.pageNo === null ? "" : String(row.pageNo), text: row.text }));
  }, []);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const [episode, history] = await Promise.all([getEpisode(episodeId, request.signal), listVersions(episodeId, request.signal)]);
    if (activeLoad.current !== request) return; // superseded or unmounted
    activeLoad.current = null;
    setLoading(false);
    const failed = !episode.ok ? episode.failure : !history.ok ? history.failure : null;
    if (failed) {
      if (failed.kind === "aborted") return;
      if (failed.kind === "unauthorized") { handleUnauthorized(); return; }
      setLoadFailure(failed);
      return;
    }
    if (!episode.ok || !history.ok) return;
    setLoadFailure(null);
    setDetail(episode.value);
    setVersions(history.value);
    setBlocks(toEditor(episode.value.source?.blocks));
    setErrors({});
    setConflict(false);
  }, [episodeId, handleUnauthorized, toEditor]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  function update(key: number, patch: Partial<EditorBlock>) {
    setBlocks((current) => current.map((block) => (block.key === key ? { ...block, ...patch } : block)));
  }
  function move(index: number, delta: number) {
    setBlocks((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function onSave() {
    if (savingRef.current || !detail) return;
    const found: BlockErrors = {};
    const draft: { pageNo: number | null; text: string }[] = [];
    blocks.forEach((block) => {
      const textError = validateBlockText(block.text);
      const page = parsePageNo(block.pageNo);
      if (textError || page.error) found[block.key] = { text: textError ?? undefined, pageNo: page.error ?? undefined };
      draft.push({ pageNo: page.value, text: block.text });
    });
    setErrors(found);
    if (blocks.length === 0 || blocks.length > BLOCKS_MAX) { setNotice({ tone: "danger", text: `블록은 1~${BLOCKS_MAX}개여야 합니다.` }); return; }
    if (Object.keys(found).length > 0) { setNotice({ tone: "danger", text: "입력 내용을 확인하세요." }); return; }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    const result = await saveSource(episodeId, detail.latestSourceVersion, draft);
    savingRef.current = false;
    setSaving(false);
    if (result.ok) {
      setNotice(result.value.changed
        ? { tone: "success", text: `원문 버전 ${result.value.version}으로 저장했습니다.` }
        : { tone: "info", text: "변경 사항이 없어 새 버전을 만들지 않았습니다." });
      if (result.value.changed) setSourceSaves((count) => count + 1);
      await load();
      return;
    }
    const { failure } = result;
    if (failure.kind === "unauthorized") { handleUnauthorized(); return; }
    if (failure.kind === "conflict") setConflict(failure.latestVersion);
    setNotice({ tone: failure.kind === "conflict" ? "warning" : "danger", text: episodeFailureMessage(failure) });
  }

  async function onView(version: number) {
    const ticket = ++activeView.current;
    setViewError(null);
    const result = await getVersion(episodeId, version);
    if (ticket !== activeView.current) return; // a newer click wins
    if (result.ok) { setViewing(result.value); return; }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setViewing(null);
    setViewError(episodeFailureMessage(result.failure));
  }

  if (loading && !detail) return <p role="status">불러오는 중…</p>;
  if (loadFailure && !detail) {
    return <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(loadFailure)}</p>
      {loadFailure.kind === "not_found"
        ? <Link href="/episodes" className="btn btn-outline-secondary">회차 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!detail) return null;

  return <>
    <p className="d-flex justify-content-between"><Link href="/episodes">← 회차 목록</Link><Link href={`/history?episodeId=${encodeURIComponent(episodeId)}`}>이 회차의 작업 이력</Link></p>
    <h1 className="h2 mb-1">{detail.title}</h1>
    <p className="text-secondary">{detail.latestSourceVersion === 0 ? "아직 저장된 원문이 없습니다." : `최신 원문 버전: v${detail.latestSourceVersion}`}</p>
    {loadFailure && <div className="alert alert-warning" role="alert">{episodeFailureMessage(loadFailure)}</div>}

    <AssignmentPanel episodeId={episodeId} />
    {detail.source && <PageImagesPanel key={detail.latestSourceVersion} episodeId={episodeId}
      pageNumbers={[...new Set(detail.source.blocks.flatMap((block) => (block.pageNo === null ? [] : [block.pageNo])))].sort((a, b) => a - b)} />}
    <TranslationOverviewPanel episodeId={episodeId} refreshKey={sourceSaves} />

    <section aria-label="원문 편집" className="card card-body shadow-sm mb-3">
      <h2 className="h5">원문 편집</h2>
      <p className="text-secondary small">저장하면 새 원문 버전이 만들어지며 기존 버전은 바뀌지 않습니다. 작성 중인 내용은 저장 전까지 이 화면에만 있습니다.</p>
      <ol className="list-unstyled">
        {blocks.map((block, index) => {
          const number = index + 1;
          const blockErrors = errors[block.key] ?? {};
          return <li key={block.key} className="border rounded p-2 mb-2">
            <div className="d-flex gap-2 align-items-start">
              <div className="flex-grow-1">
                <label className="form-label small mb-1" htmlFor={`text-${block.key}`}>블록 {number} 텍스트</label>
                <textarea id={`text-${block.key}`} className="form-control" rows={3} value={block.text}
                  aria-invalid={blockErrors.text ? true : undefined}
                  onChange={(event) => update(block.key, { text: event.target.value })} />
                {blockErrors.text && <p className="text-danger small mt-1 mb-0" role="alert">{blockErrors.text}</p>}
              </div>
              <div style={{ width: 120 }}>
                <label className="form-label small mb-1" htmlFor={`page-${block.key}`}>블록 {number} 페이지</label>
                <input id={`page-${block.key}`} className="form-control" type="text" inputMode="numeric" value={block.pageNo}
                  aria-invalid={blockErrors.pageNo ? true : undefined}
                  onChange={(event) => update(block.key, { pageNo: event.target.value })} />
                {blockErrors.pageNo && <p className="text-danger small mt-1 mb-0" role="alert">{blockErrors.pageNo}</p>}
              </div>
              <div className="btn-group-vertical">
                <button type="button" className="btn btn-outline-secondary btn-sm" disabled={index === 0}
                  onClick={() => move(index, -1)}>블록 {number} 위로</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}>블록 {number} 아래로</button>
                <button type="button" className="btn btn-outline-danger btn-sm" disabled={blocks.length === 1}
                  onClick={() => setBlocks((current) => current.filter((item) => item.key !== block.key))}>블록 {number} 삭제</button>
              </div>
            </div>
          </li>;
        })}
      </ol>
      <div className="d-flex gap-2 flex-wrap">
        <button type="button" className="btn btn-outline-secondary" disabled={blocks.length >= BLOCKS_MAX}
          onClick={() => setBlocks((current) => [...current, ...toEditor(undefined)])}>블록 추가</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void onSave()}>{saving ? "저장 중…" : "원문 저장"}</button>
      </div>
      {notice && <p className={`alert alert-${notice.tone} mt-3 mb-0`} role={notice.tone === "danger" || notice.tone === "warning" ? "alert" : "status"}>{notice.text}</p>}
      {conflict !== false && <div className="mt-2">
        <button type="button" className="btn btn-warning" disabled={loading} onClick={() => void load()}>최신 버전 불러오기 (작성 중인 내용은 사라집니다)</button>
      </div>}
    </section>

    <section aria-label="버전 이력" className="card card-body shadow-sm">
      <h2 className="h5">버전 이력</h2>
      {versions.length === 0 ? <p className="text-secondary">저장된 버전이 없습니다.</p> : <div className="table-responsive"><table className="table align-middle">
        <thead><tr><th>버전</th><th>저장 시각 (UTC)</th><th>저장자</th><th>블록 수</th><th /></tr></thead>
        <tbody>
          {versions.map((item) => <tr key={item.version}>
            <td>v{item.version}</td><td><time>{item.savedAt}</time></td><td>{item.savedBy.displayName}</td><td>{item.blockCount}</td>
            <td><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void onView(item.version)}>v{item.version} 보기</button></td>
          </tr>)}
        </tbody>
      </table></div>}
      {viewError && <p className="alert alert-warning" role="alert">{viewError}</p>}
      {viewing && <div aria-label={`v${viewing.version} 내용`} role="region">
        <h3 className="h6">v{viewing.version} (읽기 전용)</h3>
        <ol>{viewing.blocks.map((block) => <li key={block.seq} style={{ whiteSpace: "pre-wrap" }}>
          {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.text}
        </li>)}</ol>
      </div>}
    </section>
  </>;
}

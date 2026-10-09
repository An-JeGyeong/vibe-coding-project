"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getMyEpisode, listMyEpisodes } from "@/lib/assignment/client";
import type { MyEpisodeDetail, MyEpisodeList } from "@/lib/assignment/types";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { getTypesettable, listTypesettable } from "@/lib/typeset/client";
import type { TypesetVersion, TypesetVersionDetail } from "@/lib/typeset/types";
import { listTranslatedImages } from "@/lib/translatedPages/client";
import { PageImageSlot, usePageImages } from "./PageImage";
import { PagedBlocks } from "./PagedBlocks";
import { TranslatedSlot, useTranslatedImages } from "./TranslatedPageImages";

const PAGE_SIZE = 20;

/** What one row of the list says: the newest approved translation and how many pages already have a translated image. */
function RowStatus({ episodeId }: { episodeId: string }) {
  const [text, setText] = useState("확인 중…");
  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      const versions = await listTypesettable(episodeId, request.signal);
      if (request.signal.aborted) return;
      if (!versions.ok) { setText("확인하지 못함"); return; }
      if (versions.value.length === 0) { setText("승인된 번역 없음"); return; }
      const newest = versions.value[0].versionNo;
      const images = await listTranslatedImages("mine", episodeId, newest, request.signal);
      if (request.signal.aborted) return;
      setText(images.ok ? `승인된 번역 v${newest} · 번역본 이미지 ${images.value.length}페이지` : `승인된 번역 v${newest}`);
    })();
    return () => request.abort();
  }, [episodeId]);
  return <span>{text}</span>;
}

/** The typesetter's assigned episodes (CONTRACTS 29.6). */
export function TypesetListView() {
  const { handleUnauthorized } = useAuth();
  const [list, setList] = useState<MyEpisodeList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await listMyEpisodes(PAGE_SIZE, nextOffset, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setOffset(nextOffset); setError(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setError(episodeFailureMessage(result.failure));
  }, [handleUnauthorized]);

  useEffect(() => {
    void load(0);
    return () => active.current?.abort();
  }, [load]);

  const total = list?.total ?? 0;
  return <section aria-label="식자 대기 목록" className="card card-body shadow-sm">
    <h2 className="h5">내게 배정된 회차</h2>
    <p className="text-secondary small">감수자가 승인한 번역이 있는 회차에서 번역본(식자 완료) 이미지를 올립니다.</p>
    {loading && <p role="status">불러오는 중…</p>}
    {error && <div className="alert alert-warning" role="alert">
      <p>{error}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
    </div>}
    {!loading && !error && list && list.items.length === 0 && <p className="text-secondary empty-note">배정된 회차가 없습니다.</p>}
    {list && list.items.length > 0 && <div className="table-responsive"><table className="table align-middle">
      <thead><tr><th>제목</th><th>상태</th><th>배정 시각 (UTC)</th></tr></thead>
      <tbody>
        {list.items.map((item) => <tr key={item.id}>
          <td><Link href={`/typeset/${encodeURIComponent(item.id)}`}>{item.title}</Link></td>
          <td><RowStatus episodeId={item.id} /></td>
          <td><time>{item.assignedAt}</time></td>
        </tr>)}
      </tbody>
    </table></div>}
    {total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0} onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
      <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
      <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
    </div>}
  </section>;
}

/**
 * One episode for the typesetter (CONTRACTS 29.6): page by page, the original image on the left, the approved translation (read-only)
 * and the translated image with its upload control on the right. Nothing here can change the translation.
 */
export function TypesetWorkspace({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [episode, setEpisode] = useState<MyEpisodeDetail | null>(null);
  const [versions, setVersions] = useState<TypesetVersion[] | null>(null);
  const [versionNo, setVersionNo] = useState<number | null>(null);
  const [detail, setDetail] = useState<TypesetVersionDetail | null>(null);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [detailFailure, setDetailFailure] = useState<EpisodeFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const activeDetail = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const [mine, list] = await Promise.all([getMyEpisode(episodeId, request.signal), listTypesettable(episodeId, request.signal)]);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    for (const result of [mine, list]) {
      if (!result.ok && result.failure.kind === "aborted") return;
      if (!result.ok && result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    }
    if (!mine.ok) { setFailure(mine.failure); return; }
    if (!list.ok) { setFailure(list.failure); return; }
    setFailure(null);
    setEpisode(mine.value);
    setVersions(list.value);
    setVersionNo((current) => (current !== null && list.value.some((item) => item.versionNo === current) ? current : list.value[0]?.versionNo ?? null));
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => { active.current?.abort(); activeDetail.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (versionNo === null) { setDetail(null); return; }
    activeDetail.current?.abort();
    const request = new AbortController();
    activeDetail.current = request;
    setDetail(null);
    setDetailFailure(null);
    void getTypesettable(episodeId, versionNo, request.signal).then((result) => {
      if (request.signal.aborted) return;
      if (result.ok) { setDetail(result.value); return; }
      if (result.failure.kind === "aborted") return;
      if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
      setDetailFailure(result.failure);
    });
    return () => request.abort();
  }, [episodeId, versionNo, handleUnauthorized]);

  const numbered = detail !== null && detail.blocks.some((block) => block.pageNo !== null);
  const originals = usePageImages("mine", episodeId, numbered);
  const translated = useTranslatedImages("mine", episodeId, versionNo ?? 0, numbered);

  if (loading && !episode) return <p role="status">불러오는 중…</p>;
  if (failure && !episode) {
    return <div className="alert alert-warning" role="alert">
      <p>{failure.kind === "not_found" ? "배정되지 않았거나 존재하지 않는 회차입니다." : episodeFailureMessage(failure)}</p>
      {failure.kind === "not_found"
        ? <Link href="/typeset" className="btn btn-outline-secondary">식자 대기 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!episode || !versions) return null;

  const pages = detail ? [...new Set(detail.blocks.flatMap((block) => (block.pageNo === null ? [] : [block.pageNo])))].sort((a, b) => a - b) : [];
  const done = translated.pages === null ? null : pages.filter((page) => translated.pages!.has(page)).length;

  return <>
    <p><Link href="/typeset">← 식자 대기 목록</Link></p>
    <h1 className="h2 mb-1">{episode.title}</h1>
    <p className="text-secondary">승인된 번역을 보며 번역본(식자 완료) 이미지를 올립니다. 번역은 이 화면에서 고칠 수 없습니다.</p>
    {versions.length === 0 && <p className="alert alert-secondary" role="status">승인된 번역이 아직 없습니다. 감수자가 번역을 승인하면 이미지를 올릴 수 있습니다.</p>}
    {versions.length > 0 && <section aria-label="승인된 번역" className="card card-body shadow-sm">
      <h2 className="h5">승인된 번역</h2>
      <div className="d-flex flex-wrap gap-3 align-items-end mb-2">
        <div>
          <label className="form-label small mb-1" htmlFor="typeset-version">번역 버전</label>
          <select id="typeset-version" className="form-select w-auto" value={versionNo ?? ""} onChange={(event) => setVersionNo(Number(event.target.value))}>
            {versions.map((item) => <option key={item.versionNo} value={item.versionNo}>v{item.versionNo} (기준 원문 v{item.sourceVersion})</option>)}
          </select>
        </div>
        {done !== null && pages.length > 0 && <p className="mb-0" role="status">번역본 이미지 {done}/{pages.length} 페이지</p>}
      </div>
      {detailFailure && <p className="alert alert-warning" role="alert">{detailFailure.kind === "not_found" ? "이 번역은 더 이상 이미지를 올릴 수 있는 상태가 아닙니다. 새로고침해 확인하세요." : episodeFailureMessage(detailFailure)}</p>}
      {!detail && !detailFailure && <p role="status">불러오는 중…</p>}
      {detail && !numbered && <p className="text-secondary">이 번역에는 페이지 번호가 있는 블록이 없어 올릴 이미지가 없습니다.</p>}
      {detail && <PagedBlocks blocks={detail.blocks} resetKey={detail.versionNo}
        imageSlot={(pageNo) => <PageImageSlot scope="mine" episodeId={episodeId} pageNo={pageNo} images={originals} />}
        renderPage={(pageBlocks) => {
          const pageNo = pageBlocks.find((block) => block.pageNo !== null)?.pageNo ?? null;
          return <>
            <ol className="list-unstyled">
              {pageBlocks.map((block) => <li key={block.seq} className="border rounded p-2 mb-2">
                <div className="small text-secondary" style={{ whiteSpace: "pre-wrap" }}>{block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.source}</div>
                <div style={{ whiteSpace: "pre-wrap" }}><span className="visually-hidden">블록 {block.seq} 번역: </span>{block.text}</div>
              </li>)}
            </ol>
            {pageNo !== null && <TranslatedSlot scope="mine" episodeId={episodeId} versionNo={detail.versionNo} pageNo={pageNo} images={translated} editable />}
          </>;
        }} />}
    </section>}
  </>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createEpisode, listEpisodes } from "@/lib/episodes/client";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure, EpisodeList } from "@/lib/episodes/types";
import { validateTitle } from "@/lib/episodes/validation";

const PAGE_SIZE = 20;

export function EpisodeListView() {
  const auth = useAuth();
  const router = useRouter();
  const [list, setList] = useState<EpisodeList | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const activeLoad = useRef<AbortController | null>(null);
  const { handleUnauthorized } = auth;

  const load = useCallback(async (nextOffset: number) => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const result = await listEpisodes(PAGE_SIZE, nextOffset, request.signal);
    if (activeLoad.current !== request) return; // a newer load replaced this one
    activeLoad.current = null;
    setLoading(false);
    if (result.ok) { setList(result.value); setOffset(nextOffset); setLoadError(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setLoadError(episodeFailureMessage(result.failure));
  }, [handleUnauthorized]);

  useEffect(() => {
    void load(0);
    return () => activeLoad.current?.abort();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingRef.current) return;
    const error = validateTitle(title);
    setTitleError(error);
    if (error) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    const result = await createEpisode(title);
    creatingRef.current = false;
    setCreating(false);
    if (result.ok) { router.push(`/episodes/${encodeURIComponent(result.value.id)}`); return; }
    const failure: EpisodeFailure = result.failure;
    if (failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setCreateError(episodeFailureMessage(failure));
  }

  const total = list?.total ?? 0;
  return <>
    <section aria-label="회차 생성" className="card card-body shadow-sm mb-3">
      <h2 className="h5">새 회차</h2>
      <form onSubmit={onCreate} noValidate aria-label="회차 생성 양식">
        <label className="form-label w-100">제목
          <input className="form-control mt-1" name="title" type="text" value={title}
            aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? "title-error" : undefined}
            onChange={(event) => setTitle(event.target.value)} />
        </label>
        {titleError && <p id="title-error" className="text-danger small mt-1 mb-0" role="alert">{titleError}</p>}
        {createError && <p className="alert alert-danger mt-3 mb-0" role="alert">{createError}</p>}
        <button type="submit" className="btn btn-primary mt-3" disabled={creating}>{creating ? "생성 중…" : "회차 만들기"}</button>
      </form>
    </section>
    <section aria-label="회차 목록" className="card card-body shadow-sm">
      <h2 className="h5">회차 목록</h2>
      {loading && <p role="status">불러오는 중…</p>}
      {loadError && <div className="alert alert-warning" role="alert">
        <p>{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
      </div>}
      {!loading && !loadError && list && list.items.length === 0 && <p className="text-secondary">등록된 회차가 없습니다.</p>}
      {list && list.items.length > 0 && <table className="table align-middle">
        <thead><tr><th>제목</th><th>최신 원문 버전</th><th>수정 시각 (UTC)</th></tr></thead>
        <tbody>
          {list.items.map((item) => <tr key={item.id}>
            <td><Link href={`/episodes/${encodeURIComponent(item.id)}`}>{item.title}</Link></td>
            <td>{item.latestSourceVersion === 0 ? "원문 없음" : `v${item.latestSourceVersion}`}</td>
            <td><time>{item.updatedAt}</time></td>
          </tr>)}
        </tbody>
      </table>}
      {list && total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
        <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0}
          onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
        <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
        <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total}
          onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
      </div>}
    </section>
  </>;
}

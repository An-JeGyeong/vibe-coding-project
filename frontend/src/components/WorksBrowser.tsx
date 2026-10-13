"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { filterWorks, loadAllWorks, type AllWorks } from "@/lib/catalog/all";
import { GENRES, type WorkSort } from "@/lib/catalog/types";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { publicFailureMessage } from "@/lib/publication/messages";
import { WorkGrid } from "./CatalogParts";

const SORTS: { value: WorkSort; label: string }[] = [{ value: "latest", label: "최신순" }, { value: "popular", label: "인기순" }];

/** Finds works by title or author, with a genre and a sort (CONTRACTS 30.2). The server list is loaded once per genre and sort; the text filter runs here. */
export function WorksBrowser({ initialQuery = "", initialGenre = "", initialSort = "latest" }: { initialQuery?: string; initialGenre?: string; initialSort?: WorkSort }) {
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState((GENRES as readonly string[]).includes(initialGenre) ? initialGenre : "");
  const [sort, setSort] = useState<WorkSort>(initialSort);
  const [all, setAll] = useState<AllWorks | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await loadAllWorks({ genre: genre === "" ? undefined : genre, sort }, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setAll(result.value); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    setAll(null);
    setFailure(result.failure);
  }, [genre, sort]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  useEffect(() => {
    // the address keeps the search, so a result page can be shared and reloaded
    const params = new URLSearchParams();
    if (query.trim() !== "") params.set("q", query.trim());
    if (genre !== "") params.set("genre", genre);
    if (sort !== "latest") params.set("sort", sort);
    const search = params.toString();
    try { window.history.replaceState(null, "", `${window.location.pathname}${search === "" ? "" : `?${search}`}`); } catch { /* no history */ }
  }, [query, genre, sort]);

  const shown = all ? filterWorks(all.items, query) : [];
  return <section aria-label="작품 찾기">
    <form role="search" className="works-search mb-3" onSubmit={(event) => event.preventDefault()}>
      <label className="form-label small mb-1" htmlFor="works-query">작품 제목·작가 검색</label>
      <div className="d-flex gap-2 flex-wrap">
        <input id="works-query" type="search" className="form-control flex-grow-1" style={{ maxWidth: "28rem" }} value={query} placeholder="제목이나 작가로 검색"
          onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="정렬" className="form-select w-auto" value={sort} onChange={(event) => setSort(event.target.value as WorkSort)}>
          {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </form>
    <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="장르 선택">
      {["", ...GENRES].map((name) => <button key={name || "all"} type="button" aria-pressed={genre === name}
        className={`btn btn-sm ${genre === name ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setGenre(name)}>{name || "전체"}</button>)}
    </div>
    {loading && <p role="status">불러오는 중…</p>}
    {failure && <div className="alert alert-warning" role="alert">
      <p>{publicFailureMessage(failure)}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>다시 시도</button>
    </div>}
    {all && !loading && <p className="small text-secondary" aria-live="polite">{shown.length}개의 작품{all.truncated ? " (처음 200개 안에서 찾았습니다)" : ""}</p>}
    {all && !loading && shown.length === 0 && <p className="text-secondary empty-note">{query.trim() === "" ? "공개된 작품이 아직 없습니다." : "검색 결과가 없습니다."}</p>}
    {shown.length > 0 && <WorkGrid works={shown} label="작품 목록" />}
  </section>;
}

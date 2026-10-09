"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { fetchPageImage, listPageImages } from "@/lib/pages/client";
import { pageImageViewMessage } from "@/lib/pages/messages";
import type { PageImageMeta, PageImageScope } from "@/lib/pages/types";

type View = { state: "loading" } | { state: "ready"; url: string } | { state: "failed"; failure: EpisodeFailure };

/** One page image shown from a Blob URL: the authenticated request cannot be an <img src>. The URL is released when it is replaced or the view closes. */
export function PageImage({ scope, episodeId, pageNo, refreshKey = 0, compact = false }: {
  scope: PageImageScope; episodeId: string; pageNo: number; refreshKey?: number; compact?: boolean;
}) {
  const { handleUnauthorized } = useAuth();
  const [view, setView] = useState<View>({ state: "loading" });
  const [fit, setFit] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const request = new AbortController();
    setView({ state: "loading" });
    void fetchPageImage(scope, episodeId, pageNo, request.signal).then((result) => {
      if (request.signal.aborted) return; // another page, another episode or a closed view: the late answer is dropped
      if (!result.ok) {
        if (result.failure.kind === "aborted") return;
        if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
        setView({ state: "failed", failure: result.failure });
        return;
      }
      const url = URL.createObjectURL(result.value);
      urlRef.current = url;
      setView({ state: "ready", url });
    });
    return () => {
      request.abort();
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [scope, episodeId, pageNo, refreshKey, attempt, handleUnauthorized]);

  if (view.state === "loading") return <p role="status" className="small text-secondary">이미지를 불러오는 중…</p>;
  if (view.state === "failed") {
    return <div className="small text-secondary border rounded p-2 mb-2">
      <span>{pageImageViewMessage(view.failure)}</span>
      {view.failure.kind !== "not_found" && <button type="button" className="btn btn-link btn-sm" onClick={() => setAttempt((count) => count + 1)}>다시 시도</button>}
    </div>;
  }
  return <figure className="mb-2">
    <div tabIndex={0} role="group" aria-label={`페이지 ${pageNo} 원본 이미지 (스크롤 가능)`} style={{ overflow: "auto", maxHeight: compact ? "9rem" : "70vh" }} className="border rounded bg-body">
      {/* eslint-disable-next-line @next/next/no-img-element -- a Blob URL cannot go through next/image */}
      <img src={view.url} alt={`페이지 ${pageNo} 원본 이미지`} style={fit || compact ? { maxWidth: "100%", height: "auto", display: "block" } : { display: "block", maxWidth: "none" }} />
    </div>
    {!compact && <figcaption className="mt-1">
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setFit(!fit)}>{fit ? "원본 크기로 보기" : "폭에 맞추기"}</button>
    </figcaption>}
  </figure>;
}

/** The list of pages that have an image, loaded once per episode; a failure never blocks the text work. */
export function usePageImages(scope: PageImageScope, episodeId: string, enabled: boolean) {
  const { handleUnauthorized } = useAuth();
  const [pages, setPages] = useState<Map<number, PageImageMeta> | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await listPageImages(scope, episodeId, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setPages(new Map(result.value.map((item) => [item.pageNo, item]))); setFailed(false); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailed(true);
  }, [scope, episodeId, handleUnauthorized]);

  useEffect(() => {
    if (enabled) void load();
    return () => active.current?.abort();
  }, [enabled, load]);
  return { pages, failed, loading, reload: () => void load() };
}

/** What a page shows in the image position: the image, or a short note when there is none or it cannot be loaded. */
export function PageImageSlot({ scope, episodeId, pageNo, images }: {
  scope: PageImageScope; episodeId: string; pageNo: number | null; images: ReturnType<typeof usePageImages>;
}) {
  if (pageNo === null) return null; // images belong to page numbers
  if (images.loading && images.pages === null) return <p role="status" className="small text-secondary">이미지를 확인하는 중…</p>;
  if (images.failed && images.pages === null) {
    return <div className="small text-secondary border rounded p-2 mb-2">
      <span>페이지 이미지를 불러오지 못했습니다. 텍스트 작업은 계속할 수 있습니다.</span>
      <button type="button" className="btn btn-link btn-sm" onClick={images.reload}>다시 시도</button>
    </div>;
  }
  if (images.pages === null) return null;
  if (!images.pages.has(pageNo)) return <p className="small text-secondary border rounded p-2 mb-2">이 페이지에는 원본 이미지가 없습니다.</p>;
  return <PageImage scope={scope} episodeId={episodeId} pageNo={pageNo} refreshKey={Date.parse(images.pages.get(pageNo)!.updatedAt)} />;
}

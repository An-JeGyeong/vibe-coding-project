"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { pageImageUploadMessage } from "@/lib/pages/messages";
import type { PageImageMeta, PageImageScope } from "@/lib/pages/types";
import { validateImageFile } from "@/lib/pages/validation";
import { fetchTranslatedImage, listTranslatedImages, uploadTranslatedImage } from "@/lib/translatedPages/client";
import { PageImageSlot, usePageImages } from "./PageImage";

// Translated (typeset) page images of one translation version (CONTRACTS 27.4).

export function translatedUploadMessage(failure: EpisodeFailure): string {
  if (failure.kind === "state_conflict") return "제출되었거나 수정할 수 없는 번역이라 이미지를 올릴 수 없습니다. 새로고침한 뒤 확인하세요.";
  if (failure.kind === "not_found") return "이 번역이나 페이지를 찾을 수 없거나 담당 번역가가 아닙니다.";
  return pageImageUploadMessage(failure);
}

/** The pages of this version that have a translated image; a failure never blocks the text work. */
export function useTranslatedImages(scope: PageImageScope, episodeId: string, versionNo: number, enabled: boolean) {
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
    const result = await listTranslatedImages(scope, episodeId, versionNo, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setPages(new Map(result.value.map((item) => [item.pageNo, item]))); setFailed(false); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailed(true);
  }, [scope, episodeId, versionNo, handleUnauthorized]);

  useEffect(() => {
    setPages(null); // another version has other images
    if (enabled) void load();
    return () => active.current?.abort();
  }, [enabled, load]);
  return { pages, failed, loading, reload: () => void load() };
}
type TranslatedImages = ReturnType<typeof useTranslatedImages>;

type View = { state: "loading" } | { state: "ready"; url: string } | { state: "failed"; failure: EpisodeFailure };

function TranslatedImage({ scope, episodeId, versionNo, pageNo, refreshKey }: {
  scope: PageImageScope; episodeId: string; versionNo: number; pageNo: number; refreshKey: number;
}) {
  const { handleUnauthorized } = useAuth();
  const [view, setView] = useState<View>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const request = new AbortController();
    setView({ state: "loading" });
    void fetchTranslatedImage(scope, episodeId, versionNo, pageNo, request.signal).then((result) => {
      if (request.signal.aborted) return;
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
  }, [scope, episodeId, versionNo, pageNo, refreshKey, attempt, handleUnauthorized]);

  if (view.state === "loading") return <p role="status" className="small text-secondary">번역본 이미지를 불러오는 중…</p>;
  if (view.state === "failed") {
    return <div className="small text-secondary border rounded p-2 mb-2">
      <span>번역본 이미지를 불러오지 못했습니다.</span>
      <button type="button" className="btn btn-link btn-sm" onClick={() => setAttempt((count) => count + 1)}>다시 시도</button>
    </div>;
  }
  return <figure className="mb-2">
    <div tabIndex={0} role="group" aria-label={`페이지 ${pageNo} 번역본 이미지 (스크롤 가능)`} style={{ overflow: "auto", maxHeight: "70vh" }} className="border rounded bg-body">
      {/* eslint-disable-next-line @next/next/no-img-element -- a Blob URL cannot go through next/image */}
      <img src={view.url} alt={`페이지 ${pageNo} 번역본 이미지`} style={{ maxWidth: "100%", height: "auto", display: "block" }} />
    </div>
  </figure>;
}

function Uploader({ episodeId, versionNo, pageNo, replacing, onSaved }: {
  episodeId: string; versionNo: number; pageNo: number; replacing: boolean; onSaved: () => void;
}) {
  const { handleUnauthorized } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const inputId = `translated-upload-${pageNo}`;

  async function onPick(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen || busy) return;
    setMessage(null);
    const problem = await validateImageFile(chosen);
    if (problem) { setMessage({ tone: "danger", text: problem }); return; }
    setBusy(true);
    const result = await uploadTranslatedImage(episodeId, versionNo, pageNo, chosen);
    setBusy(false);
    if (!result.ok) {
      if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
      setMessage({ tone: "danger", text: translatedUploadMessage(result.failure) });
      return;
    }
    setMessage({ tone: "success", text: result.value.created ? "번역본 이미지를 올렸습니다." : "번역본 이미지를 교체했습니다." });
    onSaved();
  }

  return <div className="mb-2">
    <label className="form-label small mb-1" htmlFor={inputId}>페이지 {pageNo} 번역본 이미지 {replacing ? "교체" : "올리기"}</label>
    <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" className="form-control form-control-sm" disabled={busy}
      onChange={(event) => { const input = event.currentTarget; void onPick(input.files).finally(() => { input.value = ""; }); }} />
    <p className="small text-secondary mb-1">PNG·JPEG·WEBP, 5 MiB 이하. 식자를 마친 완성 이미지를 올립니다.</p>
    {busy && <p role="status" className="small mb-1">올리는 중…</p>}
    {message && <p role={message.tone === "danger" ? "alert" : "status"} className={`small mb-1 ${message.tone === "danger" ? "text-danger" : "text-success"}`}>{message.text}</p>}
  </div>;
}

/** What the translated-image column of one page shows: the image, an upload control for the editing translator, or a short note. */
function TranslatedSlot({ scope, episodeId, versionNo, pageNo, images, editable }: {
  scope: PageImageScope; episodeId: string; versionNo: number; pageNo: number; images: TranslatedImages; editable: boolean;
}) {
  const meta = images.pages?.get(pageNo);
  const failedList = images.failed && images.pages === null;
  return <div>
    <h3 className="h6 text-secondary">번역본 이미지</h3>
    {images.loading && images.pages === null && <p role="status" className="small text-secondary">번역본 이미지를 확인하는 중…</p>}
    {failedList && <div className="small text-secondary border rounded p-2 mb-2">
      <span>번역본 이미지를 불러오지 못했습니다. 텍스트 작업은 계속할 수 있습니다.</span>
      <button type="button" className="btn btn-link btn-sm" onClick={images.reload}>다시 시도</button>
    </div>}
    {images.pages !== null && (meta
      ? <TranslatedImage scope={scope} episodeId={episodeId} versionNo={versionNo} pageNo={pageNo} refreshKey={Date.parse(meta.updatedAt)} />
      : <p className="small text-secondary border rounded p-2 mb-2">이 페이지에는 번역본 이미지가 없습니다.</p>)}
    {editable && (images.pages !== null || failedList) && <Uploader episodeId={episodeId} versionNo={versionNo} pageNo={pageNo} replacing={!!meta} onSaved={images.reload} />}
  </div>;
}

/**
 * The image position of a page: the original and the translated image side by side (stacked on a narrow screen).
 * Only a translator who is editing a DRAFT gets the upload control; reviewers and operators see it read-only.
 */
export function PageImagePair({ scope, episodeId, versionNo, pageNo, original, translated, editable = false }: {
  scope: PageImageScope; episodeId: string; versionNo: number; pageNo: number | null;
  original: ReturnType<typeof usePageImages>; translated: TranslatedImages; editable?: boolean;
}) {
  if (pageNo === null) return null;
  return <div className="row g-3 mb-2">
    <div className="col-lg-6">
      <h3 className="h6 text-secondary">원본 이미지</h3>
      <PageImageSlot scope={scope} episodeId={episodeId} pageNo={pageNo} images={original} />
    </div>
    <div className="col-lg-6">
      <TranslatedSlot scope={scope} episodeId={episodeId} versionNo={versionNo} pageNo={pageNo} images={translated} editable={editable} />
    </div>
  </div>;
}

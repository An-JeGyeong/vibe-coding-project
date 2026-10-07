"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { uploadPageImage } from "@/lib/pages/client";
import { pageImageUploadMessage } from "@/lib/pages/messages";
import { ALLOWED_IMAGE_TYPES } from "@/lib/pages/types";
import { validateImageFile } from "@/lib/pages/validation";
import { PageImage, usePageImages } from "./PageImage";

type Notice = { tone: "success" | "danger"; text: string; pageNo: number };

/** Operator: the original image of each page of the source (CONTRACTS 26.4). Only page numbers that exist in the latest source can get an image. */
export function PageImagesPanel({ episodeId, pageNumbers }: { episodeId: string; pageNumbers: number[] }) {
  const { handleUnauthorized } = useAuth();
  const images = usePageImages("operator", episodeId, true);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busyRef = useRef(false);

  async function onPick(pageNo: number, files: FileList | null) {
    const file = files?.[0];
    if (!file || busyRef.current) return;
    setNotice(null);
    const problem = await validateImageFile(file); // checked locally first; the server checks again
    if (problem) { setNotice({ tone: "danger", text: problem, pageNo }); return; }
    busyRef.current = true;
    setBusy(pageNo);
    const result = await uploadPageImage(episodeId, pageNo, file);
    busyRef.current = false;
    setBusy(null);
    if (result.ok) {
      setNotice({ tone: "success", text: result.value.created ? "이미지를 저장했습니다." : "이미지를 교체했습니다.", pageNo });
      images.reload();
      return;
    }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setNotice({ tone: "danger", text: pageImageUploadMessage(result.failure), pageNo });
  }

  return <section id="section-images" aria-label="페이지 이미지" className="card card-body shadow-sm mb-3">
    <h2 className="h5">페이지 이미지</h2>
    <p className="text-secondary small">번역가와 감수자가 원본 이미지를 보며 작업할 수 있게 페이지마다 이미지를 올립니다(PNG·JPEG·WEBP, 5 MiB 이하). 다시 올리면 교체됩니다. 독자에게는 보이지 않습니다.</p>
    {pageNumbers.length === 0 && <p className="text-secondary empty-note mb-0">원문 블록에 페이지 번호가 없어 이미지를 올릴 수 없습니다. 원문에서 블록의 페이지 번호를 지정하세요.</p>}
    {images.failed && images.pages === null && <div className="alert alert-warning" role="alert">
      <p className="mb-2">페이지 이미지 목록을 불러오지 못했습니다.</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={images.reload}>다시 시도</button>
    </div>}
    <ul className="list-unstyled mb-0">
      {pageNumbers.map((pageNo) => {
        const stored = images.pages?.get(pageNo);
        return <li key={pageNo} className="border rounded p-2 mb-2">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
            <strong>페이지 {pageNo}</strong>
            <span className="small text-secondary">{images.pages === null ? "확인 중…" : stored ? `이미지 있음 (${Math.ceil(stored.byteSize / 1024)} KiB)` : "이미지 없음"}</span>
            <label className="btn btn-outline-primary btn-sm mb-0 ms-auto">
              {busy === pageNo ? "올리는 중…" : stored ? "교체" : "업로드"}
              <input type="file" className="visually-hidden" aria-label={`페이지 ${pageNo} 이미지 선택`} accept={ALLOWED_IMAGE_TYPES.join(",")}
                disabled={busy !== null} onChange={(event) => { void onPick(pageNo, event.target.files); event.target.value = ""; }} />
            </label>
          </div>
          {stored && <PageImage scope="operator" episodeId={episodeId} pageNo={pageNo} refreshKey={Date.parse(stored.updatedAt)} compact />}
          {notice?.pageNo === pageNo && <p className={`small mb-0 ${notice.tone === "success" ? "text-success" : "text-danger"}`} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p>}
        </li>;
      })}
    </ul>
  </section>;
}

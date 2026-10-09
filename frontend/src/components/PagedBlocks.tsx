"use client";

import { type ReactNode, useState } from "react";
import { groupByPage, type PageGroup } from "@/lib/translation/pages";

type PageBlock = { seq: number; pageNo: number | null };

/**
 * One page at a time (CONTRACTS 26.4): a page bar with previous / next / a page picker, and the content of the current page.
 * It holds no data of its own: the parent keeps every input (translations, remarks), so turning pages never loses anything.
 * `imageSlot` is where the page image goes once pages have images; without it the page is text only.
 */
export function PagedBlocks<T extends PageBlock>({ blocks, resetKey, renderPage, note, imageSlot }: {
  blocks: T[]; resetKey: string | number; renderPage: (blocks: T[]) => ReactNode; note?: (blocks: T[]) => string; imageSlot?: (pageNo: number | null) => ReactNode;
}) {
  const pages: PageGroup<T>[] = groupByPage(blocks);
  // The position belongs to the data it was chosen on: a new key (another version) starts at the first page again.
  // Adjusting state during render (not in an effect) means a click right after mounting can never be undone by a late reset.
  const [view, setView] = useState({ key: resetKey, index: 0, all: false });
  const fresh = view.key === resetKey ? view : { key: resetKey, index: 0, all: false };
  if (fresh !== view) setView(fresh);
  const { index, all } = fresh;
  const setIndex = (next: number) => setView({ ...fresh, index: next });
  const setAll = (next: boolean) => setView({ ...fresh, all: next });

  if (pages.length === 0) return <>{renderPage([])}</>;
  const current = Math.min(index, pages.length - 1);
  const page = pages[current];
  const bar = pages.length > 1 && <nav aria-label="페이지 이동" className="d-flex flex-wrap align-items-center gap-2 mb-3">
    {!all && <>
      <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current === 0} onClick={() => setIndex(current - 1)}>이전 페이지</button>
      <span className="small">{page.label} ({current + 1} / {pages.length}){note && <span className="text-secondary"> · {note(page.blocks)}</span>}</span>
      <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current === pages.length - 1} onClick={() => setIndex(current + 1)}>다음 페이지</button>
      <select aria-label="페이지 선택" className="form-select form-select-sm w-auto" value={current} onChange={(event) => setIndex(Number(event.target.value))}>
        {pages.map((entry, position) => <option key={entry.label} value={position}>{entry.label}</option>)}
      </select>
    </>}
    <div className="form-check ms-auto">
      <input id="paged-all" type="checkbox" className="form-check-input" checked={all} onChange={(event) => setAll(event.target.checked)} />
      <label className="form-check-label small" htmlFor="paged-all">전체 보기</label>
    </div>
  </nav>;

  return <>
    {bar}
    {all
      ? pages.map((entry) => <div key={entry.label} className="mb-3">
        <h3 className="h6 text-secondary">{entry.label}</h3>
        {renderPage(entry.blocks)}
      </div>)
      // the page image stays on the left while the blocks to work on scroll on the right; a page without a number has no image
      : imageSlot && page.pageNo !== null
        ? <div className="row g-3">
          <div className="col-lg-5"><div className="page-image-pane">{imageSlot(page.pageNo)}</div></div>
          <div className="col-lg-7">{renderPage(page.blocks)}</div>
        </div>
        : <div>{renderPage(page.blocks)}</div>}
  </>;
}

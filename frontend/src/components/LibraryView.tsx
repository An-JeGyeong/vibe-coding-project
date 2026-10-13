"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getWork } from "@/lib/catalog/client";
import type { WorkSummary } from "@/lib/catalog/types";
import { useLibrary } from "@/lib/personal/hooks";
import { WorkGrid } from "./CatalogParts";

const CONCURRENCY = 4;
type Slot = { state: "loading" } | { state: "ready"; work: WorkSummary } | { state: "gone" } | { state: "failed" };

/** The bookmarked works (CONTRACTS 30.2): each one is looked up in the public catalog; a work that is no longer public can be taken out. */
export function LibraryView() {
  const library = useLibrary();
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const request = new AbortController();
    const wanted = library.entries.map((entry) => entry.workId).filter((id) => !requested.current.has(id));
    for (const id of wanted) requested.current.add(id);
    if (wanted.length === 0) return;
    setSlots((previous) => ({ ...previous, ...Object.fromEntries(wanted.map((id) => [id, { state: "loading" } as Slot])) }));
    let next = 0;
    async function worker() {
      while (next < wanted.length && !request.signal.aborted) {
        const id = wanted[next++];
        const result = await getWork(id, request.signal);
        if (request.signal.aborted) return;
        const slot: Slot = result.ok ? { state: "ready", work: result.value }
          : result.failure.kind === "not_found" ? { state: "gone" } : { state: "failed" };
        if (!result.ok && result.failure.kind === "aborted") return;
        if (slot.state === "failed") requested.current.delete(id); // a retry happens on the next visit
        setSlots((previous) => ({ ...previous, [id]: slot }));
      }
    }
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, () => worker()));
    return () => request.abort();
  }, [library.entries]);

  if (library.entries.length === 0) {
    return <p className="text-secondary empty-note">아직 담은 작품이 없습니다. <Link href="/works">작품 찾기</Link>에서 하트를 눌러 담아 보세요.</p>;
  }
  const ready = library.entries.flatMap((entry) => { const slot = slots[entry.workId]; return slot?.state === "ready" ? [slot.work] : []; });
  const gone = library.entries.filter((entry) => slots[entry.workId]?.state === "gone");
  const failed = library.entries.filter((entry) => slots[entry.workId]?.state === "failed").length;
  const loading = library.entries.some((entry) => !slots[entry.workId] || slots[entry.workId].state === "loading");
  return <>
    <p className="small text-secondary" aria-live="polite">{library.entries.length}개의 작품을 담았습니다.</p>
    {loading && <p role="status">불러오는 중…</p>}
    {failed > 0 && <p className="text-danger small" role="alert">{failed}개의 작품을 불러오지 못했습니다. 새로고침한 뒤 다시 시도하세요.</p>}
    {ready.length > 0 && <WorkGrid works={ready} label="내 서재 작품" />}
    {gone.length > 0 && <section aria-label="공개되지 않은 작품" className="mt-4">
      <h2 className="h5">공개되지 않은 작품</h2>
      <p className="small text-secondary">보류되었거나 비공개로 바뀐 작품입니다. 다시 공개되면 여기서 다시 볼 수 있습니다.</p>
      <ul className="list-group">
        {gone.map((entry) => <li key={entry.workId} className="list-group-item d-flex justify-content-between align-items-center">
          <span>작품 #{entry.workId}</span>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => library.remove(entry.workId)}>작품 #{entry.workId} 서재에서 빼기</button>
        </li>)}
      </ul>
    </section>}
  </>;
}

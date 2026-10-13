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
export function LibraryView({ nested = false }: { nested?: boolean }) {
  const Heading = nested ? "h3" : "h2";
  const library = useLibrary();
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const requested = useRef(new Set<string>());
  const lifetime = useRef<AbortController | null>(null);
  // in-flight lookups end with the screen, not when the list changes (a work asked for once is not asked for again)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);

  const queue = useRef<string[]>([]);
  const active = useRef(0);

  // at most four lookups run at the same time, however the list grows (it can arrive in several steps)
  function pump(signal: AbortSignal) {
    while (active.current < CONCURRENCY && queue.current.length > 0 && !signal.aborted) {
      const id = queue.current.shift() as string;
      active.current++;
      void (async () => {
        const result = await getWork(id, signal);
        if (signal.aborted || (!result.ok && result.failure.kind === "aborted")) return;
        const slot: Slot = result.ok ? { state: "ready", work: result.value }
          : result.failure.kind === "not_found" ? { state: "gone" } : { state: "failed" };
        if (slot.state === "failed") requested.current.delete(id); // a retry happens on the next visit
        setSlots((previous) => ({ ...previous, [id]: slot }));
      })().finally(() => { active.current--; pump(signal); });
    }
  }

  useEffect(() => {
    const controller = lifetime.current;
    if (controller === null) return;
    const wanted = library.entries.map((entry) => entry.workId).filter((id) => !requested.current.has(id));
    for (const id of wanted) requested.current.add(id);
    if (wanted.length === 0) return;
    setSlots((previous) => ({ ...previous, ...Object.fromEntries(wanted.map((id) => [id, { state: "loading" } as Slot])) }));
    queue.current.push(...wanted);
    pump(controller.signal);
  }, [library.entries]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Heading className="h5">공개되지 않은 작품</Heading>
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

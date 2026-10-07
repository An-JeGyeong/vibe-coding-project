"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { HistoryView } from "@/components/HistoryView";
import { OperatorGate } from "@/components/OperatorGate";

function HistoryContent() {
  const episodeId = useSearchParams().get("episodeId") ?? "";
  return <HistoryView key={episodeId} initialEpisodeId={episodeId} />;
}

export default function HistoryPage() {
  return <main className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · HISTORY</p>
    <h1 className="h2 mb-3">작업 이력</h1>
    <OperatorGate>
      <Suspense fallback={<p role="status">불러오는 중…</p>}><HistoryContent /></Suspense>
    </OperatorGate>
  </main>;
}

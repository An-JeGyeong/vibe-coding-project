"use client";

import { EpisodeListView } from "@/components/EpisodeListView";
import { OperatorGate } from "@/components/OperatorGate";

export default function EpisodesPage() {
  return <main className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · EPISODES</p>
    <h1 className="h2 mb-3">회차·원문 관리</h1>
    <OperatorGate><EpisodeListView /></OperatorGate>
  </main>;
}

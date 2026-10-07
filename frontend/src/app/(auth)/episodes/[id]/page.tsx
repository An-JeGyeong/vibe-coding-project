"use client";

import { useParams } from "next/navigation";
import { EpisodeDetailView } from "@/components/EpisodeDetailView";
import { OperatorGate } from "@/components/OperatorGate";

export default function EpisodeDetailPage() {
  const params = useParams<{ id: string }>();
  return <main id="main-content" className="container py-5">
    <OperatorGate><EpisodeDetailView key={params.id} episodeId={params.id} /></OperatorGate>
  </main>;
}

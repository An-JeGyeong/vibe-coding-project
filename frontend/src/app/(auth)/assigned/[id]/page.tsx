"use client";

import { useParams } from "next/navigation";
import { AssignedDetailView } from "@/components/AssignedViews";
import { AssigneeGate } from "@/components/OperatorGate";

export default function AssignedDetailPage() {
  const params = useParams<{ id: string }>();
  return <main className="container py-5">
    <AssigneeGate><AssignedDetailView key={params.id} episodeId={params.id} /></AssigneeGate>
  </main>;
}

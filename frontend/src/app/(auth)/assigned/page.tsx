"use client";

import { AssignedListView } from "@/components/AssignedViews";
import { AssigneeGate } from "@/components/OperatorGate";

export default function AssignedPage() {
  return <main className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · ASSIGNED</p>
    <h1 className="h2 mb-3">배정된 회차</h1>
    <AssigneeGate><AssignedListView /></AssigneeGate>
  </main>;
}

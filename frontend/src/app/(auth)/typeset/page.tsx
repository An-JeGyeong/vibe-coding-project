"use client";

import { TypesetterGate } from "@/components/OperatorGate";
import { TypesetListView } from "@/components/TypesetViews";

export default function TypesetPage() {
  return <main id="main-content" className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · TYPESETTING</p>
    <h1 className="h2 mb-3">식자 대기 목록</h1>
    <TypesetterGate><TypesetListView /></TypesetterGate>
  </main>;
}

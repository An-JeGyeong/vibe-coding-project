"use client";

import { OperatorGate } from "@/components/OperatorGate";
import { WorkAdminList } from "@/components/WorkAdminViews";

export default function WorksAdminPage() {
  return <main id="main-content" className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · WORKS</p>
    <h1 className="h2 mb-3">작품 관리</h1>
    <OperatorGate><WorkAdminList /></OperatorGate>
  </main>;
}

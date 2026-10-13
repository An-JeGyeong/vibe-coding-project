"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WorksBrowser } from "@/components/WorksBrowser";

function WorksFromAddress() {
  const params = useSearchParams();
  const sort = params.get("sort") === "popular" ? "popular" : "latest";
  return <WorksBrowser initialQuery={params.get("q") ?? ""} initialGenre={params.get("genre") ?? ""} initialSort={sort} />;
}

export default function WorksPage() {
  return <main id="main-content" className="container py-5">
    <h1 className="h2 mb-3">작품 찾기</h1>
    <Suspense fallback={<p role="status">불러오는 중…</p>}><WorksFromAddress /></Suspense>
  </main>;
}

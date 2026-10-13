"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RankingPage } from "@/components/RankingViews";
import { isPeriod } from "@/lib/ranking/types";

function RankingFromAddress() {
  const value = useSearchParams().get("period");
  return <RankingPage initialPeriod={isPeriod(value) ? value : "week"} />;
}

export default function RankingRoute() {
  return <main id="main-content" className="container py-5">
    <h1 className="h2 mb-3">랭킹</h1>
    <Suspense fallback={<p role="status">불러오는 중…</p>}><RankingFromAddress /></Suspense>
  </main>;
}

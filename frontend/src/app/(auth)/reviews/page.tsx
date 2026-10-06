"use client";

import { ReviewerGate } from "@/components/OperatorGate";
import { ReviewListView } from "@/components/ReviewViews";

export default function ReviewsPage() {
  return <main className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · REVIEWS</p>
    <h1 className="h2 mb-3">검수 대기 목록</h1>
    <ReviewerGate><ReviewListView /></ReviewerGate>
  </main>;
}

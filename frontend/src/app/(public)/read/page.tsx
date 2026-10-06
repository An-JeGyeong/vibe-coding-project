"use client";

import { PublicListView } from "@/components/PublicViews";

export default function ReadPage() {
  return <main className="container py-5">
    <p className="text-uppercase text-secondary small mb-1">MANGABRIDGE · READ</p>
    <h1 className="h2 mb-3">공개 회차</h1>
    <PublicListView />
  </main>;
}

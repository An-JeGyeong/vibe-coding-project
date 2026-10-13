"use client";

import { LibraryView } from "@/components/LibraryView";

export default function LibraryPage() {
  return <main id="main-content" className="container py-5">
    <h1 className="h2 mb-3">내 서재</h1>
    <p className="small text-secondary">이 브라우저에만 저장됩니다. 계정과는 연결되지 않습니다.</p>
    <LibraryView />
  </main>;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { coverUrl } from "@/lib/catalog/client";
import type { WorkSummary } from "@/lib/catalog/types";
import { BookmarkButton } from "./PersonalParts";

/** A cover from the public API, or a lettered placeholder when the work has none or the image fails. */
export function Cover({ workId, title, hasCover, className = "" }: { workId: string; title: string; hasCover: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!hasCover || failed) return <div className={`cover-placeholder ${className}`} role="img" aria-label={`${title} 표지 없음`}>{title.slice(0, 1)}</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a public image from another origin, shown as is
    <img className={`cover-img ${className}`} src={coverUrl(workId)} alt={`${title} 표지`} loading="lazy" onError={() => setFailed(true)} />
  );
}

export function GenreBadges({ genres }: { genres: string[] }) {
  return <>{genres.map((genre) => <span key={genre} className="badge text-bg-light border me-1">{genre}</span>)}</>;
}

export function WorkCard({ work }: { work: WorkSummary }) {
  return <Link href={`/works/${encodeURIComponent(work.workId)}`} className="work-card card h-100 text-decoration-none shadow-sm">
    <Cover workId={work.workId} title={work.title} hasCover={work.hasCover} className="work-card-cover" />
    <div className="card-body">
      <h3 className="h6 card-title mb-1">{work.title}</h3>
      <p className="small text-secondary mb-1">{work.author}</p>
      <p className="mb-1"><GenreBadges genres={work.genres} /></p>
      <p className="small text-secondary mb-0">{work.episodeCount}개 회차 · 조회 {work.views.toLocaleString("ko-KR")} · 추천 {work.recommendCount.toLocaleString("ko-KR")}</p>
    </div>
  </Link>;
}

export function WorkGrid({ works, label, ranked = false }: { works: WorkSummary[]; label: string; ranked?: boolean }) {
  return <ul className="list-unstyled row g-3" aria-label={label}>
    {works.map((work, index) => <li key={work.workId} className="col-6 col-md-4 col-lg-3 col-xl-2 position-relative">
      {ranked && <span className={`rank-badge${index < 3 ? " top" : ""}`} aria-hidden="true">{index + 1}</span>}
      <WorkCard work={work} />
      <BookmarkButton workId={work.workId} title={work.title} className="bookmark-corner" />
    </li>)}
  </ul>;
}

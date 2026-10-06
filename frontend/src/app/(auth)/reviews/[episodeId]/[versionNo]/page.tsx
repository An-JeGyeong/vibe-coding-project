"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReviewerGate } from "@/components/OperatorGate";
import { ReviewDetailView } from "@/components/ReviewViews";

export default function ReviewDetailPage() {
  const params = useParams<{ episodeId: string; versionNo: string }>();
  const versionNo = /^[1-9][0-9]{0,8}$/.test(params.versionNo) ? Number(params.versionNo) : null;
  return <main className="container py-5">
    <ReviewerGate>
      {versionNo === null
        ? <div className="alert alert-warning" role="alert">
          <p>배정되지 않았거나 존재하지 않는 항목입니다.</p>
          <Link href="/reviews" className="btn btn-outline-secondary">검수 대기 목록으로</Link>
        </div>
        : <ReviewDetailView key={`${params.episodeId}-${versionNo}`} episodeId={params.episodeId} versionNo={versionNo} />}
    </ReviewerGate>
  </main>;
}

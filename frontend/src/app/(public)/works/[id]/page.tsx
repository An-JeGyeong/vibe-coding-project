"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { WorkDetailView } from "@/components/WorkDetailView";

export default function WorkPage() {
  const params = useParams<{ id: string }>();
  const valid = /^[1-9][0-9]{0,17}$/.test(params.id);
  return <main id="main-content" className="container py-5">
    {valid
      ? <WorkDetailView key={params.id} workId={params.id} />
      : <div className="alert alert-warning" role="alert">
        <p>공개되지 않았거나 존재하지 않는 작품입니다.</p>
        <Link href="/" className="btn btn-outline-secondary">메인으로</Link>
      </div>}
  </main>;
}

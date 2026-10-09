"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { OperatorGate } from "@/components/OperatorGate";
import { WorkAdminEditor } from "@/components/WorkAdminViews";

export default function WorkAdminPage() {
  const params = useParams<{ id: string }>();
  const valid = /^[1-9][0-9]{0,17}$/.test(params.id);
  return <main id="main-content" className="container py-5">
    <OperatorGate>
      {valid
        ? <WorkAdminEditor key={params.id} workId={params.id} />
        : <div className="alert alert-warning" role="alert">
          <p>작품을 찾을 수 없습니다.</p>
          <Link href="/works-admin" className="btn btn-outline-secondary">작품 목록으로</Link>
        </div>}
    </OperatorGate>
  </main>;
}

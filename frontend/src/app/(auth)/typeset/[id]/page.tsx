"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { TypesetterGate } from "@/components/OperatorGate";
import { TypesetWorkspace } from "@/components/TypesetViews";

export default function TypesetEpisodePage() {
  const params = useParams<{ id: string }>();
  const valid = /^[1-9][0-9]{0,17}$/.test(params.id);
  return <main id="main-content" className="container py-5">
    <TypesetterGate>
      {valid
        ? <TypesetWorkspace key={params.id} episodeId={params.id} />
        : <div className="alert alert-warning" role="alert">
          <p>배정되지 않았거나 존재하지 않는 회차입니다.</p>
          <Link href="/typeset" className="btn btn-outline-secondary">식자 대기 목록으로</Link>
        </div>}
    </TypesetterGate>
  </main>;
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicEpisodeReader } from "@/components/PublicViews";
import { publicFailureMessage } from "@/lib/publication/messages";

export default function ReadEpisodePage() {
  const params = useParams<{ id: string }>();
  const valid = /^[1-9][0-9]{0,17}$/.test(params.id);
  return <main className="container py-5">
    {valid
      ? <PublicEpisodeReader key={params.id} episodeId={params.id} />
      : <div className="alert alert-warning" role="alert">
        <p>{publicFailureMessage({ kind: "not_found" })}</p>
        <Link href="/read" className="btn btn-outline-secondary">공개 회차 목록으로</Link>
      </div>}
  </main>;
}

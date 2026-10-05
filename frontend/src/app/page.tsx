"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkHealth, healthLabel, type HealthResult } from "@/lib/api";

export default function Home() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    const next = await checkHealth(signal);
    if (!signal?.aborted) { setResult(next); setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  return <main>
    <p className="eyebrow">MANGABRIDGE · PROJECT BOOTSTRAP</p>
    <h1>망가브릿지</h1>
    <p>로컬 서버와 데이터베이스 연결 상태를 확인합니다.</p>
    <section aria-label="헬스 체크">
      <h2>연결 상태</h2>
      <p role="status" aria-live="polite">{loading ? "확인 중…" : result ? healthLabel(result) : "확인 전"}</p>
      {result && result.kind !== "ERROR" && <p>확인 시각 (UTC): <time>{result.time}</time></p>}
      <button onClick={() => void refresh()} disabled={loading}>다시 확인</button>
    </section>
    <p><Link href="/login">데모 로그인</Link></p>
  </main>;
}

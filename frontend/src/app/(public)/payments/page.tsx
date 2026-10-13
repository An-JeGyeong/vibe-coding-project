"use client";

import Link from "next/link";

// There is no paid feature yet (CONTRACTS 28 scope: no membership or payment), so there is nothing to list and nothing is invented.
export default function PaymentsPage() {
  return <main id="main-content" className="container py-5">
    <h1 className="h2 mb-3">결제 내역</h1>
    <p className="text-secondary empty-note">결제 내역이 없습니다. 망가브릿지에는 아직 유료 기능이 없어 결제할 수 있는 항목이 없습니다.</p>
    <p><Link href="/my">마이페이지로</Link></p>
  </main>;
}

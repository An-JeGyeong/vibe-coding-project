import type { Decision } from "@/lib/translation/decision";
import type { TranslationBlock } from "@/lib/translation/types";

/** Read-only source / translation pairs, shared by the reviewer's detail page and the operator's overview. */
export function SideBySide({ blocks }: { blocks: TranslationBlock[] }) {
  return <ol className="list-unstyled">
    {blocks.map((block) => <li key={block.seq} className="border rounded p-2 mb-2">
      <div className="row g-2">
        <div className="col-md-6" style={{ whiteSpace: "pre-wrap" }}>
          {block.pageNo !== null && <span className="badge text-bg-secondary me-2">p.{block.pageNo}</span>}{block.source}
        </div>
        <div className="col-md-6" style={{ whiteSpace: "pre-wrap" }}>
          {block.text ?? <span className="text-secondary">(번역 없음)</span>}
        </div>
      </div>
    </li>)}
  </ol>;
}

/** The outcome of a review. A rejection always carries its reason; it is rendered as plain text. */
export function DecisionBox({ decision }: { decision: Decision | null }) {
  if (!decision) return null;
  const approved = decision.decision === "APPROVED";
  return <div className={`alert ${approved ? "alert-success" : "alert-warning"}`} role="status">
    <p className="mb-1"><strong>{approved ? "승인됨" : "반려됨"}</strong> · <time>{decision.decidedAt}</time></p>
    {!approved && <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>반려 사유: {decision.reason}</p>}
  </div>;
}

export const decisionLabel = (decision: Decision | null) => (decision ? (decision.decision === "APPROVED" ? "승인" : "반려") : "—");

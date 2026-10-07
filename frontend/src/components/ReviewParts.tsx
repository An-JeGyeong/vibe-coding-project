import type { BlockComment } from "@/lib/translation/comments";
import type { Decision } from "@/lib/translation/decision";
import type { TranslationBlock } from "@/lib/translation/types";

/** Read-only source / translation pairs, shared by the reviewer's detail page and the operator's overview. */
export type CommentEditor = { values: Record<number, string>; errors: Record<number, string>; max: number; onChange: (seq: number, text: string) => void };

export function SideBySide({ blocks, comments = [], editor }: { blocks: TranslationBlock[]; comments?: BlockComment[]; editor?: CommentEditor }) {
  const remark = (seq: number) => comments.find((comment) => comment.seq === seq);
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
      {remark(block.seq) && <div className="alert alert-warning py-1 px-2 mt-2 mb-0 small" style={{ whiteSpace: "pre-wrap" }}>감수 의견: {remark(block.seq)!.text}</div>}
      {editor && <div className="mt-2">
        <label className="form-label small mb-1" htmlFor={`comment-${block.seq}`}>블록 {block.seq} 의견 (선택, {editor.max}자 이하)</label>
        <textarea id={`comment-${block.seq}`} className="form-control form-control-sm" rows={2} value={editor.values[block.seq] ?? ""}
          aria-invalid={editor.errors[block.seq] ? true : undefined} onChange={(event) => editor.onChange(block.seq, event.target.value)} />
        {editor.errors[block.seq] && <p className="text-danger small mt-1 mb-0" role="alert">{editor.errors[block.seq]}</p>}
      </div>}
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

/** One-line summary of a rejection reason for list rows (plain text, truncated by code points). */
export function decisionSummary(decision: Decision | null) {
  if (!decision || decision.decision !== "REJECTED" || !decision.reason) return null;
  const points = Array.from(decision.reason.replace(/\s+/g, " ").trim());
  return `사유: ${points.slice(0, 40).join("")}${points.length > 40 ? "…" : ""}`;
}

export const decisionLabel = (decision: Decision | null) => (decision ? (decision.decision === "APPROVED" ? "승인" : "반려") : "—");

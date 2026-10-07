import { STATUS_LABEL, type TranslationStatus } from "@/lib/translation/types";

// One colour per translation status everywhere a status is listed, so the same state always looks the same.
const TONE: Record<TranslationStatus, string> = {
  DRAFT: "secondary", REVIEW_PENDING: "info", REJECTED: "danger", APPROVED: "success",
  PUBLISHED: "primary", INVALIDATED: "dark", ON_HOLD: "warning",
};

export function StatusBadge({ status }: { status: TranslationStatus }) {
  return <span className={`badge text-bg-${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

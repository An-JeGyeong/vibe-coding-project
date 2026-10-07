import type { HistoryItem } from "./types";

// Fixed Korean wording for each event (CONTRACTS 24.3). Unknown events are shown as "기타 작업"; server text is never used as wording.
export const EVENT_LABEL: Record<string, string> = {
  EPISODE_CREATED: "회차 생성",
  SOURCE_SAVED: "원문 저장",
  ASSIGNED: "담당자 배정",
  TRANSLATION_CREATED: "번역 시작",
  TRANSLATION_SUBMITTED: "번역 제출",
  REVIEW_APPROVED: "번역 승인",
  REVIEW_REJECTED: "번역 반려",
  APPROVAL_INVALIDATED: "번역 승인 무효화",
  TRANSLATION_PUBLISHED: "번역 발행",
  PUBLICATION_HELD: "공개 보류",
  PUBLICATION_RESUMED: "공개 재개",
};

export function describeEvent(item: HistoryItem): string {
  const base = EVENT_LABEL[item.event];
  if (!base) return "기타 작업";
  const version = item.translationVersionNo === null ? "" : ` v${item.translationVersionNo}`;
  switch (item.event) {
    case "SOURCE_SAVED": return item.sourceVersion === null ? base : `${base} (v${item.sourceVersion})`;
    case "ASSIGNED": return `${base} → ${item.subject?.displayName ?? "알 수 없음"}`;
    case "TRANSLATION_CREATED": return `번역${version} 시작`;
    case "TRANSLATION_SUBMITTED": return `번역${version} 제출`;
    case "REVIEW_APPROVED": return `번역${version} 승인`;
    case "REVIEW_REJECTED": return `번역${version} 반려`;
    case "APPROVAL_INVALIDATED": return `번역${version} 승인 무효화`;
    case "TRANSLATION_PUBLISHED": return `번역${version} 발행`;
    case "PUBLICATION_HELD": return version ? `${base} (번역${version})` : base;
    case "PUBLICATION_RESUMED": return version ? `${base} (번역${version})` : base;
    default: return base;
  }
}

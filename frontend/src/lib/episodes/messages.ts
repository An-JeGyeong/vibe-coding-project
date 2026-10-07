import { failureMessage } from "@/lib/auth/messages";
import type { EpisodeFailure } from "./types";

// Fixed local messages; server-provided text is never rendered.
export function episodeFailureMessage(failure: EpisodeFailure): string {
  switch (failure.kind) {
    case "not_found": return "요청한 회차 또는 원문 버전을 찾을 수 없습니다.";
    case "conflict": return failure.latestVersion === null
      ? "다른 곳에서 원문이 변경되었습니다. 최신 버전을 불러온 뒤 다시 저장하세요."
      : `다른 곳에서 원문이 변경되었습니다(최신 버전 ${failure.latestVersion}). 최신 버전을 불러온 뒤 다시 저장하세요.`;
    case "revision_conflict": return "다른 곳에서 번역이 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장하세요.";
    case "state_conflict": return failure.currentStatus === "INVALIDATED"
      ? "원문이 변경되어 이 번역은 무효화되었습니다. 새 번역을 시작하세요."
      : failure.currentStatus === "REVIEW_PENDING" ? "이미 검수에 제출된 번역입니다."
      : "번역 상태가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.";
    case "ai_unavailable": return "AI 초안을 만들지 못했습니다. 직접 번역할 수 있습니다.";
    case "incomplete": return `번역하지 않은 블록이 ${failure.missingSeqs.length}개 있습니다. 모든 블록을 번역한 뒤 제출하세요.`;
    case "unavailable": return "서비스를 사용할 수 없습니다. 잠시 후 다시 시도하세요.";
    case "invalid_request": return "입력값이 서버 규칙에 맞지 않습니다. 내용을 확인하세요.";
    default: return failureMessage(failure);
  }
}

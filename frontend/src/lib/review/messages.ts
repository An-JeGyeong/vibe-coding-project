import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";

// Reviewer-facing wording: the generic episode messages address the translator ("start a new translation").
export function reviewFailureMessage(failure: EpisodeFailure): string {
  if (failure.kind === "state_conflict") {
    if (failure.currentStatus === "APPROVED" || failure.currentStatus === "REJECTED") return "이미 처리된 번역입니다. 새로고침해 결과를 확인하세요.";
    if (failure.currentStatus === "INVALIDATED") return "원문이 변경되어 이 번역은 무효화되었습니다. 더 이상 승인하거나 반려할 수 없습니다.";
    return "번역 상태가 바뀌었습니다. 새로고침한 뒤 다시 확인하세요.";
  }
  if (failure.kind === "not_found") return "배정되지 않았거나 존재하지 않는 항목입니다.";
  if (failure.kind === "forbidden") return "이 번역을 처리할 권한이 없습니다. 로그인 상태는 유지됩니다.";
  return episodeFailureMessage(failure);
}

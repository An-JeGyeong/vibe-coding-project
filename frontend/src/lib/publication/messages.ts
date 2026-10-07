import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";

// Operator-facing wording for publishing; fixed local text, server text is never rendered.
export function publicationFailureMessage(failure: EpisodeFailure): string {
  if (failure.kind === "state_conflict") {
    if (failure.currentStatus === "PUBLISHED") return "이미 발행된 번역입니다. 새로고침해 공개 상태를 확인하세요.";
    if (failure.currentStatus === "INVALIDATED") return "원문이 변경되어 이 번역의 승인이 무효화되었습니다. 발행할 수 없습니다.";
    return "승인된 번역만 발행할 수 있습니다. 번역 상태가 바뀌었으니 새로고침해 확인하세요.";
  }
  if (failure.kind === "not_found") return "요청한 회차 또는 번역 버전을 찾을 수 없습니다.";
  if (failure.kind === "forbidden") return "발행할 권한이 없습니다. 로그인 상태는 유지됩니다.";
  return episodeFailureMessage(failure);
}

// Hold / resume wording: a conflict means the public state is no longer what the operator saw.
export function holdResumeFailureMessage(failure: EpisodeFailure, action: "hold" | "resume"): string {
  if (failure.kind === "state_conflict") {
    if (action === "hold") {
      if (failure.currentStatus === "ON_HOLD") return "이미 보류 중입니다. 새로고침해 공개 상태를 확인하세요.";
      return "보류할 공개 중인 번역이 없습니다. 새로고침해 공개 상태를 확인하세요.";
    }
    if (failure.currentStatus === "PUBLISHED") return "이미 공개 중입니다. 새로고침해 공개 상태를 확인하세요.";
    return "재개할 보류 중인 번역이 없습니다. 새로고침해 공개 상태를 확인하세요.";
  }
  if (failure.kind === "forbidden") return "이 작업을 할 권한이 없습니다. 로그인 상태는 유지됩니다.";
  return publicationFailureMessage(failure);
}

export function publicFailureMessage(failure: EpisodeFailure): string {
  if (failure.kind === "not_found") return "공개되지 않았거나 존재하지 않는 회차입니다.";
  return episodeFailureMessage(failure);
}

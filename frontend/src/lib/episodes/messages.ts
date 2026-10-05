import { failureMessage } from "@/lib/auth/messages";
import type { EpisodeFailure } from "./types";

// Fixed local messages; server-provided text is never rendered.
export function episodeFailureMessage(failure: EpisodeFailure): string {
  switch (failure.kind) {
    case "not_found": return "요청한 회차 또는 원문 버전을 찾을 수 없습니다.";
    case "conflict": return failure.latestVersion === null
      ? "다른 곳에서 원문이 변경되었습니다. 최신 버전을 불러온 뒤 다시 저장하세요."
      : `다른 곳에서 원문이 변경되었습니다(최신 버전 ${failure.latestVersion}). 최신 버전을 불러온 뒤 다시 저장하세요.`;
    case "unavailable": return "서비스를 사용할 수 없습니다. 잠시 후 다시 시도하세요.";
    case "invalid_request": return "입력값이 서버 규칙에 맞지 않습니다. 내용을 확인하세요.";
    default: return failureMessage(failure);
  }
}

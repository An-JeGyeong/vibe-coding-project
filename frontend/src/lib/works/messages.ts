import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";

// Fixed wording; server text is never shown. A "state_conflict" carries the server's reason code in currentStatus.
export function workFailureMessage(failure: EpisodeFailure): string {
  if (failure.kind === "revision_conflict") return "다른 곳에서 작품이 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장하세요. 입력 중인 내용은 불러오기 전까지 유지됩니다.";
  if (failure.kind === "state_conflict") {
    if (failure.currentStatus === "BANNER_LIMIT") return "배너는 동시에 5개까지만 둘 수 있습니다. 다른 작품의 배너를 먼저 해제하세요.";
    if (failure.currentStatus === "COVER_REQUIRED") return "표지가 있는 작품만 배너로 둘 수 있습니다. 표지를 먼저 올리세요.";
    if (failure.currentStatus === "EPISODE_NO_TAKEN") return "이 작품에서 이미 쓰고 있는 회차 번호입니다. 다른 번호를 입력하세요.";
    return "작품 상태가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.";
  }
  if (failure.kind === "invalid_request") return "입력값이 서버 규칙에 맞지 않습니다. 제목·작가·소개·장르를 확인하세요.";
  if (failure.kind === "not_found") return "작품 또는 회차를 찾을 수 없습니다.";
  if (failure.kind === "forbidden") return "작품을 관리할 권한이 없습니다. 로그인 상태는 유지됩니다.";
  return episodeFailureMessage(failure);
}

export function coverUploadMessage(failure: EpisodeFailure): string {
  if (failure.kind === "invalid_request") return "표지를 저장할 수 없습니다. 형식(PNG·JPEG·WEBP)과 크기(5 MiB 이하)를 확인하세요.";
  return workFailureMessage(failure);
}

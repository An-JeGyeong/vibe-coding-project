import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";

// Fixed wording; server text is never shown.
export function pageImageViewMessage(failure: EpisodeFailure): string {
  if (failure.kind === "not_found") return "이 페이지에는 원본 이미지가 없습니다.";
  if (failure.kind === "forbidden") return "이미지를 볼 권한이 없습니다.";
  if (failure.kind === "unavailable" || failure.kind === "network" || failure.kind === "timeout") return "이미지를 불러오지 못했습니다.";
  return "이미지를 불러오지 못했습니다.";
}

export function pageImageUploadMessage(failure: EpisodeFailure): string {
  if (failure.kind === "invalid_request") return "이미지를 저장할 수 없습니다. 형식(PNG·JPEG·WEBP)과 크기(5 MiB 이하)를 확인하세요.";
  if (failure.kind === "not_found") return "원문에 없는 페이지입니다. 원문의 페이지 번호를 확인하세요.";
  if (failure.kind === "forbidden") return "이미지를 올릴 권한이 없습니다. 로그인 상태는 유지됩니다.";
  return episodeFailureMessage(failure);
}

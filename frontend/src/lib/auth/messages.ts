import type { ApiFailure } from "./types";

export function formatRetryTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("ko-KR", { hour12: false });
}

export type FailureContext = { retryAt?: number | null };

// Fixed local messages; server-provided text is never rendered.
export function failureMessage(failure: ApiFailure | { kind: "storage" }, context: FailureContext = {}): string {
  switch (failure.kind) {
    case "invalid_request": return "입력값이 올바르지 않습니다. 로그인 ID와 비밀번호를 확인하세요.";
    case "unauthorized": return failure.code === "AUTH_REQUIRED"
      ? "인증이 만료되었거나 유효하지 않습니다. 다시 로그인하세요."
      : "로그인 ID 또는 비밀번호가 올바르지 않습니다.";
    case "forbidden": return "이 작업을 수행할 권한이 없습니다. 로그인 상태는 유지됩니다.";
    case "rate_limited": return context.retryAt != null
      ? `로그인 시도가 너무 많습니다. ${formatRetryTime(context.retryAt)} 이후에 다시 시도하세요.`
      : "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.";
    case "unavailable": return "인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도하세요.";
    case "server_error": return "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
    case "network": return "서버에 연결할 수 없습니다. 네트워크와 API 실행 상태를 확인하세요.";
    case "timeout": return "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.";
    case "invalid_response": return "서버 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.";
    case "misconfigured": return "NEXT_PUBLIC_API_BASE_URL 환경변수가 필요합니다.";
    case "storage": return "브라우저 세션 저장소를 사용할 수 없어 로그인을 완료할 수 없습니다. 브라우저 설정을 확인하세요.";
    case "aborted": return "요청이 취소되었습니다.";
  }
}

export type AuthNotice = "expired" | "unauthorized" | "logged_out" | "logout_unconfirmed" | "storage_error";

export const NOTICE_MESSAGE: Record<AuthNotice, string> = {
  expired: "세션이 만료되었습니다. 다시 로그인하세요.",
  unauthorized: "인증이 만료되었거나 유효하지 않습니다. 다시 로그인하세요.",
  logged_out: "로그아웃되었습니다.",
  logout_unconfirmed: "이 브라우저에서는 로그아웃했지만 서버 로그아웃을 확인하지 못했습니다. 토큰은 만료 시각까지 서버에서 유효할 수 있습니다.",
  storage_error: "브라우저 세션 저장소에 접근할 수 없어 로그인 상태를 확인하지 못했습니다.",
};

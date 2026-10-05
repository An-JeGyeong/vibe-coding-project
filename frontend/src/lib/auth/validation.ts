// Mirrors the approved DemoAuth contract. Inputs are validated as typed: no trim, no case folding.
export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const PASSWORD_MAX_BYTES = 72;

export function validateLoginId(value: string): string | null {
  if (value.length === 0) return "로그인 ID를 입력하세요.";
  if (!LOGIN_ID_PATTERN.test(value)) {
    return "로그인 ID는 3~64자의 소문자·숫자·점(.)·밑줄(_)·하이픈(-)이며 첫 글자는 소문자 또는 숫자여야 합니다.";
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) return "비밀번호를 입력하세요.";
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return `비밀번호는 UTF-8 기준 ${PASSWORD_MAX_BYTES}바이트 이하여야 합니다.`;
  }
  return null;
}

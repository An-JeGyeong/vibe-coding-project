// The sign-up rules of CONTRACTS 32.2, checked here so a mistake is shown before the request; the server checks them again.
export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{3,19}$/;
export const RESERVED_PREFIX = "demo.";
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX_BYTES = 72;
export const NAME_MAX = 20;
export const BIO_MAX = 100;
const COMMON = new Set([
  "1234567890", "12345678901", "123456789012", "0123456789", "0987654321", "9876543210", "1111111111", "0000000000",
  "password", "password1", "password12", "password123", "passw0rd12", "qwertyuiop", "qwerty1234", "qwerty12345",
  "asdfghjkl1", "abcdefghij", "abcd123456", "iloveyou12", "admin12345", "welcome123", "letmein123", "changeme123",
]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const length = (value: string) => [...value].length;

export function loginIdProblem(value: string): string | null {
  if (value.startsWith(RESERVED_PREFIX)) return `"${RESERVED_PREFIX}"로 시작하는 아이디는 쓸 수 없습니다.`;
  return LOGIN_ID_PATTERN.test(value) ? null : "아이디는 영어 소문자·숫자와 . _ - 로 4~20자여야 하고 문자나 숫자로 시작해야 합니다.";
}

export function passwordProblem(loginId: string, value: string): string | null {
  if (value.trim() === "" || length(value) < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return `비밀번호가 너무 깁니다(${PASSWORD_MAX_BYTES}바이트 이하).`;
  const lower = value.toLowerCase();
  if (loginId !== "" && lower.includes(loginId.toLowerCase())) return "비밀번호에 아이디를 넣을 수 없습니다.";
  if (COMMON.has(lower) || new Set([...value]).size <= 1) return "너무 흔하거나 단순한 비밀번호입니다.";
  return null;
}

export function nameProblem(value: string): string | null {
  const name = value.trim();
  if (name === "" || length(name) > NAME_MAX) return `표시 이름은 1~${NAME_MAX}자여야 합니다.`;
  return CONTROL.test(name) ? "사용할 수 없는 문자가 들어 있습니다." : null;
}

export function bioProblem(value: string): string | null {
  const text = value.trim();
  if (length(text) > BIO_MAX) return `소개는 ${BIO_MAX}자 이하여야 합니다.`;
  return CONTROL.test(text) ? "사용할 수 없는 문자가 들어 있습니다(줄바꿈 포함)." : null;
}

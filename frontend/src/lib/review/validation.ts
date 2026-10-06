// Mirrors CONTRACTS.md 18.2 (rejection reason). Advisory only: the server validates again.
// No trimming or normalisation is applied to anything the reviewer typed.
export const REASON_MAX = 500;

const CONTROL_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export function validateReason(value: string): string | null {
  if (value.length === 0 || /^\s*$/u.test(value)) return "반려 사유를 입력하세요.";
  if (Array.from(value).length > REASON_MAX) return `반려 사유는 ${REASON_MAX}자 이하여야 합니다.`;
  if (CONTROL_EXCEPT_LINE_BREAKS.test(value)) return "반려 사유에 허용되지 않는 제어문자가 있습니다.";
  return null;
}

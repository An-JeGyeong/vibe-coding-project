// Mirrors CONTRACTS.md 13.3. Advisory only: the server validates again and has the last word.
// No trimming or normalisation is applied to anything the user typed.
export const TITLE_MAX = 100;
export const BLOCK_TEXT_MAX = 2000;
export const BLOCKS_MAX = 200;
export const PAGE_MAX = 9999;

const codePoints = (value: string) => Array.from(value).length;
const isBlank = (value: string) => /^\s*$/u.test(value);
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;
const CONTROL_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export function validateTitle(value: string): string | null {
  if (value.length === 0 || isBlank(value)) return "제목을 입력하세요.";
  if (codePoints(value) > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`;
  if (CONTROL.test(value)) return "제목에 제어문자를 넣을 수 없습니다.";
  return null;
}

export function validateBlockText(value: string): string | null {
  if (value.length === 0 || isBlank(value)) return "텍스트를 입력하세요.";
  if (codePoints(value) > BLOCK_TEXT_MAX) return `블록 텍스트는 ${BLOCK_TEXT_MAX}자 이하여야 합니다.`;
  if (CONTROL_EXCEPT_LINE_BREAKS.test(value)) return "텍스트에 허용되지 않는 제어문자가 있습니다.";
  return null;
}

/** Empty input means "no page number". Returns the parsed value or an error message. */
export function parsePageNo(value: string): { value: number | null; error: string | null } {
  if (value === "") return { value: null, error: null };
  if (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > PAGE_MAX) {
    return { value: null, error: `페이지 번호는 1~${PAGE_MAX}의 정수여야 합니다.` };
  }
  return { value: Number(value), error: null };
}

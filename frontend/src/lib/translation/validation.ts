// Mirrors CONTRACTS.md 17.3. Advisory only: the server validates again and has the last word.
// No trimming or normalisation is applied to anything the user typed.
export const TRANSLATION_TEXT_MAX = 4000;

const codePoints = (value: string) => Array.from(value).length;
const CONTROL_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/** An empty field means "not translated yet" and is valid on save; anything typed must satisfy the rules. */
export function validateTranslationText(value: string): string | null {
  if (value === "") return null;
  if (/^\s*$/u.test(value)) return "공백만 입력할 수 없습니다.";
  if (codePoints(value) > TRANSLATION_TEXT_MAX) return `번역은 ${TRANSLATION_TEXT_MAX}자 이하여야 합니다.`;
  if (CONTROL_EXCEPT_LINE_BREAKS.test(value)) return "허용되지 않는 제어문자가 있습니다.";
  return null;
}

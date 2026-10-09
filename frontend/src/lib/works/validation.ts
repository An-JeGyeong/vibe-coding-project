import { GENRES } from "@/lib/catalog/types";
import { MAX_GENRES, type WorkInput } from "./types";

export type WorkErrors = Partial<Record<"title" | "author" | "description" | "genres", string>>;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // line breaks are allowed in the description

// Advisory local checks mirroring CONTRACTS 28.3 (the server validates again).
export function validateWork(input: Pick<WorkInput, "title" | "author" | "description" | "genres">): WorkErrors {
  const errors: WorkErrors = {};
  const title = input.title.trim(), author = input.author.trim();
  if (title.length < 1 || title.length > 100) errors.title = "제목은 1~100자로 입력하세요.";
  else if (CONTROL.test(title)) errors.title = "제목에 쓸 수 없는 문자가 있습니다.";
  if (author.length < 1 || author.length > 100) errors.author = "작가는 1~100자로 입력하세요.";
  else if (CONTROL.test(author)) errors.author = "작가에 쓸 수 없는 문자가 있습니다.";
  if (input.description.length > 2000) errors.description = "소개는 2000자 이하여야 합니다.";
  else if (CONTROL.test(input.description)) errors.description = "소개에 쓸 수 없는 문자가 있습니다.";
  const known = input.genres.every((genre) => (GENRES as readonly string[]).includes(genre));
  if (input.genres.length < 1 || input.genres.length > MAX_GENRES || new Set(input.genres).size !== input.genres.length || !known) errors.genres = `장르를 1~${MAX_GENRES}개 고르세요.`;
  return errors;
}

/** The body sent to the server: text trimmed, genres in the fixed list order. */
export function normalizeWork(input: WorkInput): WorkInput {
  return { ...input, title: input.title.trim(), author: input.author.trim(), genres: GENRES.filter((genre) => input.genres.includes(genre)) };
}

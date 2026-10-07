import { isRecord } from "@/lib/auth/client";
import { isInt, isStr, isTime } from "@/lib/episodes/client";

// A reviewer's per-block remark on a rejected version (CONTRACTS 22.2). Only ever rendered as plain text.
export type BlockComment = { seq: number; text: string; createdAt: string };

/** Absent or null means no comments; anything malformed is rejected (null). */
export function parseBlockComments(value: unknown): BlockComment[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const result: BlockComment[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isInt(item.seq) || !isStr(item.text) || !isTime(item.createdAt)) return null;
    result.push({ seq: item.seq, text: item.text, createdAt: item.createdAt });
  }
  return result;
}

import type { Publication } from "@/lib/publication/types";

// Dashboard status chips (CONTRACTS 23.4). Pure: derived from lists the server already returned.
type Version = { versionNo: number; status: string };
export type Chip = { label: string; tone: "primary" | "success" | "warning" | "secondary" | "danger" | "info" };

/** Operator: the most relevant state of an episode, publication first, then what needs a decision. */
export function operatorChip(versions: Version[], publication: Publication | null): Chip {
  if (publication?.current) return { label: "공개 중", tone: "success" };
  if (publication?.held) return { label: "보류 중", tone: "warning" };
  if (versions.some((version) => version.status === "APPROVED")) return { label: "발행 대기(승인됨)", tone: "primary" };
  if (versions.some((version) => version.status === "REVIEW_PENDING")) return { label: "검수 대기", tone: "info" };
  if (versions.some((version) => version.status === "DRAFT")) return { label: "작성 중", tone: "secondary" };
  return { label: "번역 없음", tone: "secondary" };
}

/** Translator: the state of the latest version (highest versionNo). */
export function translatorChip(versions: Version[]): Chip {
  const latest = [...versions].sort((a, b) => b.versionNo - a.versionNo)[0];
  if (!latest) return { label: "시작 전", tone: "secondary" };
  switch (latest.status) {
    case "DRAFT": return { label: "작성 중", tone: "secondary" };
    case "REVIEW_PENDING": return { label: "검수 대기", tone: "info" };
    case "REJECTED": return { label: "반려됨", tone: "danger" };
    case "APPROVED": return { label: "승인됨", tone: "success" };
    case "PUBLISHED": return { label: "발행됨", tone: "success" };
    case "ON_HOLD": return { label: "보류", tone: "warning" };
    case "INVALIDATED": return { label: "무효화됨", tone: "warning" };
    default: return { label: "시작 전", tone: "secondary" };
  }
}

export function translatorSummary(chips: Chip[]): { rejected: number; drafting: number; notStarted: number } {
  return {
    rejected: chips.filter((chip) => chip.label === "반려됨").length,
    drafting: chips.filter((chip) => chip.label === "작성 중").length,
    notStarted: chips.filter((chip) => chip.label === "시작 전").length,
  };
}

/** Runs the tasks with at most `limit` in flight; results keep the input order. */
export async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

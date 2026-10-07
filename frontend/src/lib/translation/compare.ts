// Block-level comparison of two translation versions of one episode (CONTRACTS 23.1). Pure: no I/O.
export type CompareBlock = { seq: number; text: string | null };
export type BlockChange = "same" | "changed" | "added" | "removed";
export type CompareRow = { seq: number; change: BlockChange; before: string | null; after: string | null };
export type CompareSummary = { changed: number; added: number; removed: number; same: number };

/** Aligns both versions by seq; a block without a translation is compared as empty text. */
export function compareBlocks(older: CompareBlock[], newer: CompareBlock[]): CompareRow[] {
  const before = new Map(older.map((block) => [block.seq, block.text ?? ""]));
  const after = new Map(newer.map((block) => [block.seq, block.text ?? ""]));
  const seqs = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  return seqs.map((seq) => {
    const left = before.get(seq);
    const right = after.get(seq);
    if (left === undefined) return { seq, change: "added" as const, before: null, after: right ?? "" };
    if (right === undefined) return { seq, change: "removed" as const, before: left, after: null };
    return { seq, change: left === right ? ("same" as const) : ("changed" as const), before: left, after: right };
  });
}

export function summarizeCompare(rows: CompareRow[]): CompareSummary {
  const summary: CompareSummary = { changed: 0, added: 0, removed: 0, same: 0 };
  for (const row of rows) summary[row.change]++;
  return summary;
}

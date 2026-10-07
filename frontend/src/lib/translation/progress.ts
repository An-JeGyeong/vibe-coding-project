// Translation progress (CONTRACTS 23.2): blocks whose translation is not blank / all blocks. Same rule as submitting.
export type Progress = { done: number; total: number; percent: number };

/** With `texts` (the translator typing), the typed value wins over the saved one for the blocks it covers. */
export function translationProgress(blocks: { seq: number; text: string | null }[], texts?: Record<number, string>): Progress {
  const total = blocks.length;
  const done = blocks.filter((block) => ((texts ? texts[block.seq] ?? block.text : block.text) ?? "").trim() !== "").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

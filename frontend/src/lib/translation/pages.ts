// Groups the blocks of a version by their page (CONTRACTS 26.4). Pure: no I/O.
export type PageGroup<T> = { pageNo: number | null; label: string; blocks: T[] };

export const pageLabel = (pageNo: number | null) => (pageNo === null ? "페이지 미지정" : `p.${pageNo}`);

/** Pages in ascending order; blocks without a page number form one "unassigned" group at the end. Blocks keep their order. */
export function groupByPage<T extends { seq: number; pageNo: number | null }>(blocks: T[]): PageGroup<T>[] {
  const byPage = new Map<number | null, T[]>();
  for (const block of blocks) {
    const list = byPage.get(block.pageNo);
    if (list) list.push(block); else byPage.set(block.pageNo, [block]);
  }
  const numbered = [...byPage.keys()].filter((key): key is number => key !== null).sort((a, b) => a - b);
  const keys: (number | null)[] = byPage.has(null) ? [...numbered, null] : numbered;
  return keys.map((pageNo) => ({ pageNo, label: pageLabel(pageNo), blocks: byPage.get(pageNo)! }));
}

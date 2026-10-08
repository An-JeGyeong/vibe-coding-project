/** Pages that carry a page number in the source but have no translated image yet (CONTRACTS 27.4: shown in the publish confirmation, never blocks it). */
export function missingImagePages(blocks: { pageNo: number | null }[], imagePages: number[]): number[] {
  const have = new Set(imagePages);
  const pages = [...new Set(blocks.map((block) => block.pageNo).filter((page): page is number => page !== null))].sort((a, b) => a - b);
  return pages.filter((page) => !have.has(page));
}

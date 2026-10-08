// Page-turning rules of the manga viewer (CONTRACTS 27.4). Pure functions, so the direction rule has one definition.
export type Direction = "rtl" | "ltr"; // rtl: right-to-left (Japanese manga, the default)
export type ViewMode = "scroll" | "page";
export type Step = 1 | -1; // 1: toward the end of the episode

/** Page numbers grouped into what is shown at once. A spread keeps the first page alone (the cover) and then pairs. */
export function buildUnits(pages: number[], spread: boolean): number[][] {
  if (!spread) return pages.map((page) => [page]);
  const units: number[][] = [];
  for (let index = 0; index < pages.length;) {
    const size = index === 0 ? 1 : 2;
    units.push(pages.slice(index, index + size));
    index += size;
  }
  return units;
}

export function unitIndexOf(units: number[][], pageNo: number): number {
  const found = units.findIndex((unit) => unit.includes(pageNo));
  return found < 0 ? 0 : found;
}

/** rtl: the LEFT area / left arrow key goes forward; ltr: the RIGHT one does. */
export function stepForSide(side: "left" | "right", direction: Direction): Step {
  return (side === "left") === (direction === "rtl") ? 1 : -1;
}

export function stepForKey(key: string, direction: Direction): Step | null {
  if (key === "ArrowLeft") return stepForSide("left", direction);
  if (key === "ArrowRight") return stepForSide("right", direction);
  return null;
}

const SWIPE_MIN = 50;
/** A horizontal swipe. Like turning a book: rtl advances when the page is dragged to the right, ltr when it is dragged to the left. */
export function stepForSwipe(dx: number, dy: number, direction: Direction): Step | null {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return null; // short or mostly vertical: a normal scroll
  return (dx > 0) === (direction === "rtl") ? 1 : -1;
}

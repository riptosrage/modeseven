/** A rectangle in grid cells. x/y are the top-left cell, w/h are spans. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** id → rect. One layout per layer per column count. */
export type Layout = Record<string, Rect>;

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const sameRect = (a: Rect | undefined, b: Rect | undefined) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Keep a rect inside the board: width at most `cols`, x within columns, y never negative. */
export function clampRect(r: Rect, cols: number): Rect {
  const w = clamp(Math.round(r.w), 1, cols);
  const h = Math.max(1, Math.round(r.h));
  return { x: clamp(Math.round(r.x), 0, cols - w), y: Math.max(0, Math.round(r.y)), w, h };
}

/** Lowest occupied row + 1. */
export function bottom(layout: Layout): number {
  let b = 0;
  for (const id in layout) b = Math.max(b, layout[id].y + layout[id].h);
  return b;
}

/** True if no two rects overlap and all are within the columns. Used by tests and dev asserts. */
export function isValid(layout: Layout, cols: number): boolean {
  const ids = Object.keys(layout);
  for (let i = 0; i < ids.length; i++) {
    const a = layout[ids[i]];
    if (a.x < 0 || a.y < 0 || a.w < 1 || a.h < 1 || a.x + a.w > cols) return false;
    for (let j = i + 1; j < ids.length; j++) if (overlaps(a, layout[ids[j]])) return false;
  }
  return true;
}

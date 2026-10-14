import { type Layout, type Rect, type Size, bottom, clampRect, overlaps } from './geometry';
import { Occupancy } from './occupancy';

/**
 * Pegboard placement. Nothing has gravity: modules stay exactly where they
 * are put. When a module is moved or resized onto others, only the modules it
 * actually covers move, each to the nearest free spot. Nothing cascades.
 *
 * Always call these against the layout from the START of a gesture, never the
 * previous preview. That way modules pushed aside return home when the
 * dragged module moves on.
 */

/** Distance cost for relocating a displaced module. Slight preference for moving down over up. */
function cost(x: number, y: number, from: { x: number; y: number }) {
  const dx = x - from.x;
  const dy = y - from.y;
  return Math.hypot(dx, dy * (dy < 0 ? 1.15 : 1));
}

/** Nearest free top-left for `size`, searching outward from `near`. Always succeeds (the board is infinite downward). */
export function nearestFree(occ: Occupancy, size: Size, near: { x: number; y: number }): { x: number; y: number } {
  const cols = occ.cols;
  const w = Math.min(size.w, cols);
  const maxY = Math.max(occ.height, near.y) + size.h + 1;
  let best: { x: number; y: number } | null = null;
  let bestCost = Infinity;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const c = cost(x, y, near);
      if (c >= bestCost) continue;
      if (occ.isFree({ x, y, w, h: size.h })) {
        best = { x, y };
        bestCost = c;
      }
    }
  }
  return best ?? { x: 0, y: maxY };
}

/** First free spot in reading order (left to right, top to bottom). */
export function firstFree(layout: Layout, size: Size, cols: number): { x: number; y: number } {
  const occ = Occupancy.from(layout, cols);
  const w = Math.min(size.w, cols);
  for (let y = 0; ; y++) for (let x = 0; x <= cols - w; x++) if (occ.isFree({ x, y, w, h: size.h })) return { x, y };
}

/**
 * Put module `id` at `target` (a move, a resize, or both) and relocate only
 * the modules it now covers. If exactly one module is covered and it fits in
 * the space `id` just left, the two swap.
 */
export function place(layout: Layout, id: string, target: Rect, cols: number): Layout {
  const t = clampRect(target, cols);
  const out: Layout = { ...layout, [id]: t };
  const origin = layout[id];

  const displaced = Object.keys(layout)
    .filter((k) => k !== id && overlaps(layout[k], t))
    .sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x);
  if (!displaced.length) return out;

  const moving = new Set(displaced);
  const occ = Occupancy.from(out, cols, (k) => moving.has(k));

  // Swap: one module covered, and it fits where we came from.
  if (displaced.length === 1 && origin) {
    const d = layout[displaced[0]];
    const spot = { x: origin.x, y: origin.y, w: d.w, h: d.h };
    if (spot.x + spot.w <= cols && occ.isFree(spot)) {
      out[displaced[0]] = spot;
      return out;
    }
  }

  for (const k of displaced) {
    const r = layout[k];
    const p = nearestFree(occ, r, r);
    const nr = { x: p.x, y: p.y, w: Math.min(r.w, cols), h: r.h };
    out[k] = nr;
    occ.fill(nr);
  }
  return out;
}

/** Add a new module. With a target rect it goes there (pushing others aside); without one it takes the first free spot. */
export function insert(layout: Layout, id: string, size: Size, cols: number, target?: Rect): Layout {
  if (target) return place(layout, id, target, cols);
  const p = firstFree(layout, size, cols);
  return { ...layout, [id]: { ...p, w: Math.min(size.w, cols), h: size.h } };
}

export function remove(layout: Layout, id: string): Layout {
  const out = { ...layout };
  delete out[id];
  return out;
}

/** Explicit compaction: slide everything up as far as it goes, top rows first. The only gravity on the board. */
export function tidy(layout: Layout, cols: number): Layout {
  const ids = Object.keys(layout).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x);
  const occ = new Occupancy(cols);
  const out: Layout = {};
  for (const id of ids) {
    const r = clampRect(layout[id], cols);
    let y = r.y;
    while (y > 0 && occ.isFree({ ...r, y: y - 1 })) y--;
    // If clamping widened a collision, fall back to nearest free.
    const nr = occ.isFree({ ...r, y }) ? { ...r, y } : { ...r, ...nearestFree(occ, r, r) };
    out[id] = nr;
    occ.fill(nr);
  }
  return out;
}

/**
 * Derive a layout for a different column count from an existing one.
 * Keeps each module's position where it still fits, clamps widths, and
 * relocates the rest to the nearest free spot, in reading order.
 */
export function reflow(source: Layout, cols: number, order?: string[]): Layout {
  const ids = order ?? Object.keys(source).sort((a, b) => source[a].y - source[b].y || source[a].x - source[b].x);
  const occ = new Occupancy(cols);
  const out: Layout = {};
  for (const id of ids) {
    const r = source[id];
    if (!r) continue;
    const c = clampRect(r, cols);
    const nr = occ.isFree(c) ? c : { ...c, ...nearestFree(occ, c, c) };
    out[id] = nr;
    occ.fill(nr);
  }
  return out;
}

export { bottom };

import type { Rect } from './geometry';

export interface MetricsOptions {
  /** Smallest acceptable cell in px. The engine picks the most columns that keep cells at least this big. */
  minCell?: number;
  gap?: number;
  margin?: number;
  /** Allowed column counts, any order. Default 4, 8, 12, 16: each step halves or doubles cleanly. */
  steps?: number[];
}

export interface Metrics {
  cols: number;
  /** Cell edge in px at zoom 1. Cells are square. */
  cell: number;
  gap: number;
  margin: number;
  /** cell + gap: distance from one cell's left edge to the next. */
  pitch: number;
  /** Board width in px at zoom 1. */
  width: number;
}

export const DEFAULT_METRICS: Required<MetricsOptions> = { minCell: 76, gap: 8, margin: 16, steps: [4, 8, 12, 16] };

export function computeMetrics(width: number, opts: MetricsOptions = {}): Metrics {
  const o = { ...DEFAULT_METRICS, ...opts };
  const steps = [...o.steps].sort((a, b) => b - a);
  const usable = Math.max(0, width - 2 * o.margin);
  let cols = steps.at(-1)!;
  for (const c of steps) {
    if ((usable - (c - 1) * o.gap) / c >= o.minCell) {
      cols = c;
      break;
    }
  }
  const cell = Math.max(24, (usable - (cols - 1) * o.gap) / cols);
  return { cols, cell, gap: o.gap, margin: o.margin, pitch: cell + o.gap, width };
}

/** Cell rect → px rect in world space. */
export function toPx(r: Rect, m: Metrics) {
  return {
    x: m.margin + r.x * m.pitch,
    y: m.margin + r.y * m.pitch,
    w: r.w * m.cell + (r.w - 1) * m.gap,
    h: r.h * m.cell + (r.h - 1) * m.gap,
  };
}

/** World px → fractional cell coordinate (0.0 = left edge of column 0). */
export function toCellF(px: number, py: number, m: Metrics) {
  return { x: (px - m.margin) / m.pitch, y: (py - m.margin) / m.pitch };
}

/** World px → the cell under that point. */
export function cellAt(px: number, py: number, m: Metrics) {
  const f = toCellF(px + m.gap / 2, py + m.gap / 2, m);
  return { x: Math.floor(f.x), y: Math.floor(f.y) };
}

/** px span → cells, e.g. a module dragged to 300 px wide. */
export const spanToCells = (px: number, m: Metrics) => (px + m.gap) / m.pitch;

export type SizeClass = 'tile' | 'small' | 'wide' | 'tall' | 'large';

/** What kind of view a module should show at this size. Modules render a different view per class, not a scaled one. */
export function sizeClass(w: number, h: number): SizeClass {
  if (w === 1 && h === 1) return 'tile';
  if (w <= 2 && h <= 2) return 'small';
  if (Math.min(w, h) >= 3 && Math.max(w, h) / Math.min(w, h) < 1.5) return 'large';
  return w > h ? 'wide' : h > w ? 'tall' : 'large';
}

export const SIZE_NAMES: Record<SizeClass, string> = { tile: 'Tile', small: 'Small', wide: 'Wide', tall: 'Tall', large: 'Large' };

/** Named sizes the resize handle snaps to more firmly. */
export const DETENTS: [number, number][] = [
  [1, 1],
  [2, 2],
  [4, 2],
  [2, 4],
  [4, 4],
];

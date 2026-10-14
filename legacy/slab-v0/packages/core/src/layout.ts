import type { ModuleInstance } from './types';

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * First-fit packing, in list order. Each module takes the first top-left
 * position where it fits. Reordering the list is how modules move; changing
 * w/h is how they resize. Everything else flows around them.
 */
export function pack(items: ModuleInstance[], cols: number): { cells: Map<string, Cell>; rows: number } {
  const occ: boolean[][] = [];
  const cells = new Map<string, Cell>();

  const fits = (x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) {
      const row = occ[j];
      if (!row) continue;
      for (let i = x; i < x + w; i++) if (row[i]) return false;
    }
    return true;
  };

  for (const it of items) {
    const w = Math.max(1, Math.min(it.w, cols));
    const h = Math.max(1, it.h);
    let placed = false;
    for (let y = 0; !placed; y++) {
      for (let x = 0; x <= cols - w; x++) {
        if (!fits(x, y, w, h)) continue;
        for (let j = y; j < y + h; j++) {
          occ[j] ??= [];
          for (let i = x; i < x + w; i++) occ[j][i] = true;
        }
        cells.set(it.id, { x, y, w, h });
        placed = true;
        break;
      }
    }
  }
  return { cells, rows: occ.length };
}

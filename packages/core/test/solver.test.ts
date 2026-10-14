import { describe, expect, it } from 'vitest';
import { type Layout, computeMetrics, isValid, place, reflow, tidy, insert, sizeClass, toPx, cellAt } from '../src/solver';

const L = (o: Record<string, [number, number, number, number]>): Layout =>
  Object.fromEntries(Object.entries(o).map(([k, [x, y, w, h]]) => [k, { x, y, w, h }]));

describe('metrics', () => {
  it.each([
    [390, 4, 84],
    [820, 8, 92],
    [1180, 12, 88],
    [1280, 12, 97],
    [1600, 16, 91],
  ])('%ipx → %i cols, ~%ipx cells', (width, cols, cell) => {
    const m = computeMetrics(width);
    expect(m.cols).toBe(cols);
    expect(Math.round(m.cell)).toBe(cell);
  });

  it('round-trips cells to px and back', () => {
    const m = computeMetrics(1180);
    const px = toPx({ x: 3, y: 2, w: 2, h: 2 }, m);
    expect(cellAt(px.x + 1, px.y + 1, m)).toEqual({ x: 3, y: 2 });
    expect(cellAt(px.x + px.w - 1, px.y + px.h - 1, m)).toEqual({ x: 4, y: 3 });
  });
});

describe('place (pegboard)', () => {
  it('moves into empty space without touching anything else', () => {
    const base = L({ a: [0, 0, 2, 2], b: [4, 0, 2, 2] });
    const out = place(base, 'a', { x: 0, y: 4, w: 2, h: 2 }, 8);
    expect(out.a).toEqual({ x: 0, y: 4, w: 2, h: 2 });
    expect(out.b).toBe(base.b);
  });

  it('swaps two same-size modules', () => {
    const base = L({ a: [0, 0, 2, 2], b: [2, 0, 2, 2] });
    const out = place(base, 'a', { x: 2, y: 0, w: 2, h: 2 }, 8);
    expect(out.a).toEqual({ x: 2, y: 0, w: 2, h: 2 });
    expect(out.b).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('moves only covered modules, to the nearest free spot', () => {
    const base = L({ a: [0, 0, 4, 2], b: [4, 0, 2, 2], c: [6, 0, 2, 2], d: [0, 2, 2, 2] });
    // Widen a to 6 columns: covers b only.
    const out = place(base, 'a', { x: 0, y: 0, w: 6, h: 2 }, 8);
    expect(isValid(out, 8)).toBe(true);
    expect(out.c).toBe(base.c);
    expect(out.d).toBe(base.d);
    expect(out.b).not.toEqual(base.b);
    // Nearest free for a 2×2 near (4,0) is directly below.
    expect(out.b).toEqual({ x: 4, y: 2, w: 2, h: 2 });
  });

  it('never cascades: modules not covered never move', () => {
    const base = L({ a: [0, 0, 2, 2], b: [2, 0, 2, 2], c: [2, 2, 2, 2], e: [4, 0, 4, 4] });
    const out = place(base, 'a', { x: 2, y: 1, w: 2, h: 2 }, 8);
    expect(isValid(out, 8)).toBe(true);
    expect(out.e).toBe(base.e);
  });

  it('computes from the base, so pushed modules return home', () => {
    const base = L({ a: [0, 0, 2, 2], b: [2, 0, 2, 2] });
    const over = place(base, 'a', { x: 2, y: 0, w: 2, h: 2 }, 8);
    expect(over.b).not.toEqual(base.b);
    const away = place(base, 'a', { x: 0, y: 6, w: 2, h: 2 }, 8);
    expect(away.b).toEqual(base.b);
  });

  it('clamps to the board', () => {
    const out = place(L({ a: [0, 0, 2, 2] }), 'a', { x: 7, y: -3, w: 4, h: 1 }, 8);
    expect(out.a).toEqual({ x: 4, y: 0, w: 4, h: 1 });
  });

  it('insert without a target takes the first free spot', () => {
    const out = insert(L({ a: [0, 0, 2, 2] }), 'n', { w: 2, h: 2 }, 8);
    expect(out.n).toEqual({ x: 2, y: 0, w: 2, h: 2 });
  });

  it('stays valid under 2000 random moves and resizes', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
    for (const cols of [4, 8, 12, 16]) {
      let layout: Layout = {};
      for (let i = 0; i < 14; i++) layout = insert(layout, `m${i}`, { w: 1 + rnd(3), h: 1 + rnd(3) }, cols);
      expect(isValid(layout, cols)).toBe(true);
      for (let step = 0; step < 500; step++) {
        const id = `m${rnd(14)}`;
        layout = place(layout, id, { x: rnd(cols), y: rnd(10), w: 1 + rnd(Math.min(cols, 5)), h: 1 + rnd(4) }, cols);
        if (!isValid(layout, cols)) throw new Error(`invalid at cols=${cols} step=${step}`);
      }
    }
  });
});

describe('tidy and reflow', () => {
  it('tidy slides things up, top rows first', () => {
    const out = tidy(L({ a: [0, 3, 2, 2], b: [2, 6, 2, 1] }), 8);
    expect(out.a).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(out.b).toEqual({ x: 2, y: 0, w: 2, h: 1 });
  });

  it('reflow from 8 to 4 columns keeps positions that fit and clamps widths', () => {
    const src = L({ a: [0, 0, 8, 2], b: [0, 2, 2, 2], c: [6, 2, 2, 2] });
    const out = reflow(src, 4);
    expect(isValid(out, 4)).toBe(true);
    expect(out.a).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(out.b).toEqual({ x: 0, y: 2, w: 2, h: 2 });
    expect(out.c.w).toBe(2);
  });
});

describe('sizeClass', () => {
  it.each([
    [1, 1, 'tile'],
    [2, 1, 'small'],
    [2, 2, 'small'],
    [4, 2, 'wide'],
    [2, 4, 'tall'],
    [4, 4, 'large'],
    [3, 3, 'large'],
    [3, 2, 'wide'],
    [6, 2, 'wide'],
    [1, 3, 'tall'],
    [4, 3, 'large'],
  ] as const)('%i×%i is %s', (w, h, cls) => expect(sizeClass(w, h)).toBe(cls));
});

import { expect, test, type Page } from '@playwright/test';

/* Helpers ---------------------------------------------------------------- */

type R = { x: number; y: number; w: number; h: number };
declare global {
  interface Window {
    board: any;
    store: any;
  }
}

const layout = (p: Page): Promise<Record<string, R>> => p.evaluate(() => window.store.layout());
const mode = (p: Page) => p.evaluate(() => window.board.mode.get());

/** Screen point at the centre of a cell, through the camera (works under tilt). */
const cell = (p: Page, x: number, y: number) =>
  p.evaluate(
    ([x, y]) => {
      const b = window.board;
      const m = b.metrics;
      const s = b.toScreen(m.margin + x * m.pitch + m.cell / 2, m.margin + y * m.pitch + m.cell / 2);
      const r = b.viewport.getBoundingClientRect();
      return { x: s.x + r.left, y: s.y + r.top };
    },
    [x, y],
  );

async function box(p: Page, sel: string) {
  const b = await p.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return b;
}

/** Drag slowly and pause before release, so there's no flick. */
async function drag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 0) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  if (hold) await p.waitForTimeout(hold);
  await p.mouse.move(to.x, to.y, { steps: 16 });
  await p.waitForTimeout(140);
  await p.mouse.up();
  await p.waitForTimeout(350);
}

const noOverlaps = (l: Record<string, R>) => {
  const v = Object.values(l);
  return v.every((a, i) => v.slice(i + 1).every((b) => !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)));
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);
});

/* Tests ------------------------------------------------------------------ */

test('drag a header to move a module into empty space', async ({ page }) => {
  const h = await box(page, '.m7-mod[data-id="b"] .m7-title');
  const t = await cell(page, 4, 5);
  await drag(page, { x: h.x + 10, y: h.y + 6 }, { x: t.x - 20, y: t.y - 30 });
  expect((await layout(page)).b).toEqual({ x: 4, y: 5, w: 2, h: 2 });
});

test('same-size modules swap', async ({ page }) => {
  const h = await box(page, '.m7-mod[data-id="a"] .m7-title');
  const t = await cell(page, 2, 2);
  await drag(page, { x: h.x + 10, y: h.y + 6 }, { x: t.x, y: t.y - 30 });
  const l = await layout(page);
  expect(l.a).toEqual({ x: 2, y: 2, w: 4, h: 2 });
  expect(l.h).toEqual({ x: 0, y: 0, w: 4, h: 2 });
});

test('undo puts a move back', async ({ page }) => {
  const before = (await layout(page)).b;
  const h = await box(page, '.m7-mod[data-id="b"] .m7-title');
  const t = await cell(page, 4, 6);
  await drag(page, { x: h.x + 10, y: h.y + 6 }, t);
  await page.keyboard.press('Control+z');
  expect((await layout(page)).b).toEqual(before);
});

test('resizing pushes only the covered module, to the nearest free spot', async ({ page }) => {
  const before = await layout(page);
  await page.hover('.m7-mod[data-id="a"]');
  const h = await box(page, '.m7-mod[data-id="a"] .m7-handle-se');
  await drag(page, { x: h.x + 14, y: h.y + 14 }, { x: h.x + 14 + 210, y: h.y + 14 });
  const l = await layout(page);
  expect(l.a).toEqual({ x: 0, y: 0, w: 6, h: 2 });
  expect(l.b).toEqual({ x: 4, y: 4, w: 2, h: 2 });
  for (const id of ['c', 'd', 'e', 'f', 'g', 'h']) expect(l[id]).toEqual(before[id]);
});

test('a control inside a module keeps its own drag in Use mode', async ({ page }) => {
  const before = (await layout(page)).d;
  const k = await box(page, '.m7-mod[data-id="d"] .knob');
  await drag(page, { x: k.x + k.width / 2, y: k.y + k.height / 2 }, { x: k.x + k.width / 2, y: k.y - 40 });
  expect((await layout(page)).d).toEqual(before);
  expect(await page.evaluate(() => window.store.layer.modules.d.props.value)).toBeGreaterThan(0.5);
});

test('long-press on a header enters Arrange and keeps dragging', async ({ page }) => {
  const m = await box(page, '.m7-mod[data-id="b"] .m7-title');
  const t = await cell(page, 10, 5);
  await page.mouse.move(m.x + 10, m.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(500);
  expect(await mode(page)).toBe('arrange');
  await page.mouse.move(t.x, t.y, { steps: 16 });
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await layout(page)).b).toEqual({ x: 10, y: 5, w: 2, h: 2 });
});

test('long-press on a module body does not enter Arrange', async ({ page }) => {
  const m = await box(page, '.m7-mod[data-id="e"] .m7-body');
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  expect(await mode(page)).toBe('use');
});

test('in Arrange, drawing on empty cells adds a module that size', async ({ page }) => {
  await page.evaluate(() => window.board.setMode('arrange'));
  const a = await cell(page, 2, 6);
  const b = await cell(page, 4, 7);
  await drag(page, a, b);
  await page.locator('.m7-radial-node[data-key="blanks"]').click();
  await page.locator('.m7-radial-node[data-key="blank:2x2"]').click();
  await page.waitForTimeout(200);
  const l = await layout(page);
  expect(Object.values(l)).toContainEqual({ x: 2, y: 6, w: 3, h: 2 });
});

test('tapping empty canvas leaves Arrange', async ({ page }) => {
  await page.evaluate(() => window.board.setMode('arrange'));
  const t = await cell(page, 9, 7);
  await page.mouse.click(t.x, t.y);
  expect(await mode(page)).toBe('use');
});

test('drag lands in the right cell with the board tilted', async ({ page }) => {
  await page.evaluate(() => window.board.tiltTo(45, true));
  await page.waitForTimeout(150);
  const h = await box(page, '.m7-mod[data-id="b"] .m7-title');
  const t = await cell(page, 0, 8);
  await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, t);
  const r = (await layout(page)).b;
  expect(r.y).toBeGreaterThanOrEqual(7);
  expect(r.x).toBeLessThanOrEqual(1);
});

test('double-tap a header for full screen, Escape to return', async ({ page }) => {
  const h = await box(page, '.m7-mod[data-id="e"] .m7-title');
  await page.mouse.click(h.x + 10, h.y + 6);
  await page.mouse.click(h.x + 10, h.y + 6);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.board.focused.get())).toBe('e');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.board.focused.get())).toBeNull();
  expect(await page.locator('.m7-mods > .m7-mod[data-id="e"]').count()).toBe(1);
});

test('the layout never overlaps after a burst of gestures', async ({ page }) => {
  for (const [id, x, y] of [
    ['a', 6, 3],
    ['e', 0, 0],
    ['g', 5, 1],
    ['b', 9, 2],
  ] as const) {
    const h = await box(page, `.m7-mod[data-id="${id}"] .m7-title`);
    await drag(page, { x: h.x + 8, y: h.y + 6 }, await cell(page, x, y));
  }
  expect(noOverlaps(await layout(page))).toBe(true);
});

test('leaving Arrange does not replay the add animation', async ({ page }) => {
  await page.evaluate(() => window.board.add('blank', { x: 0, y: 8, w: 2, h: 2 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.board.setMode('arrange'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.board.setMode('use'));
  await page.waitForTimeout(30);
  const faded = await page.evaluate(() =>
    [...document.querySelectorAll('.m7-mod .m7-face')].some((f) => Number(getComputedStyle(f).opacity) < 0.95),
  );
  expect(faded).toBe(false);
});

import type { Board } from '../render/board';
import { MAX_TILT } from '../render/board';
import type { Transaction } from '../store/store';
import type { Rect } from '../solver/geometry';
import { clamp, sameRect } from '../solver/geometry';
import { DETENTS, SIZE_NAMES, cellAt, sizeClass, spanToCells, toCellF } from '../solver/metrics';
import { SPRINGS, project } from '../loop/spring';
import type { Dir } from '../render/shell';

/**
 * Every pointer goes through here. One state machine decides what a touch
 * means, based on where it started and the board's mode:
 *
 *   Use mode:     header drag → move · corner → resize · body → the module's own
 *                 empty canvas: drag → pan · tap → show + · hold → radial add
 *                 long-press on a module's header → Arrange (and keep dragging)
 *   Arrange mode: drag anywhere on a module → move · any edge → resize
 *                 empty canvas: drag → draw a new module · tap → Done
 *
 * Nothing is decided until the pointer travels 8 px (or the long-press fires).
 */

const SLOP = 8;
const LONG_PRESS_MS = 420;
const DOUBLE_TAP_MS = 320;
/** Extra distance (in cells) before the drop target switches, so it doesn't flicker at borders. */
const HYSTERESIS = 0.18;
/** Snap-to distance for named sizes, in cells. */
const DETENT = 0.28;

type Zone = 'head' | 'body' | 'resize' | 'canvas' | 'plus' | 'chrome';

interface Pending {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  zone: Zone;
  mod?: string;
  dir?: Dir;
  el: HTMLElement;
  timer: number;
  /** For velocity on release. */
  samples: { x: number; y: number; t: number }[];
}

type Active =
  | { k: 'move'; mod: string; txn: Transaction; grab: { x: number; y: number }; target: Rect; start: Rect }
  | { k: 'resize'; mod: string; dir: Dir; txn: Transaction; start: Rect; startPx: { x: number; y: number; w: number; h: number }; w0: { x: number; y: number }; target: Rect }
  | { k: 'draw'; c0: { x: number; y: number }; rect: Rect }
  | { k: 'pan' }
  | { k: 'pinch'; d0: number; z0: number; mid: { x: number; y: number } };

export class Gestures {
  private p: Pending | null = null;
  private a: Active | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private lastTap = { mod: '', t: 0 };
  private autoScroll = { vx: 0, vy: 0, stop: null as null | (() => void) };
  private inertia: (() => void) | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private b: Board) {
    const vp = b.viewport;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, o);
      this.cleanup.push(() => el.removeEventListener(t, f as EventListener, o));
    };
    on(vp, 'pointerdown', this.down);
    on(window, 'pointermove', this.move);
    on(window, 'pointerup', this.up);
    on(window, 'pointercancel', this.cancel);
    on(vp, 'pointermove', this.hover);
    on(vp, 'pointerleave', () => this.b.mode.get() === 'use' && !this.p && this.b.hideSlot());
    on(vp, 'wheel', this.wheel, { passive: false });
    on(vp, 'click', this.click);
    on(vp, 'contextmenu', (e) => this.p && e.preventDefault());
    // Safari trackpad pinch
    on(vp, 'gesturestart' as keyof HTMLElementEventMap, (e) => e.preventDefault());
    b.bindDock();
  }

  get active() {
    return !!this.a || this.autoScroll.stop !== null;
  }

  destroy() {
    this.cleanup.forEach((f) => f());
  }

  /* --------------------------------------------------------------- down */

  private down = (e: PointerEvent) => {
    const b = this.b;
    if (b.radial.open) return;
    b.root.classList.remove('is-keyboard');
    this.inertia?.();
    this.inertia = null;

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) return this.startPinch();
      if (this.touches.size > 2) return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') {
      if (e.button === 1) this.begin(e, 'canvas', undefined, undefined, true);
      return;
    }

    const t = e.target as HTMLElement;
    const zoneEl = t.closest<HTMLElement>('[data-m7-zone]');
    let zone = (zoneEl?.dataset.m7Zone ?? 'canvas') as Zone;
    const modEl = t.closest<HTMLElement>('.m7-mod');
    const mod = modEl?.dataset.id;
    if (zone === 'chrome') return;
    if (b.focused.get()) {
      if (mod !== b.focused.get()) return;
      if (zone !== 'head') return; // full screen: only header gestures (double-tap to exit)
    }
    const arranging = b.mode.get() === 'arrange';
    if (mod) b.selected.set(mod);

    if (zone === 'body') {
      // Interactive content (sliders, buttons, inputs) always belongs to the module.
      const interactive = t.closest('button, input, textarea, select, a, [contenteditable], [data-m7-interactive]');
      if (!arranging && interactive && interactive !== zoneEl) return;
      if (arranging) zone = 'head'; // drag from anywhere
    }
    this.begin(e, zone, mod, zoneEl?.dataset.dir as Dir | undefined);
  };

  private begin(e: PointerEvent, zone: Zone, mod?: string, dir?: Dir, forcePan = false) {
    const el = e.target as HTMLElement;
    const p: Pending = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), zone, mod, dir, el, timer: 0, samples: [] };
    this.p = p;
    if (forcePan) {
      this.p = null;
      this.a = { k: 'pan' };
      this.capture(e.pointerId);
      return;
    }
    if (zone !== 'body') e.preventDefault();
    if (zone === 'resize' && mod) return; // starts on the first movement; tiny handles need no slop
    p.timer = window.setTimeout(() => this.longPress(), LONG_PRESS_MS);
  }

  private longPress() {
    const p = this.p;
    if (!p || this.a) return;
    const b = this.b;
    // Only the header enters Arrange. Holding a pad or knob must never start jiggle mode.
    // (In Arrange, body presses are already treated as 'head' so you can lift from anywhere.)
    if (p.mod && p.zone === 'head') {
      if (b.mode.get() === 'use') {
        b.setMode('arrange');
        navigator.vibrate?.(8);
      }
      this.startMove(p.x0, p.y0, p.mod);
    } else if (p.zone === 'canvas' || p.zone === 'plus') {
      const w = b.toWorld(p.x0, p.y0);
      const c = cellAt(w.x, w.y, b.metrics);
      if (c.x < 0 || c.x >= b.metrics.cols || c.y < 0) return;
      this.p = null;
      b.showSlot(c);
      b.openAdd(p.x0, p.y0, { ...c, w: 1, h: 1 }, 'hold', () => b.hideSlot());
    }
  }

  /* --------------------------------------------------------------- move */

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.a?.k === 'pinch') return this.pinchMove();
    }
    const p = this.p;
    if (!p || e.pointerId !== p.id) return;
    p.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (p.samples.length > 6) p.samples.shift();

    if (!this.a) {
      const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (p.zone === 'resize' && p.mod) {
        if (dist < 2) return;
        this.startResize(p.mod, p.dir ?? 'se', p.x0, p.y0);
      } else {
        if (dist < SLOP) return;
        clearTimeout(p.timer);
        const arranging = this.b.mode.get() === 'arrange';
        if (p.zone === 'body') {
          // The module's content owns this drag.
          this.p = null;
          return;
        }
        if (p.zone === 'head' && p.mod) this.startMove(p.x0, p.y0, p.mod);
        else if (arranging) this.startDraw(p.x0, p.y0);
        else this.startPan();
      }
      this.capture(p.id);
    }
    this.step(e.clientX, e.clientY);
  };

  private step(cx: number, cy: number) {
    const a = this.a;
    const b = this.b;
    if (!a) return;
    if (a.k === 'move') this.moveStep(a, cx, cy);
    else if (a.k === 'resize') this.resizeStep(a, cx, cy);
    else if (a.k === 'draw') this.drawStep(a, cx, cy);
    else if (a.k === 'pan') {
      const s = this.p!.samples;
      const prev = s.at(-2) ?? { x: this.p!.x0, y: this.p!.y0 };
      b.panBy(cx - prev.x, cy - prev.y);
    }
  }

  /* --------------------------------------------------------------- up */

  private up = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.a?.k === 'pinch') {
        if (this.touches.size < 2) this.a = null;
        return;
      }
    }
    const p = this.p;
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.timer);
    const a = this.a;
    this.p = null;
    this.a = null;
    this.stopAutoScroll();
    if (!a) return this.tap(p, e);
    const v = velocity(p.samples);
    if (a.k === 'move') this.moveEnd(a, v);
    else if (a.k === 'resize') this.resizeEnd(a);
    else if (a.k === 'draw') this.drawEnd(a, e);
    else if (a.k === 'pan') this.panEnd(v);
  };

  private cancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    const p = this.p;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer);
    const a = this.a;
    this.p = null;
    this.a = null;
    this.stopAutoScroll();
    if (a && (a.k === 'move' || a.k === 'resize')) {
      a.txn.cancel();
      this.release(a.mod);
    }
    this.b.showGhost(null);
    this.b.showBadge(null);
  };

  /** Escape during a drag puts everything back. */
  abort() {
    const a = this.a;
    if (!a) return false;
    if (this.p) clearTimeout(this.p.timer);
    this.p = null;
    this.a = null;
    this.stopAutoScroll();
    if (a.k === 'move' || a.k === 'resize') {
      a.txn.cancel();
      this.release(a.mod);
    }
    this.b.showGhost(null);
    this.b.showBadge(null);
    return true;
  }

  private tap(p: Pending, e: PointerEvent) {
    const b = this.b;
    const arranging = b.mode.get() === 'arrange';
    if (p.zone === 'head' && p.mod) {
      const now = performance.now();
      if (this.lastTap.mod === p.mod && now - this.lastTap.t < DOUBLE_TAP_MS) {
        this.lastTap = { mod: '', t: 0 };
        if (b.focused.get() === p.mod) b.unfocus();
        else b.focus(p.mod);
      } else this.lastTap = { mod: p.mod, t: now };
      return;
    }
    if (p.zone === 'plus') {
      const x = Number(b.slot.dataset.x);
      const y = Number(b.slot.dataset.y);
      b.openAdd(e.clientX, e.clientY, { x, y, w: 1, h: 1 }, 'tap', () => b.mode.get() === 'use' && b.hideSlot());
      return;
    }
    if (p.zone === 'canvas') {
      if (arranging) return b.setMode('use');
      b.selected.set(null);
      const w = b.toWorld(e.clientX, e.clientY);
      const c = cellAt(w.x, w.y, b.metrics);
      if (this.isFreeCell(c)) b.showSlot(c);
      else b.hideSlot();
    }
  }

  private click = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-m7-act]');
    if (!t) return;
    const id = t.closest<HTMLElement>('.m7-mod')?.dataset.id;
    if (!id) return;
    if (t.dataset.m7Act === 'menu') this.b.overlays.menu(t.getBoundingClientRect(), this.b.menuFor(id));
    if (t.dataset.m7Act === 'remove') this.b.remove(id);
  };

  /* ---------------------------------------------------------- hover (+) */

  private hover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || this.p || this.a || this.b.radial.open || e.buttons) return;
    if (this.b.mode.get() === 'arrange') return; // in Arrange you draw instead
    const t = e.target as HTMLElement;
    const zone = t.closest<HTMLElement>('[data-m7-zone]')?.dataset.m7Zone;
    if (zone !== 'canvas' && zone !== 'plus') {
      if (zone && zone !== 'plus') this.b.hideSlot();
      return;
    }
    const w = this.b.toWorld(e.clientX, e.clientY);
    const c = cellAt(w.x, w.y, this.b.metrics);
    if (this.isFreeCell(c)) this.b.showSlot(c);
    else this.b.hideSlot();
  };

  private isFreeCell(c: { x: number; y: number }) {
    const m = this.b.metrics;
    if (c.x < 0 || c.y < 0 || c.x >= m.cols) return false;
    const layout = this.b.store.layout();
    return !Object.values(layout).some((r) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h);
  }

  /* ----------------------------------------------------------- move impl */

  private startMove(cx: number, cy: number, mod: string) {
    const b = this.b;
    const s = b.shells.get(mod);
    if (!s) return;
    clearTimeout(this.p?.timer ?? 0);
    const base = b.store.layout();
    const start = base[mod];
    const w = b.toWorld(cx, cy);
    s.held.set(true);
    s.el.classList.add('is-held');
    s.lift.target = 1.035;
    b.hideSlot();
    this.a = { k: 'move', mod, txn: b.store.begin(), grab: { x: w.x - s.x.value, y: w.y - s.y.value }, target: start, start };
    if (this.p) this.capture(this.p.id);
    b.showGhost(start);
    b.kick();
  }

  private moveStep(a: Extract<Active, { k: 'move' }>, cx: number, cy: number) {
    const b = this.b;
    const s = b.shells.get(a.mod);
    if (!s) return;
    const w = b.toWorld(cx, cy);
    const x = w.x - a.grab.x;
    const y = w.y - a.grab.y;
    s.pin({ x, y });
    this.retarget(a, x, y);
    this.edgeScroll(cx, cy);
  }

  /** Pick the drop cell from the module's top-left, with hysteresis, and preview the layout. */
  private retarget(a: Extract<Active, { k: 'move' }>, x: number, y: number) {
    const b = this.b;
    const m = b.metrics;
    const f = toCellF(x, y, m);
    const t = a.target;
    let nx = t.x;
    let ny = t.y;
    if (Math.abs(f.x - t.x) > 0.5 + HYSTERESIS) nx = Math.round(f.x);
    if (Math.abs(f.y - t.y) > 0.5 + HYSTERESIS) ny = Math.round(f.y);
    nx = clamp(nx, 0, m.cols - t.w);
    ny = Math.max(0, ny);
    if (nx === t.x && ny === t.y) return;
    a.target = { ...t, x: nx, y: ny };
    // Preview the intent, not the result: if something else changes the doc mid-gesture
    // (MIDI, a remote edit), the store rebases this preview on top of it.
    a.txn.preview({ t: 'place', id: a.mod, rect: a.target });
    b.showGhost(a.target);
  }

  private moveEnd(a: Extract<Active, { k: 'move' }>, v: { x: number; y: number }) {
    const b = this.b;
    const s = b.shells.get(a.mod);
    // A quick flick lands where it was heading.
    if (s && Math.hypot(v.x, v.y) > 900) {
      const z = b.camera().zoom;
      this.retarget(a, s.x.value + project(v.x, 0.985) / z, s.y.value + project(v.y, 0.985) / z);
    }
    if (sameRect(a.target, a.start)) a.txn.cancel();
    else a.txn.commit();
    this.release(a.mod, v);
    b.showGhost(null);
  }

  private release(mod: string, v = { x: 0, y: 0 }) {
    const b = this.b;
    const s = b.shells.get(mod);
    if (!s) return;
    s.held.set(false);
    s.el.classList.remove('is-held');
    s.lift.target = 1;
    const z = b.camera().zoom;
    s.x.velocity = v.x / z;
    s.y.velocity = v.y / z;
    const r = b.store.layout()[mod];
    if (r) s.target(b.px(r), SPRINGS.drop);
    b.kick();
  }

  private edgeScroll(_cx: number, cy: number) {
    const r = this.b.viewport.getBoundingClientRect();
    const edge = 48;
    const vy = cy < r.top + edge ? -1 : cy > r.bottom - edge ? 1 : 0;
    this.autoScroll.vy = vy * 9;
    if (vy && !this.autoScroll.stop) {
      this.autoScroll.stop = this.b.clock.every(() => {
        if (!this.autoScroll.vy || !this.p) return;
        this.b.panBy(0, -this.autoScroll.vy);
        const last = this.p.samples.at(-1);
        if (last) this.step(last.x, last.y);
      });
    } else if (!vy) this.stopAutoScroll();
  }

  private stopAutoScroll() {
    this.autoScroll.stop?.();
    this.autoScroll.stop = null;
    this.autoScroll.vy = 0;
  }

  /* --------------------------------------------------------- resize impl */

  private startResize(mod: string, dir: Dir, cx: number, cy: number) {
    const b = this.b;
    const s = b.shells.get(mod);
    if (!s) return;
    const base = b.store.layout();
    const start = base[mod];
    s.held.set(true);
    s.el.classList.add('is-resizing');
    b.hideSlot();
    this.a = {
      k: 'resize',
      mod,
      dir,
      txn: b.store.begin(),
      start,
      startPx: { x: s.x.value, y: s.y.value, w: s.w.value, h: s.h.value },
      w0: b.toWorld(cx, cy),
      target: start,
    };
    b.showGhost(start);
    b.kick();
  }

  private resizeStep(a: Extract<Active, { k: 'resize' }>, cx: number, cy: number) {
    const b = this.b;
    const s = b.shells.get(a.mod);
    if (!s) return;
    const m = b.metrics;
    const w = b.toWorld(cx, cy);
    const dx = w.x - a.w0.x;
    const dy = w.y - a.w0.y;
    const d = a.dir;
    const minPx = m.cell * 0.6;
    let { x, y, w: pw, h: ph } = a.startPx;
    if (d.includes('e')) pw = Math.max(minPx, a.startPx.w + dx);
    if (d.includes('s')) ph = Math.max(minPx, a.startPx.h + dy);
    if (d.includes('w')) {
      pw = Math.max(minPx, a.startPx.w - dx);
      x = a.startPx.x + a.startPx.w - pw;
    }
    if (d.includes('n')) {
      ph = Math.max(minPx, a.startPx.h - dy);
      y = a.startPx.y + a.startPx.h - ph;
    }
    s.pin({ x, y, w: pw, h: ph });

    const def = b.def(b.store.layer.modules[a.mod]?.type ?? '');
    const [minW, minH] = def?.minSize ?? [1, 1];
    const [maxW, maxH] = def?.maxSize ?? [m.cols, 12];
    const t = a.target;
    const fw = spanToCells(pw, m);
    const fh = spanToCells(ph, m);
    let cw = Math.abs(fw - t.w) > 0.5 + HYSTERESIS ? Math.round(fw) : t.w;
    let ch = Math.abs(fh - t.h) > 0.5 + HYSTERESIS ? Math.round(fh) : t.h;
    // Named sizes pull a little harder.
    for (const [dw, dh] of DETENTS) if (Math.abs(fw - dw) < DETENT && Math.abs(fh - dh) < DETENT) (cw = dw), (ch = dh);
    cw = clamp(cw, minW, Math.min(maxW, m.cols));
    ch = clamp(ch, minH, maxH);
    let nx = d.includes('w') ? a.start.x + a.start.w - cw : a.start.x;
    const ny = d.includes('n') ? Math.max(0, a.start.y + a.start.h - ch) : a.start.y;
    nx = clamp(nx, 0, m.cols - cw);
    if (d.includes('e') && nx + cw > m.cols) cw = m.cols - nx;
    const next = { x: nx, y: ny, w: cw, h: ch };
    const cls = sizeClass(cw, ch);
    b.showBadge(`${cw} × ${ch} · ${SIZE_NAMES[cls]}`, cx, cy);
    if (sameRect(next, t)) return;
    a.target = next;
    a.txn.preview({ t: 'place', id: a.mod, rect: next });
    b.showGhost(next);
  }

  private resizeEnd(a: Extract<Active, { k: 'resize' }>) {
    const b = this.b;
    if (sameRect(a.target, a.start)) a.txn.cancel();
    else a.txn.commit();
    b.shells.get(a.mod)?.el.classList.remove('is-resizing');
    this.release(a.mod);
    b.showGhost(null);
    b.showBadge(null);
  }

  /* ----------------------------------------------------------- draw impl */

  private startDraw(cx: number, cy: number) {
    const b = this.b;
    const w = b.toWorld(cx, cy);
    const c = cellAt(w.x, w.y, b.metrics);
    const c0 = { x: clamp(c.x, 0, b.metrics.cols - 1), y: Math.max(0, c.y) };
    this.a = { k: 'draw', c0, rect: { ...c0, w: 1, h: 1 } };
    b.hideSlot();
    b.showGhost(this.a.rect);
  }

  private drawStep(a: Extract<Active, { k: 'draw' }>, cx: number, cy: number) {
    const b = this.b;
    const w = b.toWorld(cx, cy);
    const c = cellAt(w.x, w.y, b.metrics);
    const x1 = clamp(c.x, 0, b.metrics.cols - 1);
    const y1 = Math.max(0, c.y);
    a.rect = { x: Math.min(a.c0.x, x1), y: Math.min(a.c0.y, y1), w: Math.abs(x1 - a.c0.x) + 1, h: Math.abs(y1 - a.c0.y) + 1 };
    b.showGhost(a.rect);
    b.showBadge(`${a.rect.w} × ${a.rect.h} · ${SIZE_NAMES[sizeClass(a.rect.w, a.rect.h)]}`, cx, cy);
  }

  private drawEnd(a: Extract<Active, { k: 'draw' }>, e: PointerEvent) {
    const b = this.b;
    b.showBadge(null);
    b.openAdd(e.clientX, e.clientY, a.rect, 'tap', () => b.showGhost(null));
  }

  /* ------------------------------------------------------ pan, pinch, wheel */

  private startPan() {
    this.a = { k: 'pan' };
    this.b.hideSlot();
  }

  private panEnd(v: { x: number; y: number }) {
    if (Math.hypot(v.x, v.y) < 80) return;
    let vx = v.x;
    let vy = v.y;
    this.inertia = this.b.clock.run((dt) => {
      const decay = Math.pow(0.998, dt * 1000);
      vx *= decay;
      vy *= decay;
      this.b.panBy(vx * dt, vy * dt);
      return Math.hypot(vx, vy) > 20;
    });
  }

  private startPinch() {
    const [p1, p2] = [...this.touches.values()];
    if (this.a && (this.a.k === 'move' || this.a.k === 'resize')) return;
    if (this.p) clearTimeout(this.p.timer);
    this.p = null;
    this.b.hideSlot();
    this.a = { k: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), z0: this.b.camera().zoom, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }

  private pinchMove() {
    const a = this.a;
    if (a?.k !== 'pinch') return;
    const [p1, p2] = [...this.touches.values()];
    if (!p1 || !p2) return;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    this.b.panBy(mid.x - a.mid.x, mid.y - a.mid.y);
    this.b.zoomAt(mid.x, mid.y, a.z0 * (d / a.d0));
    a.mid = mid;
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const b = this.b;
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? b.vp.h : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      // Mouse wheels send ±100 per notch, trackpads a few px per event: cap the step.
      b.zoomAt(e.clientX, e.clientY, b.camera().zoom * Math.exp(-clamp(dy, -30, 30) * 0.01));
    } else if (e.altKey) {
      b.tiltTo(clamp(b.camera().tilt + dy * 0.15, 0, MAX_TILT), true);
    } else {
      b.panBy(-dx, -dy);
    }
    b.hideSlot();
  };

  private capture(id: number) {
    try {
      this.b.viewport.setPointerCapture(id);
    } catch {
      /* pointer already gone */
    }
  }
}

function velocity(samples: { x: number; y: number; t: number }[]) {
  if (samples.length < 2) return { x: 0, y: 0 };
  const a = samples[0];
  const z = samples.at(-1)!;
  const dt = (z.t - a.t) / 1000;
  if (dt <= 0 || performance.now() - z.t > 80) return { x: 0, y: 0 };
  return { x: (z.x - a.x) / dt, y: (z.y - a.y) / dt };
}

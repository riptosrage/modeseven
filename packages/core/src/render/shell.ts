import { SPRINGS, Spring } from '../loop/spring';
import { type Signal, signal } from '../store/signal';
import type { ModuleRecord } from '../store/doc';
import type { Rect } from '../solver/geometry';
import { sizeClass } from '../solver/metrics';
import type { Mode, ModuleContext, ModuleSize } from '../modules/types';
import type { Board } from './board';
import { icons } from './icons';
import { gestureKey } from '../params/registry';

const DIRS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const;
export type Dir = (typeof DIRS)[number];

/**
 * A module's frame on the board: chrome (header, ⋯, handles, remove badge)
 * around the module's own content. Owns the springs that animate it.
 */
export class Shell {
  readonly el: HTMLElement;
  readonly face: HTMLElement;
  readonly body: HTMLElement;
  private titleEl: HTMLElement;
  readonly header: HTMLElement;

  readonly x = new Spring(0);
  readonly y = new Spring(0);
  readonly w = new Spring(0);
  readonly h = new Spring(0);
  readonly lift = new Spring(1, SPRINGS.snap);

  readonly size: Signal<ModuleSize>;
  readonly record: Signal<ModuleRecord>;
  readonly held = signal(false);
  rect: Rect;
  private cleanup?: () => void;
  private gesture: string | null = null;
  private placed = false;
  private last = { x: -1e9, y: -1e9, w: -1e9, h: -1e9, s: -1e9 };

  constructor(
    readonly board: Board,
    rec: ModuleRecord,
    rect: Rect,
    mode: Signal<Mode>,
  ) {
    this.rect = rect;
    this.record = signal(rec);
    this.size = signal<ModuleSize>({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, cls: sizeClass(rect.w, rect.h), focused: false });

    const el = document.createElement('div');
    el.className = 'm7-mod';
    el.dataset.id = rec.id;
    el.innerHTML = `<div class="m7-face">
        <div class="m7-head" data-m7-zone="head"><span class="m7-title"></span><div class="m7-actions"></div><button class="m7-more" data-m7-zone="chrome" data-m7-act="menu" aria-label="Module options">${icons.dots}</button></div>
        <div class="m7-body" data-m7-zone="body"><div class="m7-content"></div></div>
        ${DIRS.map((d) => `<div class="m7-handle m7-handle-${d}" data-m7-zone="resize" data-dir="${d}"></div>`).join('')}
      </div>
      <button class="m7-remove" data-m7-zone="chrome" data-m7-act="remove" aria-label="Remove module">${icons.minus}</button>`;
    this.el = el;
    this.face = el.querySelector('.m7-face')!;
    this.body = el.querySelector('.m7-content')!;
    this.header = el.querySelector('.m7-actions')!;
    this.titleEl = el.querySelector('.m7-title')!;

    this.mount(mode);
  }

  get id() {
    return this.record.get().id;
  }

  private mount(mode: Signal<Mode>) {
    const rec = this.record.get();
    const def = this.board.def(rec.type);
    this.titleEl.textContent = rec.title ?? def?.title ?? rec.type;
    this.el.dataset.type = rec.type;
    this.syncClass();
    if (!def) {
      this.body.innerHTML = `<div class="m7-missing">No module called “${rec.type}”</div>`;
      return;
    }
    const ctx: ModuleContext = {
      id: rec.id,
      board: this.board,
      size: this.size,
      record: this.record,
      mode,
      held: this.held,
      header: this.header,
      setProps: (patch) => this.board.store.dispatch({ t: 'props', id: rec.id, patch }),
      setTitle: (title) => this.board.store.dispatch({ t: 'title', id: rec.id, title }),
      param: (key) => this.board.engine.params.handle(rec.id, key, () => this.gesture),
      begin: () => void (this.gesture = gestureKey(rec.id)),
      end: () => void (this.gesture = null),
    };
    try {
      const c = def.mount(this.body, ctx);
      if (typeof c === 'function') this.cleanup = c;
    } catch (err) {
      console.error(`[mode7] module "${rec.type}" crashed while mounting`, err);
      this.body.innerHTML = `<div class="m7-missing">This module crashed. See the console.</div>`;
    }
  }

  /** Swap content if the type changed, otherwise just update record and title. */
  update(rec: ModuleRecord, mode: Signal<Mode>) {
    const prev = this.record.get();
    if (prev === rec) return;
    this.record.set(rec);
    if (prev.type !== rec.type) {
      this.cleanup?.();
      this.cleanup = undefined;
      this.body.innerHTML = '';
      this.header.innerHTML = '';
      this.mount(mode);
    } else this.titleEl.textContent = rec.title ?? this.board.def(rec.type)?.title ?? rec.type;
  }

  /** New cell rect from the layout. */
  setRect(r: Rect) {
    this.rect = r;
    const s = this.size.get();
    if (s.w !== r.w || s.h !== r.h || s.x !== r.x || s.y !== r.y) this.size.set({ ...s, x: r.x, y: r.y, w: r.w, h: r.h, cls: sizeClass(r.w, r.h) });
    this.syncClass();
  }

  /** Animate (or jump, the first time) to a px rect. Ignored while held by a gesture. */
  target(px: { x: number; y: number; w: number; h: number }, config = SPRINGS.glide) {
    if (this.held.get()) return;
    if (!this.placed) {
      this.x.set(px.x);
      this.y.set(px.y);
      this.w.set(px.w);
      this.h.set(px.h);
      this.placed = true;
      return;
    }
    for (const s of [this.x, this.y, this.w, this.h]) s.config = config;
    this.x.target = px.x;
    this.y.target = px.y;
    this.w.target = px.w;
    this.h.target = px.h;
  }

  /** Put it exactly here, now (1:1 with the finger). */
  pin(px: Partial<{ x: number; y: number; w: number; h: number }>) {
    if (px.x !== undefined) this.x.set(px.x);
    if (px.y !== undefined) this.y.set(px.y);
    if (px.w !== undefined) this.w.set(px.w);
    if (px.h !== undefined) this.h.set(px.h);
  }

  /** Step springs and write styles. Returns true while moving. */
  step(dt: number): boolean {
    let moving = false;
    for (const s of [this.x, this.y, this.w, this.h, this.lift]) if (s.step(dt)) moving = true;
    this.write();
    return moving;
  }

  write() {
    const x = this.x.value, y = this.y.value, w = this.w.value, h = this.h.value, s = this.lift.value;
    const L = this.last;
    if (x !== L.x || y !== L.y || s !== L.s) {
      this.el.style.transform = `translate3d(${x}px, ${y}px, 0)${s !== 1 ? ` scale(${s})` : ''}`;
      L.x = x;
      L.y = y;
      L.s = s;
    }
    if (Math.abs(w - L.w) > 0.25 || Math.abs(h - L.h) > 0.25) {
      this.el.style.width = `${w}px`;
      this.el.style.height = `${h}px`;
      L.w = w;
      L.h = h;
    }
  }

  private syncClass() {
    const s = this.size.get();
    this.el.classList.toggle('is-tile', s.cls === 'tile');
    this.el.dataset.cls = s.cls;
  }

  destroy() {
    this.cleanup?.();
    this.el.remove();
  }
}

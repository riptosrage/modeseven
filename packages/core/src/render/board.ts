import { Clock } from '../loop/clock';
import { SPRINGS, Spring } from '../loop/spring';
import { type Signal, signal } from '../store/signal';
import type { Store } from '../store/store';
import type { Rect } from '../solver/geometry';
import { bottom, clamp } from '../solver/geometry';
import { type Metrics, type MetricsOptions, computeMetrics, toPx } from '../solver/metrics';
import type { MenuItem, Mode, ModuleDef, RadialNode } from '../modules/types';
import { type CameraState, type Viewport, screenToWorld, worldToScreen, worldTransform, zoomAround } from './camera';
import { Shell } from './shell';
import { Radial } from './radial';
import { Overlays } from './menu';
import { icons } from './icons';
import { Gestures } from '../input/gestures';
import { Keyboard } from '../input/keyboard';
import { Debug } from './debug';

export interface BoardOptions {
  root: HTMLElement;
  store: Store;
  modules: ModuleDef[];
  /** Radial add menu. Leaf keys that match a module type add that module. */
  addMenu?: RadialNode[];
  /** Intercept a radial pick (e.g. open an AI prompt). Return true if handled. */
  onAdd?(key: string, at: { rect: Rect }, board: Board): boolean | void;
  /** Extra items at the top of each module's ⋯ menu. */
  moduleMenu?(id: string, board: Board): MenuItem[];
  metrics?: MetricsOptions;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
export const MAX_TILT = 72;

let seq = 0;
export const newId = (prefix = 'm') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * The board: renders the store, owns the camera and the frame loop, and
 * hosts gestures. One board per surface.
 */
export class Board {
  readonly store: Store;
  readonly clock = new Clock();
  readonly mode = signal<Mode>('use');
  readonly selected = signal<string | null>(null);
  readonly debug = signal(false);
  readonly metricsOptions: Signal<MetricsOptions>;
  readonly focused = signal<string | null>(null);

  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly world: HTMLElement;
  readonly gridEl: HTMLElement;
  readonly mods: HTMLElement;
  readonly ghost: HTMLElement;
  readonly slot: HTMLElement;
  readonly overlay: HTMLElement;
  readonly focusLayer: HTMLElement;
  readonly dock: HTMLElement;
  readonly badge: HTMLElement;

  readonly radial: Radial;
  readonly overlays: Overlays;
  readonly cam = {
    x: new Spring(0, SPRINGS.camera),
    y: new Spring(0, SPRINGS.camera),
    zoom: new Spring(1, SPRINGS.camera),
    tilt: new Spring(0, SPRINGS.camera),
  };

  metrics!: Metrics;
  vp: Viewport = { w: 0, h: 0 };
  /** Perspective strength for tilt, as a multiple of the viewport's longer side. Lower = more dramatic. */
  private perspective = 1.1;
  readonly shells = new Map<string, Shell>();
  private defs = new Map<string, ModuleDef>();
  private lastTransform = '';
  private returning: string | null = null;
  private veil: HTMLElement | null = null;
  private disposers: (() => void)[] = [];
  readonly gestures: Gestures;

  constructor(readonly opts: BoardOptions) {
    this.store = opts.store;
    this.root = opts.root;
    this.metricsOptions = signal(opts.metrics ?? {});
    opts.modules.forEach((d) => this.defs.set(d.type, d));

    this.root.classList.add('m7');
    this.root.innerHTML = `
      <div class="m7-viewport" data-m7-zone="canvas">
        <div class="m7-world">
          <div class="m7-grid" data-m7-zone="canvas"></div>
          <div class="m7-slot" data-m7-zone="plus" hidden><span>${icons.plus}</span></div>
          <div class="m7-ghost" hidden></div>
          <div class="m7-mods"></div>
        </div>
        <div class="m7-focus-layer"></div>
      </div>
      <div class="m7-overlay"><div class="m7-badge" hidden></div></div>
      <nav class="m7-dock" aria-label="Layers"></nav>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.viewport = q('.m7-viewport');
    this.world = q('.m7-world');
    this.gridEl = q('.m7-grid');
    this.mods = q('.m7-mods');
    this.ghost = q('.m7-ghost');
    this.slot = q('.m7-slot');
    this.overlay = q('.m7-overlay');
    this.focusLayer = q('.m7-focus-layer');
    this.dock = q('.m7-dock');
    this.badge = q('.m7-badge');
    this.radial = new Radial(this.overlay);
    this.overlays = new Overlays(this.overlay);

    this.measure(true);
    const ro = new ResizeObserver(() => this.measure(false));
    ro.observe(this.viewport);
    this.disposers.push(() => ro.disconnect());

    this.disposers.push(
      this.store.doc.subscribe((d, p) => {
        if (d.active !== p.active) this.onLayerSwitch();
        this.sync();
        this.renderDock();
      }),
      this.store.cols.subscribe(() => this.sync()),
      this.metricsOptions.subscribe(() => this.measure(false)),
      this.mode.subscribe((m) => {
        this.root.classList.toggle('is-arranging', m === 'arrange');
        if (m === 'use') this.hideSlot();
        this.renderDock();
      }),
      this.debug.subscribe((on) => this.root.classList.toggle('m7-debug', on)),
    );

    this.gestures = new Gestures(this);
    const kb = new Keyboard(this);
    this.disposers.push(() => this.gestures.destroy(), () => kb.destroy());
    new Debug(this);

    this.sync();
    this.renderDock();
    this.kick();
  }

  /* ------------------------------------------------------------ modules */

  def(type: string) {
    return this.defs.get(type);
  }

  get types() {
    return [...this.defs.values()];
  }

  /** Add a module. With a rect it goes there, pushing others aside; otherwise the first free spot. */
  add(type: string, rect?: Rect, extra: { title?: string; props?: Record<string, unknown> } = {}) {
    const d = this.def(type);
    const [w, h] = d?.size ?? [2, 2];
    const id = newId();
    this.store.dispatch({ t: 'add', id, type, size: { w, h }, rect, ...extra });
    this.selected.set(id);
    requestAnimationFrame(() => {
      const el = this.shells.get(id)?.el;
      if (!el) return;
      el.classList.add('is-new');
      // Drop the class once played, or leaving Arrange (which swaps animations) replays it.
      el.addEventListener('animationend', (e) => e.animationName === 'm7-pop' && el.classList.remove('is-new'));
      setTimeout(() => el.classList.remove('is-new'), 400);
    });
    return id;
  }

  remove(id: string) {
    if (this.focused.get() === id) this.unfocus(true);
    const name = this.titleOf(id);
    this.store.dispatch({ t: 'remove', id });
    if (this.selected.get() === id) this.selected.set(null);
    this.overlays.toast(`Removed ${name}`, { label: 'Undo', run: () => this.store.undo() });
  }

  duplicate(id: string) {
    const rec = this.store.layer.modules[id];
    const r = this.store.layout()[id];
    if (!rec || !r) return;
    const nid = newId();
    this.store.dispatch({ t: 'add', id: nid, type: rec.type, size: { w: r.w, h: r.h }, title: rec.title, props: rec.props });
    this.selected.set(nid);
  }

  titleOf(id: string) {
    const rec = this.store.layer.modules[id];
    return rec?.title ?? this.def(rec?.type ?? '')?.title ?? 'module';
  }

  /** Default ⋯ menu. */
  menuFor(id: string): MenuItem[] {
    return [
      ...(this.opts.moduleMenu?.(id, this) ?? []),
      { label: this.focused.get() === id ? 'Exit full screen' : 'Full screen', run: () => (this.focused.get() === id ? this.unfocus() : this.focus(id)) },
      { label: 'Duplicate', run: () => this.duplicate(id) },
      { label: 'Remove', danger: true, run: () => this.remove(id) },
    ];
  }

  /** Radial add at a cell or drawn rect. */
  openAdd(clientX: number, clientY: number, rect: Rect, mode: 'hold' | 'tap', onClose?: () => void) {
    const nodes = this.opts.addMenu ?? this.types.map((d) => ({ key: d.type, label: d.title, icon: d.icon ?? icons.plus }));
    this.radial.show({
      x: clientX,
      y: clientY,
      nodes,
      mode,
      onClose,
      onChoose: (key) => {
        onClose?.();
        if (this.opts.onAdd?.(key, { rect }, this)) return;
        if (!this.def(key)) return;
        const [dw, dh] = this.def(key)!.size;
        // A single tapped cell takes the module's default size from there; a drawn rect is used as drawn.
        const r = rect.w === 1 && rect.h === 1 ? { x: rect.x, y: rect.y, w: dw, h: dh } : rect;
        this.add(key, r);
      },
    });
  }

  /* ------------------------------------------------------------- layout */

  /** Shells ↔ store. Called on any doc or column change. */
  sync() {
    const layer = this.store.layer;
    const layout = this.store.layout();
    const m = this.metrics;
    for (const [id, s] of this.shells) {
      if (!layer.modules[id]) {
        s.destroy();
        this.shells.delete(id);
        if (this.focused.get() === id) this.focused.set(null);
      }
    }
    for (const id of Object.keys(layer.modules)) {
      const rect = layout[id];
      if (!rect) continue;
      let s = this.shells.get(id);
      if (!s) {
        s = new Shell(this, layer.modules[id], rect, this.mode);
        this.shells.set(id, s);
        this.mods.appendChild(s.el);
      } else s.update(layer.modules[id], this.mode);
      s.setRect(rect);
      if (this.focused.get() !== id && this.returning !== id) s.target(toPx(rect, m));
      s.el.classList.toggle('is-selected', this.selected.get() === id);
    }
    this.sizeGrid();
    this.kick();
  }

  private onLayerSwitch() {
    if (this.focused.get()) this.unfocus(true);
    for (const s of this.shells.values()) s.destroy();
    this.shells.clear();
    this.selected.set(null);
    this.hideSlot();
    this.setCamera({ x: this.metrics.width / 2, y: this.vp.h / 2 / this.cam.zoom.target }, true);
  }

  private sizeGrid() {
    const m = this.metrics;
    const rows = bottom(this.store.layout());
    const h = Math.max(this.vp.h / Math.max(MIN_ZOOM, this.cam.zoom.target) * 2.5, (rows + 40) * m.pitch);
    this.gridEl.style.width = `${m.width}px`;
    this.gridEl.style.height = `${h}px`;
    const s = this.root.style;
    s.setProperty('--m7-pitch', `${m.pitch}px`);
    s.setProperty('--m7-cell', `${m.cell}px`);
    s.setProperty('--m7-gap', `${m.gap}px`);
    s.setProperty('--m7-margin', `${m.margin}px`);
  }

  private measure(first: boolean) {
    const w = this.viewport.clientWidth || window.innerWidth;
    const h = this.viewport.clientHeight || window.innerHeight;
    const prevW = this.metrics?.width;
    this.vp = { w, h, d: Math.max(w, h) * this.perspective };
    this.metrics = computeMetrics(w, this.metricsOptions.get());
    if (first || prevW !== this.metrics.width) {
      // Keep the board's top-left where it was relative to the screen.
      const keepTop = first ? h / 2 : this.cam.y.target;
      this.setCamera({ x: this.metrics.width / 2, y: keepTop }, true);
    }
    this.store.cols.set(this.metrics.cols);
    this.sync();
    this.applyCamera(true);
  }

  /** Cell rect → px rect (world space). */
  px(r: Rect) {
    return toPx(r, this.metrics);
  }

  /* ------------------------------------------------------------- camera */

  camera(): CameraState {
    return { x: this.cam.x.value, y: this.cam.y.value, zoom: this.cam.zoom.value, tilt: this.cam.tilt.value };
  }

  cameraTarget(): CameraState {
    return { x: this.cam.x.target, y: this.cam.y.target, zoom: this.cam.zoom.target, tilt: this.cam.tilt.target };
  }

  /** Move the camera. `instant` skips the spring. Values are clamped to sensible bounds. */
  setCamera(c: Partial<CameraState>, instant = false) {
    const next = this.clampCamera({ ...this.cameraTarget(), ...c });
    for (const k of ['x', 'y', 'zoom', 'tilt'] as const) {
      if (instant) this.cam[k].set(next[k]);
      else this.cam[k].target = next[k];
    }
    if (instant) this.applyCamera(true);
    this.kick();
  }

  clampCamera(c: CameraState): CameraState {
    const zoom = clamp(c.zoom, MIN_ZOOM, MAX_ZOOM);
    const tilt = clamp(c.tilt, 0, MAX_TILT);
    const m = this.metrics;
    const halfW = this.vp.w / 2 / zoom;
    const halfH = this.vp.h / 2 / zoom;
    const x = m.width <= halfW * 2 + 1 ? m.width / 2 : clamp(c.x, halfW, m.width - halfW);
    const contentBottom = (bottom(this.store.layout()) + 2) * m.pitch + m.margin;
    const minY = halfH - (tilt ? halfH * 0.6 : 0);
    const maxY = Math.max(minY, contentBottom - halfH * 0.4 + (tilt ? halfH : 0));
    return { x, y: clamp(c.y, minY, maxY), zoom, tilt };
  }

  /**
   * Tilt the board like SNES Mode 7, keeping the row at the top of the
   * screen near the top so the board leans away into a horizon instead of
   * sliding off.
   */
  tiltTo(tilt: number, instant = false) {
    const c = instant ? this.camera() : this.cameraTarget();
    const t = clamp(tilt, 0, MAX_TILT);
    const anchor = screenToWorld(this.vp.w / 2, 0, c, this.vp).y;
    const goal = this.vp.h * (t > 0.5 ? 0.14 : 0);
    // Screen y of the anchor rises monotonically as the camera moves up: bisect.
    let lo = anchor - this.vp.h * 8;
    let hi = anchor + this.vp.h * 8;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const sy = worldToScreen(c.x, anchor, { ...c, y: mid, tilt: t }, this.vp).y;
      if (sy > goal) lo = mid;
      else hi = mid;
    }
    this.setCamera({ tilt: t, y: (lo + hi) / 2 }, instant);
  }

  /** How strong the tilt perspective is: a multiple of the viewport's longer side (default 1.1; lower is more dramatic). */
  setPerspective(factor: number) {
    this.perspective = clamp(factor, 0.4, 4);
    this.vp = { ...this.vp, d: Math.max(this.vp.w, this.vp.h) * this.perspective };
    this.applyCamera(true);
    this.kick();
  }

  zoomAt(clientX: number, clientY: number, zoom: number, instant = true) {
    const s = this.toViewport(clientX, clientY);
    const cur = instant ? this.camera() : this.cameraTarget();
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const next = zoomAround(cur, this.vp, s, z);
    this.setCamera(next, instant);
  }

  /** Pan by a screen-space delta (finger movement). Works under tilt. */
  panBy(dx: number, dy: number, instant = true) {
    const c = instant ? this.camera() : this.cameraTarget();
    const a = screenToWorld(this.vp.w / 2, this.vp.h / 2, c, this.vp);
    const b = screenToWorld(this.vp.w / 2 - dx, this.vp.h / 2 - dy, c, this.vp);
    this.setCamera({ x: c.x + (b.x - a.x), y: c.y + (b.y - a.y) }, instant);
  }

  toViewport(clientX: number, clientY: number) {
    const r = this.viewport.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /** Client (screen) point → world point on the board. */
  toWorld(clientX: number, clientY: number) {
    const s = this.toViewport(clientX, clientY);
    return screenToWorld(s.x, s.y, this.camera(), this.vp);
  }

  toScreen(wx: number, wy: number) {
    return worldToScreen(wx, wy, this.camera(), this.vp);
  }

  private applyCamera(force = false) {
    const t = worldTransform(this.camera(), this.vp);
    if (force || t !== this.lastTransform) {
      this.world.style.transform = t;
      this.lastTransform = t;
      this.root.classList.toggle('is-tilted', this.cam.tilt.value > 0.5);
    }
  }

  /* -------------------------------------------------------------- frame */

  /** Wake the frame loop. Cheap to call often. */
  kick() {
    if (!this.framing) {
      this.framing = true;
      this.clock.run(this.frame);
    }
  }
  private framing = false;

  private frame = (dt: number) => {
    let moving = false;
    for (const s of Object.values(this.cam)) if (s.step(dt)) moving = true;
    this.applyCamera();
    for (const s of this.shells.values()) if (s.step(dt)) moving = true;
    if (this.returning) {
      const s = this.shells.get(this.returning);
      if (!s || (s.x.settled && s.y.settled && s.w.settled && s.h.settled)) this.finishReturn();
      else moving = true;
    }
    if (this.gestures.active) moving = true;
    if (!moving) this.framing = false;
    return moving;
  };

  /* --------------------------------------------------------- focus mode */

  /** Full screen: the module lifts off the board into screen space and fills the viewport. Its saved size doesn't change. */
  focus(id: string) {
    const s = this.shells.get(id);
    if (!s || this.focused.get() === id) return;
    if (this.focused.get()) this.unfocus(true);
    const vr = this.viewport.getBoundingClientRect();
    const r = s.el.getBoundingClientRect();
    this.focusLayer.appendChild(s.el);
    s.pin({ x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height });
    s.write();
    const inset = Math.min(24, this.vp.w * 0.03);
    for (const sp of [s.x, s.y, s.w, s.h]) sp.config = SPRINGS.drop;
    s.x.target = inset;
    s.y.target = inset;
    s.w.target = this.vp.w - inset * 2;
    s.h.target = this.vp.h - inset * 2;
    s.el.classList.add('is-focused');
    s.size.set({ ...s.size.get(), focused: true });
    this.veil = document.createElement('div');
    this.veil.className = 'm7-veil';
    this.veil.onclick = () => this.unfocus();
    this.viewport.insertBefore(this.veil, this.focusLayer);
    this.focused.set(id);
    this.kick();
  }

  unfocus(instant = false) {
    const id = this.focused.get();
    if (!id) return;
    const s = this.shells.get(id);
    this.focused.set(null);
    this.veil?.remove();
    this.veil = null;
    if (!s) return;
    s.el.classList.remove('is-focused');
    s.size.set({ ...s.size.get(), focused: false });
    if (instant) {
      this.returning = id;
      this.finishReturn();
      return;
    }
    // Fly back to where the module sits on the board (as seen through the camera), then re-attach.
    const p = this.px(s.rect);
    const corners = [
      this.toScreen(p.x, p.y),
      this.toScreen(p.x + p.w, p.y),
      this.toScreen(p.x, p.y + p.h),
      this.toScreen(p.x + p.w, p.y + p.h),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    s.x.target = minX;
    s.y.target = minY;
    s.w.target = Math.max(...corners.map((c) => c.x)) - minX;
    s.h.target = Math.max(...corners.map((c) => c.y)) - minY;
    for (const sp of [s.x, s.y, s.w, s.h]) sp.config = SPRINGS.glide;
    this.returning = id;
    this.kick();
  }

  private finishReturn() {
    const id = this.returning;
    this.returning = null;
    const s = id ? this.shells.get(id) : undefined;
    if (!s) return;
    this.mods.appendChild(s.el);
    const p = this.px(s.rect);
    s.pin(p);
    s.write();
  }

  /* ------------------------------------------------------------ helpers */

  /** Show the faint + slot on an empty cell. */
  showSlot(cell: { x: number; y: number }) {
    const p = this.px({ ...cell, w: 1, h: 1 });
    const s = this.slot;
    s.hidden = false;
    s.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    s.style.width = `${p.w}px`;
    s.style.height = `${p.h}px`;
    s.dataset.x = String(cell.x);
    s.dataset.y = String(cell.y);
  }

  hideSlot() {
    this.slot.hidden = true;
  }

  showGhost(r: Rect | null) {
    if (!r) {
      this.ghost.hidden = true;
      return;
    }
    const p = this.px(r);
    const g = this.ghost;
    g.hidden = false;
    g.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    g.style.width = `${p.w}px`;
    g.style.height = `${p.h}px`;
  }

  showBadge(text: string | null, clientX = 0, clientY = 0) {
    const b = this.badge;
    if (!text) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    b.textContent = text;
    b.style.transform = `translate3d(${clientX + 16}px, ${clientY + 16}px, 0)`;
  }

  setMode(m: Mode) {
    this.mode.set(m);
  }

  private renderDock() {
    const d = this.store.doc.get();
    const arranging = this.mode.get() === 'arrange';
    this.dock.innerHTML =
      d.layers
        .map((l, i) => `<button class="${i === d.active ? 'is-on' : ''}" data-layer="${i}" title="Double-click to rename"><span class="m7-num">${i + 1}</span>${esc(l.name)}</button>`)
        .join('') +
      `<button data-layer="add" aria-label="Add layer">${icons.plusSmall}</button>` +
      (arranging ? `<button class="m7-done" data-act="done">Done</button>` : '');
  }

  bindDock() {
    this.dock.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.act === 'done') return this.setMode('use');
      if (b.dataset.layer === 'add') {
        const n = this.store.doc.get().layers.length + 1;
        this.store.dispatch({ t: 'layer.add', id: newId('layer'), name: `Layer ${n}` });
      } else this.store.silent({ t: 'layer.select', index: Number(b.dataset.layer) });
    });
    this.dock.addEventListener('dblclick', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-layer]');
      if (!b || b.dataset.layer === 'add') return;
      const i = Number(b.dataset.layer);
      const name = window.prompt('Rename layer', this.store.doc.get().layers[i].name);
      if (name?.trim()) this.store.dispatch({ t: 'layer.rename', index: i, name: name.trim() });
    });
  }

  destroy() {
    this.disposers.forEach((f) => f());
    for (const s of this.shells.values()) s.destroy();
    this.root.innerHTML = '';
    this.root.classList.remove('m7');
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

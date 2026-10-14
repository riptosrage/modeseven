import type { Layer, MenuItem, ModuleContext, ModuleDef, ModuleInstance, SurfaceOptions } from './types';
import { pack, type Cell } from './layout';
import { closeRadial, isRadialOpen, openRadial } from './radial';
import { icons } from './icons';

export const EMPTY = 'empty';
const SAVE_VERSION = 1;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1;
const MAX_ROWS = 4;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
let seq = 0;
export const newId = (prefix = 'm') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Make a module instance. Size defaults to the registered def's size, or 2×2. */
export function instance(type: string, extra: Partial<ModuleInstance> = {}): ModuleInstance {
  return { id: newId(), type, w: 2, h: 2, ...extra };
}

interface View {
  el: HTMLElement;
  sig: string;
  cleanup?: () => void;
  ro?: ResizeObserver;
  titleEl?: HTMLElement;
}

type Listener = (s: Surface) => void;

export class Surface {
  readonly root: HTMLElement;
  readonly canvas: HTMLElement;
  readonly grid: HTMLElement;
  private readonly dock: HTMLElement;

  layers: Layer[];
  current = 0;
  zoom = 1;

  private defs = new Map<string, ModuleDef>();
  private views = new Map<string, View>();
  private m = { cols: 4, pad: 16, gap: 12, cw: 0, rh: 0 };
  private cells = new Map<string, Cell>();
  private fullId: string | null = null;
  private veil: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private listeners = new Set<Listener>();
  private lastTap = { id: '', t: 0 };
  private teardown: (() => void)[] = [];

  constructor(private opts: SurfaceOptions) {
    this.root = opts.root;
    opts.modules.forEach((d) => this.defs.set(d.type, d));

    this.root.classList.add('slab');
    this.root.innerHTML = `<div class="slab-canvas"><div class="slab-grid"></div></div><nav class="slab-dock" aria-label="Layers"></nav>`;
    this.canvas = this.root.querySelector('.slab-canvas')!;
    this.grid = this.root.querySelector('.slab-grid')!;
    this.dock = this.root.querySelector('.slab-dock')!;

    const saved = this.restore();
    this.layers = saved?.layers ?? this.defaultLayers();
    this.current = clamp(saved?.current ?? 0, 0, this.layers.length - 1);
    this.zoom = clamp(saved?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
    this.layers.forEach((_, i) => this.ensureEmpties(i));

    this.bind();
    this.renderDock();
    this.layout(false);
  }

  /* ------------------------------------------------------------------ public */

  get layer(): Layer {
    return this.layers[this.current];
  }

  def(type: string) {
    return this.defs.get(type);
  }

  find(id: string) {
    for (const l of this.layers) {
      const it = l.items.find((i) => i.id === id);
      if (it) return it;
    }
    return undefined;
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Turn a slot (or any module) into a different module type. */
  replace(id: string, type: string, extra: Partial<ModuleInstance> = {}) {
    const it = this.find(id);
    if (!it) return;
    const d = this.defs.get(type);
    const [w, h] = d?.size ?? [it.w, it.h];
    Object.assign(it, { type, w, h, title: undefined, props: undefined }, extra);
    it.rev = (it.rev ?? 0) + 1;
    this.ensureEmpties();
    this.commit();
    this.layout();
    this.pop(id);
  }

  /** Drop a new module into the first open slot on the current layer. */
  add(type: string, extra: Partial<ModuleInstance> = {}) {
    const slot = this.layer.items.find((i) => i.type === EMPTY);
    if (slot) return this.replace(slot.id, type, extra), slot.id;
    const d = this.defs.get(type);
    const it = instance(type, { w: d?.size[0] ?? 2, h: d?.size[1] ?? 2, ...extra });
    this.layer.items.push(it);
    this.ensureEmpties();
    this.commit();
    this.layout();
    return it.id;
  }

  clear(id: string) {
    if (this.fullId === id) this.toggleFull(id);
    this.replace(id, EMPTY, { w: 2, h: 2 });
  }

  remove(id: string) {
    const l = this.layers.find((l) => l.items.some((i) => i.id === id));
    if (!l) return;
    l.items = l.items.filter((i) => i.id !== id);
    this.ensureEmpties();
    this.commit();
    this.layout();
  }

  setZoom(z: number) {
    const next = clamp(z, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.zoom = next;
    this.commit();
    this.layout();
  }

  switchLayer(i: number) {
    if (i < 0 || i >= this.layers.length || i === this.current) return;
    if (this.fullId) this.toggleFull(this.fullId);
    this.closeMenu();
    this.unmountAll();
    this.current = i;
    this.canvas.scrollTop = 0;
    this.commit();
    this.renderDock();
    this.layout(false);
  }

  addLayer(name = `Layer ${this.layers.length + 1}`) {
    this.layers.push({ id: newId('l'), name, items: [instance(EMPTY), instance(EMPTY), instance(EMPTY), instance(EMPTY)] });
    this.switchLayer(this.layers.length - 1);
  }

  renameLayer(i: number, name: string) {
    const l = this.layers[i];
    if (!l || !name.trim()) return;
    l.name = name.trim();
    this.commit();
    this.renderDock();
  }

  toggleFull(id: string) {
    if (this.fullId) {
      const prev = this.fullId;
      this.views.get(prev)?.el.classList.remove('is-full');
      this.veil?.remove();
      this.veil = null;
      this.fullId = null;
      if (prev === id) return;
    }
    const v = this.views.get(id);
    if (!v) return;
    const r = this.root.getBoundingClientRect();
    const inset = 16;
    v.el.style.setProperty('--full-l', `${r.left + inset}px`);
    v.el.style.setProperty('--full-t', `${r.top + inset}px`);
    v.el.style.setProperty('--full-w', `${r.width - inset * 2}px`);
    v.el.style.setProperty('--full-h', `${r.height - inset * 2}px`);
    this.veil = document.createElement('div');
    this.veil.className = 'slab-veil';
    this.veil.onclick = () => this.toggleFull(id);
    this.root.appendChild(this.veil);
    v.el.classList.add('is-full');
    this.fullId = id;
  }

  /** Wipe saved state and go back to the starting layers. */
  reset() {
    this.unmountAll();
    this.layers = this.defaultLayers();
    this.layers.forEach((_, i) => this.ensureEmpties(i));
    this.current = 0;
    this.zoom = 1;
    this.commit();
    this.renderDock();
    this.layout(false);
  }

  toJSON() {
    return { v: SAVE_VERSION, layers: this.layers, current: this.current, zoom: this.zoom };
  }

  destroy() {
    this.unmountAll();
    this.teardown.forEach((f) => f());
    this.root.innerHTML = '';
    this.root.classList.remove('slab');
  }

  /* ---------------------------------------------------------------- state */

  private defaultLayers(): Layer[] {
    const base = this.opts.layers ?? [{ id: 'l1', name: 'Layer 1', items: [] }];
    return structuredClone(base).map((l) => ({
      ...l,
      items: l.items.map((it) => ({ ...it, id: newId() })),
    }));
  }

  private restore(): { layers: Layer[]; current: number; zoom: number } | null {
    if (!this.opts.storageKey) return null;
    try {
      const raw = localStorage.getItem(this.opts.storageKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s?.v !== SAVE_VERSION || !Array.isArray(s.layers) || !s.layers.length) return null;
      for (const l of s.layers as Layer[]) {
        l.items = (l.items ?? []).map((it) => (this.defs.has(it.type) || it.type === EMPTY ? it : { ...it, type: EMPTY, w: 2, h: 2 }));
      }
      return s;
    } catch {
      return null;
    }
  }

  private commit() {
    if (this.opts.storageKey) {
      try {
        localStorage.setItem(this.opts.storageKey, JSON.stringify(this.toJSON()));
      } catch {
        /* storage full or blocked; keep going */
      }
    }
    this.listeners.forEach((f) => f(this));
  }

  private ensureEmpties(layerIndex = this.current) {
    const l = this.layers[layerIndex];
    const min = this.opts.minEmpty ?? 2;
    let n = l.items.filter((i) => i.type === EMPTY).length;
    while (n++ < min) l.items.push(instance(EMPTY));
  }

  /* --------------------------------------------------------------- layout */

  private measure() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const cols = W < 720 ? 2 : (this.opts.columns ?? 4);
    const pad = 16;
    const g = 12;
    const rows = this.opts.visibleRows ?? 4;
    const cw = (W - 2 * pad - (cols - 1) * g) / cols;
    const rh = cols >= 4 ? Math.max(110, (H - 2 * pad - (rows - 1) * g - 56) / rows) : Math.max(110, cw * 0.95);
    this.m = { cols, pad, gap: Math.max(6, Math.round(g * this.zoom)), cw: cw * this.zoom, rh: rh * this.zoom };
  }

  layout(animate = true) {
    if (!animate) this.root.classList.add('is-instant');
    this.measure();
    const { cols, pad, gap, cw, rh } = this.m;
    const { cells, rows } = pack(this.layer.items, cols);
    this.cells = cells;

    this.grid.style.width = `${cols * cw + (cols - 1) * gap}px`;
    this.grid.style.height = `${pad * 2 + rows * rh + Math.max(0, rows - 1) * gap + 70}px`;

    const live = new Set<string>();
    for (const it of this.layer.items) {
      live.add(it.id);
      let v = this.views.get(it.id);
      if (!v) {
        const el = document.createElement('div');
        el.className = 'slab-mod';
        el.dataset.id = it.id;
        this.grid.appendChild(el);
        v = { el, sig: '' };
        this.views.set(it.id, v);
      }
      const sig = `${it.type}|${it.rev ?? 0}`;
      if (v.sig !== sig) {
        v.sig = sig;
        this.mount(it, v);
      }
      const c = cells.get(it.id)!;
      const s = v.el.style;
      s.left = `${c.x * (cw + gap)}px`;
      s.top = `${pad + c.y * (rh + gap)}px`;
      s.width = `${c.w * cw + (c.w - 1) * gap}px`;
      s.height = `${c.h * rh + (c.h - 1) * gap}px`;
    }
    for (const [id, v] of this.views) if (!live.has(id)) this.unmount(id, v);

    if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('is-instant')));
  }

  private mount(it: ModuleInstance, v: View) {
    v.cleanup?.();
    v.cleanup = undefined;
    v.ro?.disconnect();
    v.ro = undefined;
    v.titleEl = undefined;

    const el = v.el;
    el.className = 'slab-mod';
    el.innerHTML = '';

    if (it.type === EMPTY) {
      el.classList.add('is-empty');
      el.innerHTML = `<div class="slab-plus" role="button" tabindex="0" aria-label="Add module"><span>${icons.plus}</span></div>`;
      return;
    }

    const d = this.defs.get(it.type);
    const head = document.createElement('div');
    head.className = 'slab-head';
    const title = document.createElement('span');
    title.className = 'slab-title';
    title.textContent = it.title ?? d?.title ?? it.type;
    const actions = document.createElement('div');
    actions.className = 'slab-actions';
    const more = document.createElement('button');
    more.className = 'slab-hb';
    more.dataset.slab = 'menu';
    more.setAttribute('aria-label', 'Module options');
    more.innerHTML = icons.dots;
    head.append(title, actions, more);

    const body = document.createElement('div');
    body.className = 'slab-body';
    el.append(head, body);
    if (d?.resizable !== false) {
      const handle = document.createElement('div');
      handle.className = 'slab-handle';
      handle.setAttribute('aria-label', 'Resize');
      el.appendChild(handle);
    }
    v.titleEl = title;

    if (!d) {
      body.innerHTML = `<div class="slab-missing">No module called “${it.type}”</div>`;
      return;
    }

    const resizeCbs: ((r: DOMRectReadOnly) => void)[] = [];
    v.ro = new ResizeObserver((es) => {
      const r = es[0]?.contentRect;
      if (r && r.width && r.height) resizeCbs.forEach((cb) => cb(r));
    });
    v.ro.observe(body);

    const ctx: ModuleContext = {
      instance: it,
      surface: this,
      header: actions,
      body,
      onResize: (cb) => void resizeCbs.push(cb),
      setTitle: (t) => {
        it.title = t;
        title.textContent = t;
        this.commit();
      },
      setProps: (patch) => {
        it.props = { ...(it.props ?? {}), ...patch };
        this.commit();
      },
    };

    try {
      const c = d.mount(body, ctx);
      if (typeof c === 'function') v.cleanup = c;
    } catch (err) {
      console.error(`[slab] module "${it.type}" failed to mount`, err);
      body.innerHTML = `<div class="slab-missing">This module crashed. Check the console.</div>`;
    }
  }

  private unmount(id: string, v: View) {
    v.cleanup?.();
    v.ro?.disconnect();
    v.el.remove();
    this.views.delete(id);
  }

  private unmountAll() {
    for (const [id, v] of this.views) this.unmount(id, v);
  }

  private pop(id: string) {
    const el = this.views.get(id)?.el;
    if (!el) return;
    el.classList.remove('is-pop');
    void el.offsetWidth;
    el.classList.add('is-pop');
  }

  /* --------------------------------------------------------------- input */

  private bind() {
    const listen = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement | Document,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, o);
      this.teardown.push(() => target.removeEventListener(type, fn as EventListener, o));
    };

    listen(this.grid, 'pointerdown', (e) => {
      const target = e.target as HTMLElement;
      const el = target.closest<HTMLElement>('.slab-mod');
      if (!el) return;
      const it = this.layer.items.find((i) => i.id === el.dataset.id);
      if (!it) return;
      if (target.closest('.slab-handle')) return this.startResize(e, it, el);
      if (target.closest('.slab-plus')) return this.startAdd(e, it, el);
      const head = target.closest<HTMLElement>('.slab-head');
      if (head && !target.closest('button')) return this.startDrag(e, it, el, head);
    });

    listen(this.grid, 'click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slab="menu"]');
      if (!b) return;
      const it = this.find(b.closest<HTMLElement>('.slab-mod')!.dataset.id!);
      if (it) this.openMenu(b, it);
    });

    listen(this.grid, 'keydown', (e) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('slab-plus')) {
        e.preventDefault();
        const el = t.closest<HTMLElement>('.slab-mod')!;
        const it = this.find(el.dataset.id!);
        if (it) this.openAdd(el, it, 'tap');
      }
    });

    listen(
      document,
      'pointerdown',
      (e) => {
        if (this.menu && !(e.target as HTMLElement).closest('.slab-menu,[data-slab="menu"]')) this.closeMenu();
      },
      { capture: true },
    );

    let acc = 0;
    let cool = 0;
    listen(
      this.canvas,
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.01));
          return;
        }
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
          e.preventDefault();
          const now = performance.now();
          if (now < cool) return;
          acc += e.deltaX;
          if (Math.abs(acc) > 120) {
            this.switchLayer(clamp(this.current + (acc > 0 ? 1 : -1), 0, this.layers.length - 1));
            acc = 0;
            cool = now + 600;
          }
        }
      },
      { passive: false },
    );

    listen(window, 'keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input,textarea,[contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        if (isRadialOpen()) closeRadial();
        else if (this.menu) this.closeMenu();
        else if (this.fullId) this.toggleFull(this.fullId);
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ']') this.switchLayer(Math.min(this.current + 1, this.layers.length - 1));
      if (e.key === '[') this.switchLayer(Math.max(this.current - 1, 0));
      if (e.key === '-') this.setZoom(this.zoom - 0.15);
      if (e.key === '=' || e.key === '+') this.setZoom(this.zoom + 0.15);
      if (e.key === '0') this.setZoom(1);
    });

    let rt = 0;
    listen(window, 'resize', () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => this.layout(false), 40);
    });

    listen(this.dock, 'click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.layer === 'add') this.addLayer();
      else this.switchLayer(Number(b.dataset.layer));
    });
    listen(this.dock, 'dblclick', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-layer]');
      if (!b || b.dataset.layer === 'add') return;
      const i = Number(b.dataset.layer);
      const name = window.prompt('Rename layer', this.layers[i].name);
      if (name) this.renameLayer(i, name);
    });
  }

  private startResize(e: PointerEvent, it: ModuleInstance, el: HTMLElement) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.target as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const d = this.defs.get(it.type);
    const [minW, minH] = d?.minSize ?? [1, 1];
    const [maxW, maxH] = d?.maxSize ?? [this.m.cols, MAX_ROWS];
    const start = { x: e.clientX, y: e.clientY, w: Math.min(it.w, this.m.cols), h: it.h, pw: el.offsetWidth, ph: el.offsetHeight };

    el.classList.add('is-editing');
    const ghost = document.createElement('div');
    ghost.className = 'slab-ghost';
    this.grid.appendChild(ghost);
    const badge = document.createElement('div');
    badge.className = 'slab-badge';
    badge.textContent = `${start.w} × ${start.h}`;
    el.appendChild(badge);

    const move = (ev: PointerEvent) => {
      const { cw, rh, gap, cols } = this.m;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      ghost.style.left = el.style.left;
      ghost.style.top = el.style.top;
      ghost.style.width = `${Math.max(cw * 0.6, start.pw + dx)}px`;
      ghost.style.height = `${Math.max(rh * 0.6, start.ph + dy)}px`;
      const nw = clamp(Math.round(start.w + dx / (cw + gap)), minW, Math.min(maxW, cols));
      const nh = clamp(Math.round(start.h + dy / (rh + gap)), minH, maxH);
      if (nw !== Math.min(it.w, cols) || nh !== it.h) {
        it.w = nw;
        it.h = nh;
        badge.textContent = `${nw} × ${nh}`;
        this.layout();
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      el.classList.remove('is-editing');
      ghost.remove();
      badge.remove();
      this.commit();
      this.layout();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  private startDrag(e: PointerEvent, it: ModuleInstance, el: HTMLElement, head: HTMLElement) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let clone: HTMLElement | null = null;
    let ox = 0;
    let oy = 0;
    let lastTarget: string | null = null;
    head.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5 || this.fullId === it.id) return;
        started = true;
        this.closeMenu();
        const r = el.getBoundingClientRect();
        ox = x0 - r.left;
        oy = y0 - r.top;
        clone = el.cloneNode(true) as HTMLElement;
        clone.classList.add('is-floating');
        clone.style.width = `${r.width}px`;
        clone.style.height = `${r.height}px`;
        const src = el.querySelectorAll('canvas');
        clone.querySelectorAll('canvas').forEach((c, i) => {
          c.width = src[i].width;
          c.height = src[i].height;
          c.getContext('2d')?.drawImage(src[i], 0, 0);
        });
        document.body.appendChild(clone);
        el.classList.add('is-placeholder');
      }
      clone!.style.left = `${ev.clientX - ox}px`;
      clone!.style.top = `${ev.clientY - oy}px`;

      const cr = this.canvas.getBoundingClientRect();
      if (ev.clientY > cr.bottom - 50) this.canvas.scrollTop += 12;
      else if (ev.clientY < cr.top + 40) this.canvas.scrollTop -= 12;

      // Hit-test against the layout model, not the DOM, so tiles that are
      // still animating into place can't bounce the drop target around.
      const gr = this.grid.getBoundingClientRect();
      const { cw, rh, gap, pad } = this.m;
      const col = Math.floor((ev.clientX - gr.left) / (cw + gap));
      const row = Math.floor((ev.clientY - gr.top - pad) / (rh + gap));
      const own = this.cells.get(it.id);
      if (own && col >= own.x && col < own.x + own.w && row >= own.y && row < own.y + own.h) {
        lastTarget = null;
        return;
      }
      let tid: string | null = null;
      for (const [id, c] of this.cells) {
        if (id !== it.id && col >= c.x && col < c.x + c.w && row >= c.y && row < c.y + c.h) tid = id;
      }
      if (!tid || tid === lastTarget) return;
      lastTarget = tid;
      const items = this.layer.items;
      const from = items.indexOf(it);
      const to = items.findIndex((x) => x.id === tid);
      items.splice(from, 1);
      items.splice(to, 0, it);
      this.layout();
    };

    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      if (started) {
        clone?.remove();
        el.classList.remove('is-placeholder');
        this.commit();
        this.layout();
        return;
      }
      const now = performance.now();
      if (this.lastTap.id === it.id && now - this.lastTap.t < 320) {
        this.toggleFull(it.id);
        this.lastTap = { id: '', t: 0 };
      } else this.lastTap = { id: it.id, t: now };
    };

    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  private startAdd(e: PointerEvent, it: ModuleInstance, el: HTMLElement) {
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    let opened = false;
    el.classList.add('is-armed');
    const timer = window.setTimeout(() => {
      opened = true;
      this.openAdd(el, it, 'hold', x, y);
    }, 170);
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!opened) this.openAdd(el, it, 'tap');
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private openAdd(el: HTMLElement, slot: ModuleInstance, mode: 'hold' | 'tap', x?: number, y?: number) {
    this.closeMenu();
    const r = el.getBoundingClientRect();
    el.classList.add('is-armed');
    openRadial({
      x: x ?? r.left + r.width / 2,
      y: y ?? r.top + r.height / 2,
      nodes: this.opts.addMenu,
      mode,
      onClose: () => el.classList.remove('is-armed'),
      onChoose: (key) => {
        el.classList.remove('is-armed');
        if (this.opts.onAddAction?.(key, slot, this)) return;
        if (this.defs.has(key)) this.replace(slot.id, key);
      },
    });
  }

  private openMenu(btn: HTMLElement, it: ModuleInstance) {
    this.closeMenu();
    const items: MenuItem[] = [
      ...(this.opts.moduleMenu?.(it, this) ?? []),
      { label: this.fullId === it.id ? 'Exit full screen' : 'Full screen', run: () => this.toggleFull(it.id) },
      { label: 'Clear slot', danger: true, run: () => this.clear(it.id) },
    ];
    const menu = document.createElement('div');
    menu.className = 'slab-menu';
    menu.setAttribute('role', 'menu');
    items.forEach((m) => {
      const b = document.createElement('button');
      b.textContent = m.label;
      b.setAttribute('role', 'menuitem');
      if (m.danger) b.classList.add('is-danger');
      b.onclick = () => {
        this.closeMenu();
        m.run();
      };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = `${clamp(r.right - menu.offsetWidth, 8, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${clamp(r.bottom + 4, 8, innerHeight - menu.offsetHeight - 8)}px`;
    this.menu = menu;
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private renderDock() {
    this.dock.innerHTML =
      this.layers
        .map(
          (l, i) =>
            `<button class="${i === this.current ? 'is-on' : ''}" data-layer="${i}" title="Double-click to rename"><span class="slab-num">${i + 1}</span>${escapeHtml(l.name)}</button>`,
        )
        .join('') + `<button data-layer="add" aria-label="Add layer">${icons.plusSmall}</button>`;
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

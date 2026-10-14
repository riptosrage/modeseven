import type { RadialNode } from '../modules/types';

export interface RadialOptions {
  x: number;
  y: number;
  nodes: RadialNode[];
  /** "hold": pick by releasing over a node. "tap": pick by tapping a node. */
  mode: 'hold' | 'tap';
  onChoose(key: string): void;
  onClose?(): void;
}

interface Live {
  node: RadialNode;
  el: HTMLElement;
  x: number;
  y: number;
  ang: number;
  kid: boolean;
}

const RING = 82;
const KID_RING = 150;
const KID_SPREAD = 26;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** iOS-style radial add menu. Opens around the finger; nodes with children open a second ring on hover. */
export class Radial {
  private o: RadialOptions | null = null;
  private mode: 'hold' | 'tap' = 'tap';
  private layer: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private live: Live[] = [];
  private kidsOf: Live | null = null;
  private cx = 0;
  private cy = 0;

  constructor(private host: HTMLElement) {}

  get open() {
    return this.o !== null;
  }

  show(o: RadialOptions) {
    this.close(false);
    this.o = o;
    this.mode = o.mode;
    this.cx = clamp(o.x, 170, innerWidth - 170);
    this.cy = clamp(o.y, 170, innerHeight - 120);
    const layer = document.createElement('div');
    layer.className = 'm7-radial';
    layer.innerHTML = `<div class="m7-radial-core" style="left:${this.cx}px;top:${this.cy}px"></div><div class="m7-radial-label" hidden></div>`;
    this.host.appendChild(layer);
    this.layer = layer;
    this.label = layer.querySelector('.m7-radial-label');
    const step = 360 / o.nodes.length;
    o.nodes.forEach((n, i) => this.add(n, -90 + i * step, RING, false));
    requestAnimationFrame(() => this.live.forEach((l) => l.el.classList.add('is-in')));
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    layer.addEventListener('pointerdown', this.onDown);
  }

  close(notify = true) {
    if (!this.o) return;
    const o = this.o;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.layer?.remove();
    this.layer = this.label = null;
    this.live = [];
    this.kidsOf = null;
    this.o = null;
    if (notify) o.onClose?.();
  }

  private add(node: RadialNode, ang: number, r: number, kid: boolean) {
    const a = (ang * Math.PI) / 180;
    const x = this.cx + Math.cos(a) * r;
    const y = this.cy + Math.sin(a) * r;
    const el = document.createElement('div');
    el.className = 'm7-radial-node' + (kid ? ' is-kid' : '') + (node.children?.length ? ' has-kids' : '');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = node.icon;
    el.setAttribute('aria-label', node.label);
    el.dataset.key = node.key;
    this.layer!.appendChild(el);
    const l = { node, el, x, y, ang, kid };
    this.live.push(l);
    return l;
  }

  private spawn(p: Live) {
    if (this.kidsOf === p) return;
    this.drop();
    this.kidsOf = p;
    const kids = p.node.children ?? [];
    const start = p.ang - (KID_SPREAD * (kids.length - 1)) / 2;
    kids.forEach((k, i) => {
      const l = this.add(k, start + i * KID_SPREAD, KID_RING, true);
      requestAnimationFrame(() => l.el.classList.add('is-in'));
    });
  }

  private drop() {
    if (!this.kidsOf) return;
    this.live = this.live.filter((l) => (l.kid ? (l.el.remove(), false) : true));
    this.kidsOf = null;
  }

  private hit(x: number, y: number) {
    let best: Live | null = null;
    let bd = Infinity;
    for (const l of this.live) {
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < (l.kid ? 28 : 32) && d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  private hot(h: Live | null) {
    this.live.forEach((l) => l.el.classList.toggle('is-hot', l === h));
    if (!this.label) return;
    this.label.hidden = !h;
    if (h) {
      this.label.textContent = h.node.label;
      this.label.style.left = `${h.x}px`;
      this.label.style.top = `${h.y}px`;
    }
  }

  private choose(key: string) {
    const o = this.o!;
    this.close(false);
    o.onChoose(key);
  }

  private onMove = (e: PointerEvent) => {
    const h = this.hit(e.clientX, e.clientY);
    if (h?.node.children?.length) this.spawn(h);
    else if (h && !h.kid && this.kidsOf && h !== this.kidsOf) this.drop();
    this.hot(h);
  };

  private onUp = (e: PointerEvent) => {
    if (this.mode !== 'hold') return;
    const h = this.hit(e.clientX, e.clientY);
    if (h && !h.node.children?.length) return this.choose(h.node.key);
    this.mode = 'tap';
  };

  private onDown = (e: PointerEvent) => {
    e.stopPropagation();
    if (this.mode !== 'tap') return;
    const h = this.hit(e.clientX, e.clientY);
    if (!h) return this.close();
    if (h.node.children?.length) {
      this.spawn(h);
      this.hot(h);
      return;
    }
    this.choose(h.node.key);
  };
}

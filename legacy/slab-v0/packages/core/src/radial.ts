import type { RadialNode } from './types';

export interface RadialOptions {
  x: number;
  y: number;
  nodes: RadialNode[];
  /** "hold": pick by releasing over a node. "tap": pick by tapping a node. */
  mode: 'hold' | 'tap';
  onChoose(key: string): void;
  onClose(): void;
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
const KID_RING = 156;
const KID_SPREAD = 24;

let R: {
  o: RadialOptions;
  mode: 'hold' | 'tap';
  overlay: HTMLElement;
  label: HTMLElement;
  live: Live[];
  kidsOf: Live | null;
  hot: Live | null;
} | null = null;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function isRadialOpen() {
  return R !== null;
}

export function openRadial(o: RadialOptions) {
  closeRadial(false);
  const x = clamp(o.x, 170, innerWidth - 170);
  const y = clamp(o.y, 170, innerHeight - 110);
  const overlay = document.createElement('div');
  overlay.className = 'slab-radial';
  overlay.innerHTML = `<div class="slab-radial-core" style="left:${x}px;top:${y}px"></div><div class="slab-radial-label" hidden></div>`;
  document.body.appendChild(overlay);
  R = { o: { ...o, x, y }, mode: o.mode, overlay, label: overlay.querySelector('.slab-radial-label')!, live: [], kidsOf: null, hot: null };

  const step = 360 / o.nodes.length;
  o.nodes.forEach((n, i) => addNode(n, -90 + i * step, RING, false));
  requestAnimationFrame(() => R?.live.forEach((l) => l.el.classList.add('is-in')));

  window.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerdown', onTapDown);
  if (o.mode === 'hold') window.addEventListener('pointerup', onHoldUp, { once: true });
}

export function closeRadial(notify = true) {
  if (!R) return;
  const { o, overlay } = R;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onHoldUp);
  overlay.remove();
  R = null;
  if (notify) o.onClose();
}

function addNode(node: RadialNode, ang: number, radius: number, kid: boolean): Live {
  const a = (ang * Math.PI) / 180;
  const x = R!.o.x + Math.cos(a) * radius;
  const y = R!.o.y + Math.sin(a) * radius;
  const el = document.createElement('div');
  el.className = 'slab-radial-node' + (kid ? ' is-kid' : '') + (node.children?.length ? ' has-kids' : '');
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = node.icon;
  el.setAttribute('aria-label', node.label);
  R!.overlay.appendChild(el);
  const live = { node, el, x, y, ang, kid };
  R!.live.push(live);
  return live;
}

function spawnKids(parent: Live) {
  if (!R || R.kidsOf === parent) return;
  dropKids();
  R.kidsOf = parent;
  const kids = parent.node.children ?? [];
  const start = parent.ang - (KID_SPREAD * (kids.length - 1)) / 2;
  kids.forEach((k, i) => {
    const l = addNode(k, start + i * KID_SPREAD, KID_RING, true);
    requestAnimationFrame(() => l.el.classList.add('is-in'));
  });
}

function dropKids() {
  if (!R?.kidsOf) return;
  R.live = R.live.filter((l) => {
    if (!l.kid) return true;
    l.el.remove();
    return false;
  });
  R.kidsOf = null;
}

function hitTest(x: number, y: number): Live | null {
  if (!R) return null;
  let best: Live | null = null;
  let bd = Infinity;
  for (const l of R.live) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < (l.kid ? 28 : 32) && d < bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

function setHot(h: Live | null) {
  if (!R) return;
  R.hot = h;
  R.live.forEach((l) => l.el.classList.toggle('is-hot', l === h));
  if (h) {
    R.label.hidden = false;
    R.label.textContent = h.node.label;
    R.label.style.left = h.x + 'px';
    R.label.style.top = h.y + 'px';
  } else R.label.hidden = true;
}

function onMove(e: PointerEvent) {
  if (!R) return;
  const h = hitTest(e.clientX, e.clientY);
  if (h?.node.children?.length) spawnKids(h);
  else if (h && !h.kid && R.kidsOf && h !== R.kidsOf) dropKids();
  setHot(h);
}

function choose(key: string) {
  if (!R) return;
  const { onChoose } = R.o;
  closeRadial(false);
  onChoose(key);
}

function onHoldUp(e: PointerEvent) {
  if (!R) return;
  const h = hitTest(e.clientX, e.clientY);
  if (h && !h.node.children?.length) return choose(h.node.key);
  R.mode = 'tap';
}

function onTapDown(e: PointerEvent) {
  if (!R || R.mode !== 'tap') return;
  const h = hitTest(e.clientX, e.clientY);
  if (!h) return closeRadial();
  if (h.node.children?.length) {
    spawnKids(h);
    setHot(h);
    return;
  }
  choose(h.node.key);
}

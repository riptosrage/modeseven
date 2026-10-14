import { defineModule, svg } from '@mode7/core';

/** Two values at once. Drag the dot. */
export const xy = defineModule({
  type: 'xy',
  title: 'XY pad',
  icon: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="14" cy="10" r="2"/>'),
  size: [2, 2],
  minSize: [2, 2],
  mount(el, ctx) {
    el.classList.add('xy-wrap');
    el.innerHTML = `<div class="xy" data-m7-interactive><i class="xy-h"></i><i class="xy-v"></i><b class="xy-dot"></b></div><div class="xy-val"></div>`;
    const pad = el.querySelector<HTMLElement>('.xy')!;
    const dot = el.querySelector<HTMLElement>('.xy-dot')!;
    const hl = el.querySelector<HTMLElement>('.xy-h')!;
    const vl = el.querySelector<HTMLElement>('.xy-v')!;
    const val = el.querySelector<HTMLElement>('.xy-val')!;
    let x = Number(ctx.record.get().props?.x ?? 0.62);
    let y = Number(ctx.record.get().props?.y ?? 0.34);
    const paint = () => {
      dot.style.left = vl.style.left = `${x * 100}%`;
      dot.style.top = hl.style.top = `${y * 100}%`;
      val.textContent = `${Math.round(x * 100)} · ${Math.round((1 - y) * 100)}`;
    };
    paint();
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const set = (ev: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
        paint();
      };
      set(e);
      const up = () => {
        pad.removeEventListener('pointermove', set);
        pad.removeEventListener('pointerup', up);
        ctx.setProps({ x, y });
      };
      pad.addEventListener('pointermove', set);
      pad.addEventListener('pointerup', up);
    });
  },
});

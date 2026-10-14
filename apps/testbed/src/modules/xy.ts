import { defineModule, param, svg } from '@mode7/core';

const pct = { format: (v: number) => String(Math.round(v * 100)) };

/** Two values at once. Drag the dot. Each axis is its own param, so each can be MIDI-mapped. */
export const xy = defineModule({
  type: 'xy',
  title: 'XY pad',
  icon: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="14" cy="10" r="2"/>'),
  size: [2, 2],
  minSize: [2, 2],
  params: {
    x: param.number(0, 1, 0.62, { label: 'X', ...pct }),
    y: param.number(0, 1, 0.66, { label: 'Y', ...pct }),
  },
  mount(el, ctx) {
    const px = ctx.param('x');
    const py = ctx.param('y');
    el.classList.add('xy-wrap');
    el.innerHTML = `<div class="xy" data-m7-interactive><i class="xy-h"></i><i class="xy-v"></i><b class="xy-dot"></b></div><div class="xy-val"><span data-m7-param="x"></span> · <span data-m7-param="y"></span></div>`;
    const pad = el.querySelector<HTMLElement>('.xy')!;
    const dot = el.querySelector<HTMLElement>('.xy-dot')!;
    const hl = el.querySelector<HTMLElement>('.xy-h')!;
    const vl = el.querySelector<HTMLElement>('.xy-v')!;
    const [xv, yv] = el.querySelectorAll<HTMLElement>('.xy-val span');
    const paint = () => {
      const x = Number(px.get());
      const y = Number(py.get());
      dot.style.left = vl.style.left = `${x * 100}%`;
      dot.style.top = hl.style.top = `${(1 - y) * 100}%`;
      xv.textContent = px.text();
      yv.textContent = py.text();
    };
    paint();
    const offs = [px.subscribe(paint), py.subscribe(paint)];
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      ctx.begin(); // both axes, one undo step
      const set = (ev: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        px.set((ev.clientX - r.left) / r.width);
        py.set(1 - (ev.clientY - r.top) / r.height);
      };
      set(e);
      const up = () => {
        ctx.end();
        pad.removeEventListener('pointermove', set);
        pad.removeEventListener('pointerup', up);
        pad.removeEventListener('pointercancel', up);
      };
      pad.addEventListener('pointermove', set);
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
    });
    return () => offs.forEach((f) => f());
  },
});

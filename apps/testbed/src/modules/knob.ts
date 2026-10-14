import { defineModule, svg } from '@mode7/core';

/**
 * One value, drag up/down. Tests a control that drags inside a module body:
 * it must win over the board's own gestures in Use mode.
 */
export const knob = defineModule({
  type: 'knob',
  title: 'Knob',
  icon: svg('<circle cx="12" cy="12" r="7"/><path d="M12 12l3-4"/>'),
  size: [1, 1],
  maxSize: [3, 3],
  mount(el, ctx) {
    let v = Number(ctx.record.get().props?.value ?? 0.5);
    el.classList.add('knob-wrap');
    el.innerHTML = `<div class="knob" data-m7-interactive><div class="knob-cap"><i></i></div></div><div class="knob-val"></div>`;
    const knob = el.querySelector<HTMLElement>('.knob')!;
    const cap = el.querySelector<HTMLElement>('.knob-cap')!;
    const val = el.querySelector<HTMLElement>('.knob-val')!;
    const paint = () => {
      cap.style.transform = `rotate(${-135 + v * 270}deg)`;
      val.textContent = String(Math.round(v * 100));
    };
    paint();
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      knob.setPointerCapture(e.pointerId);
      const y0 = e.clientY;
      const v0 = v;
      const move = (ev: PointerEvent) => {
        v = Math.max(0, Math.min(1, v0 + (y0 - ev.clientY) / 160));
        paint();
      };
      const up = () => {
        knob.removeEventListener('pointermove', move);
        knob.removeEventListener('pointerup', up);
        ctx.setProps({ value: v });
      };
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
    });
  },
});

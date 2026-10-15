import { defineModule, param, svg } from '@mode7/core';

/**
 * One value, drag up/down. Double-tap to reset.
 * It declares its param, so MIDI learn, `set knob 80`, undo and saving all work with no extra code.
 */
export const knob = defineModule({
  type: 'knob',
  title: 'Knob',
  icon: svg('<circle cx="12" cy="12" r="7"/><path d="M12 12l3-4"/>'),
  size: [1, 1],
  maxSize: [3, 3],
  params: { value: param.number(0, 100, 50, { unit: '%', label: 'Value' }) },
  mount(el, ctx) {
    const value = ctx.param('value');
    el.classList.add('knob-wrap');
    el.innerHTML = `<div class="knob" data-m7-interactive data-m7-param="value" role="slider" aria-label="Value" tabindex="0"><div class="knob-cap"><i></i></div></div><div class="knob-val"></div>`;
    const knob = el.querySelector<HTMLElement>('.knob')!;
    const cap = el.querySelector<HTMLElement>('.knob-cap')!;
    const val = el.querySelector<HTMLElement>('.knob-val')!;
    // Paint from the param, whoever changed it: this drag, MIDI, undo, a command.
    const paint = () => {
      cap.style.transform = `rotate(${-135 + value.normal() * 270}deg)`;
      knob.style.setProperty('--v', String(value.normal()));
      val.textContent = String(Math.round(Number(value.get())));
      knob.setAttribute('aria-valuenow', String(value.get()));
    };
    paint();
    const off = value.subscribe(paint);

    let lastTap = 0;
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.timeStamp - lastTap < 300) return value.set(value.spec.default);
      lastTap = e.timeStamp;
      knob.setPointerCapture(e.pointerId);
      const y0 = e.clientY;
      const n0 = value.normal();
      value.begin();
      const move = (ev: PointerEvent) => value.setNormal(n0 + (y0 - ev.clientY) / 160);
      const up = () => {
        value.end();
        knob.removeEventListener('pointermove', move);
        knob.removeEventListener('pointerup', up);
        knob.removeEventListener('pointercancel', up);
      };
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
      knob.addEventListener('pointercancel', up);
    });
    return off;
  },
});

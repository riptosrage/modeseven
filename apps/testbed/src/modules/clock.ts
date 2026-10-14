import { defineModule, svg } from '@mode7/core';

/** A readout. Shows how one module can change its view by size class. */
export const clock = defineModule({
  type: 'clock',
  title: 'Clock',
  icon: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  size: [2, 1],
  mount(el, ctx) {
    el.classList.add('clock');
    let timer = 0;
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const cls = ctx.size.get().cls;
      const time = cls === 'tile' ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getHours())}:${p(d.getMinutes())}<span>:${p(d.getSeconds())}</span>`;
      el.innerHTML = `<div class="clock-time">${time}</div>${cls === 'tile' ? '' : `<div class="clock-date">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>`}`;
      if (ctx.visible.get()) timer = window.setTimeout(tick, 1000 - d.getMilliseconds());
    };
    tick();
    const offVis = ctx.visible.subscribe((v) => (clearTimeout(timer), v && tick()));
    const off = ctx.size.subscribe(() => {
      clearTimeout(timer);
      tick();
    });
    return () => {
      clearTimeout(timer);
      off();
      offVis();
    };
  },
});

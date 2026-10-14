import { defineModule, SIZE_NAMES, svg } from '@mode7/core';

const TINTS = ['#e2372c', '#2c6bed', '#1f9d6b', '#e0a400', '#8b5cf6', '#14181e'];

/**
 * The testbed's placeholder. It shows what the engine knows about it: its
 * size, size class and cell position, with a different view per class, the
 * way a real module should.
 */
export const blank = defineModule({
  type: 'blank',
  title: 'Blank',
  icon: svg('<rect x="5" y="5" width="14" height="14" rx="3"/>'),
  size: [2, 2],
  mount(el, ctx) {
    el.classList.add('blank');

    // A header button to cycle the tint: proves header slots and props work.
    const btn = document.createElement('button');
    btn.className = 'blank-tint';
    btn.setAttribute('aria-label', 'Change colour');
    btn.dataset.m7Zone = 'chrome';
    btn.onclick = () => ctx.setProps({ tint: (Number(ctx.record.get().props?.tint ?? 0) + 1) % TINTS.length });
    ctx.header.appendChild(btn);

    const render = () => {
      const s = ctx.size.get();
      const tint = TINTS[Number(ctx.record.get().props?.tint ?? 0) % TINTS.length];
      el.style.setProperty('--tint', tint);
      btn.style.setProperty('--tint', tint);
      el.dataset.cls = s.focused ? 'focus' : s.cls;
      const cells = s.w * s.h <= 64 ? Array.from({ length: s.w * s.h }, () => '<i></i>').join('') : '';
      el.innerHTML = `
        <div class="blank-cells" style="--w:${s.w};--h:${s.h}">${cells}</div>
        <div class="blank-dot"></div>
        <div class="blank-size">${s.w}×${s.h}</div>
        <div class="blank-meta"><span>${s.focused ? 'Full screen' : SIZE_NAMES[s.cls]}</span><span>x ${s.x} · y ${s.y}</span></div>`;
    };
    render();
    const offSize = ctx.size.subscribe(render);
    const offRec = ctx.record.subscribe(render);
    return () => {
      offSize();
      offRec();
    };
  },
});

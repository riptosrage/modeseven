import { defineModule, svg } from '@mode7/core';

/** A text note. Tests that interactive content keeps its own input in Use mode and goes inert in Arrange. */
export const note = defineModule({
  type: 'note',
  title: 'Note',
  icon: svg('<path d="M6 4h9l3 3v13H6z"/><path d="M9 10h6M9 14h6"/>'),
  size: [2, 2],
  mount(el, ctx) {
    const ta = document.createElement('textarea');
    ta.className = 'note';
    ta.placeholder = 'Type something…';
    ta.value = String(ctx.record.get().props?.text ?? '');
    let t = 0;
    ta.oninput = () => {
      clearTimeout(t);
      t = window.setTimeout(() => ctx.setProps({ text: ta.value }), 400);
    };
    el.appendChild(ta);
    return () => clearTimeout(t);
  },
});

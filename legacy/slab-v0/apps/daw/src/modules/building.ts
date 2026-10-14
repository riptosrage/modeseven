import { defineModule, escapeHtml } from '@slab/core';

/**
 * Placeholder shown while "AI" builds a module. Today it fakes it: after a
 * beat it swaps itself for a canned module. This is the seam where a real
 * prompt → module-code generator plugs in.
 */
export const building = defineModule({
  type: 'building',
  title: 'New module',
  size: [2, 2],
  resizable: false,
  mount(body, ctx) {
    const prompt = String(ctx.instance.props?.prompt ?? '');
    const restore = ctx.instance.props?.restore as { type: string; title?: string; w: number; h: number } | undefined;
    body.innerHTML = `<div class="build"><span class="tag">${restore ? 'Updating module' : 'Building module'}</span><q>${escapeHtml(prompt)}</q><div class="prog"><b></b></div></div>`;

    const t = window.setTimeout(() => {
      const s = ctx.surface;
      if (restore) {
        s.replace(ctx.instance.id, restore.type, { title: restore.title, w: restore.w, h: restore.h });
        document.dispatchEvent(new CustomEvent('slab:toast', { detail: 'Mock: prompt saved. Real edits land once module code is live.' }));
        return;
      }
      const type = /fader|volume|level|send|gain/i.test(prompt) ? 'fader' : /mix/i.test(prompt) ? 'mixer' : 'sampler';
      s.replace(ctx.instance.id, type, { title: titleFrom(prompt) });
    }, 900);
    return () => clearTimeout(t);
  },
});

function titleFrom(t: string) {
  t = t.replace(/^(make|build|give)( me)?( a| an)?\s+/i, '').trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 30 ? t.slice(0, 29) + '…' : t;
}

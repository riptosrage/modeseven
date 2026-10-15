import type { ModuleDef } from './types';
import { defineModule } from './types';
import { param } from '../params/spec';
import { svg, icons } from '../render/icons';

/**
 * Modules as source code that lives in the board itself.
 *
 * A custom module is a small plain-JavaScript file saved in the doc
 * (`doc.types`), so a board carries its own modules wherever it goes:
 * a saved file, a replay, a sync. Edit the source and every module of that
 * type swaps to the new code in place. Its state lives in the doc (params,
 * props), so nothing is lost.
 *
 * The format has no imports; the engine hands in what a module needs:
 *
 *   export default ({ defineModule, param, svg }) => defineModule({
 *     title: 'Meter',
 *     size: [2, 2],
 *     params: { level: param.number(0, 100, 40, { unit: '%' }) },
 *     mount(el, ctx) { ... },
 *   });
 *
 * Code runs with the page's full powers, so code that arrived from outside
 * (an opened file) only runs once the person trusts it. AI-written modules
 * will run in a sandboxed frame instead; same format.
 */

/** What a module's source gets to work with. Grows deliberately, never by accident. */
export const moduleApi = { defineModule, param, svg, icons };
export type ModuleApi = typeof moduleApi;

/** Turn source into a module definition, or throw an Error that says what's wrong. Pure apart from evaluating the code. */
export function compileModule(source: string, type: string): ModuleDef {
  if (/^\s*import\s/m.test(source)) throw new Error('Modules can’t use import. Everything they need is passed in: ({ defineModule, param, svg }) => …');
  const body = source.replace(/^\s*export\s+default\s+/m, 'return ');
  if (body === source) throw new Error('A module needs `export default`. Start from: export default ({ defineModule }) => defineModule({ … })');
  let made: unknown;
  try {
    // eslint-disable-next-line no-new-func
    made = new Function(`"use strict";\n${body}\n//# sourceURL=mode7-module-${type.replace(/[^\w-]/g, '_')}.js`)();
  } catch (e) {
    throw new Error(`Couldn’t read the code: ${(e as Error).message}`);
  }
  let def = made as Partial<ModuleDef>;
  if (typeof made === 'function') {
    try {
      def = (made as (api: ModuleApi) => Partial<ModuleDef>)(moduleApi);
    } catch (e) {
      throw new Error(`The module threw while being defined: ${(e as Error).message}`);
    }
  }
  if (!def || typeof def !== 'object') throw new Error('`export default` should give a module: defineModule({ … }).');
  if (typeof def.mount !== 'function') throw new Error('The module needs a mount(el, ctx) function.');
  const size = Array.isArray(def.size) && def.size.length === 2 ? def.size : [2, 2];
  return { ...def, type, title: String(def.title ?? type), size: size as [number, number], mount: def.mount };
}

/** SHA-256 of the source, for remembering which code the person has trusted. Null where crypto isn't available. */
export async function hashSource(source: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where trusted code hashes are kept. In memory by default; the app can persist it. */
export interface TrustStore {
  has(hash: string): boolean;
  add(hash: string): void;
}

export const memoryTrust = (): TrustStore => {
  const s = new Set<string>();
  return { has: (h) => s.has(h), add: (h) => void s.add(h) };
};

/** A working starting point for a new module: one param, drawn, draggable, MIDI-mappable. */
export function templateSource(title: string): string {
  return `// ${title}: a Mode 7 module. Edit me; every ${title} on the board updates as you type.
// ctx.param() values save, undo, map to MIDI and answer to commands like: set ${title.toLowerCase()} 80

export default ({ defineModule, param }) => defineModule({
  title: ${JSON.stringify(title)},
  size: [2, 2],
  params: {
    level: param.number(0, 100, 40, { unit: '%', label: 'Level' }),
  },
  mount(el, ctx) {
    const level = ctx.param('level');
    el.innerHTML = \`
      <div style="position:absolute;inset:0 12px 12px;display:flex;flex-direction:column;gap:6px">
        <div class="meter" data-m7-interactive data-m7-param="level"
             style="flex:1;position:relative;overflow:hidden;border-radius:var(--m7-radius-inner);background:var(--m7-wash);cursor:ns-resize;touch-action:none">
          <i style="position:absolute;left:0;right:0;bottom:0;background:var(--m7-live)"></i>
        </div>
        <span style="font:500 var(--m7-text-label) var(--m7-mono);color:var(--m7-ink-2)"></span>
      </div>\`;
    const meter = el.querySelector('.meter');
    const fill = el.querySelector('i');
    const label = el.querySelector('span');

    // Paint from the param, whoever changed it: a drag, MIDI, undo, a command.
    const paint = () => {
      fill.style.height = level.normal() * 100 + '%';
      label.textContent = level.text();
    };
    paint();

    // Drag up and down. begin/end make the whole drag one undo step.
    meter.addEventListener('pointerdown', (e) => {
      meter.setPointerCapture(e.pointerId);
      level.begin();
      const set = (ev) => {
        const r = meter.getBoundingClientRect();
        level.setNormal(1 - (ev.clientY - r.top) / r.height);
      };
      set(e);
      meter.onpointermove = set;
      meter.onpointerup = () => ((meter.onpointermove = null), level.end());
    });

    return level.subscribe(paint);
  },
});
`;
}

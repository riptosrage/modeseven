import { Store, type StoreOptions } from './store/store';
import type { Rect } from './solver/geometry';
import { firstFree } from './solver/place';
import type { ModuleDef } from './modules/types';
import { Params } from './params/registry';
import { Midi } from './midi/midi';
import { Emitter, type Signal, signal } from './store/signal';
import type { Doc } from './store/doc';
import { type TrustStore, compileModule, hashSource, memoryTrust, templateSource } from './modules/code';
import { Actions, type ActionDef, type ActionInput, type ArgSpec, type ArgType, parseCell, parseSize } from './actions/actions';

export interface EngineOptions {
  modules: ModuleDef[];
  store?: Store;
  storage?: StoreOptions;
  /** Which custom-module code has been trusted to run. Persist it to remember across sessions. */
  trust?: TrustStore;
}

/** Where a custom module type's code is at. */
export type CodeStatus = { state: 'running' } | { state: 'error'; error: string } | { state: 'untrusted' };

let seq = 0;
export const newId = (prefix = 'm') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Mode 7 without a screen: the document, the module types, their params and
 * the command language. A Board renders one; tests, scripts, workers, a
 * server or an AI agent can drive one directly.
 *
 *   const e = new Engine({ modules: [knob] });
 *   e.run('add knob at 0,0');
 *   e.run('set knob 80');
 */
export class Engine {
  readonly store: Store;
  readonly params: Params;
  readonly actions: Actions<Engine>;
  readonly midi: Midi;
  /** Custom module types (code in the doc) and how each is doing. */
  readonly code: Signal<Record<string, CodeStatus>> = signal({});
  /** Fires with the module types whose definition just changed, so renderers can swap them in place. */
  readonly defsChanged = new Emitter<{ types: string[] }>();
  private defs = new Map<string, ModuleDef>();
  private builtins = new Map<string, ModuleDef>();
  private compiled = new Map<string, string>();
  private trust: TrustStore;
  private syncing: Promise<void> = Promise.resolve();

  constructor(opts: EngineOptions) {
    this.store = opts.store ?? new Store(opts.storage);
    this.trust = opts.trust ?? memoryTrust();
    opts.modules.forEach((d) => (this.defs.set(d.type, d), this.builtins.set(d.type, d)));
    this.params = new Params(this.store, (t) => this.defs.get(t));
    this.midi = new Midi(this.store, this.params);
    this.actions = new Actions<Engine>(this, (type, raw, spec) => this.resolve(type, raw, spec)).register(...coreActions);
    this.store.doc.subscribe((d, p) => d.types !== p.types && this.syncTypes(d));
    this.syncTypes(this.store.doc.get());
  }

  /* ------------------------------------------------------------ custom module code */

  /**
   * Create or update a custom module type from source. The code is trusted
   * (you wrote it here), saved in the doc, undoable, and every module of
   * that type swaps to it. Resolves once it's running, or with the error.
   */
  async defineType(type: string, source: string): Promise<CodeStatus> {
    compileModule(source, type); // throws a readable error before anything is saved
    const hash = await hashSource(source);
    if (hash) this.trust.add(hash);
    this.store.dispatch({ t: 'type.define', type, source }, { coalesce: `code:${type}` });
    await this.typesReady();
    return this.code.get()[type] ?? { state: 'running' };
  }

  /** Run code that came from outside (an opened file) that the person has now looked at and trusted. */
  async trustAll() {
    const types = this.store.doc.get().types ?? {};
    for (const t of Object.values(types)) {
      const h = await hashSource(t.source);
      if (h) this.trust.add(h);
    }
    this.compiled.clear();
    this.syncTypes(this.store.doc.get());
    await this.typesReady();
  }

  /** Resolves when every custom type in the doc has been compiled (or refused). */
  typesReady() {
    return this.syncing;
  }

  /** Source of a custom type, if it is one. */
  sourceOf(type: string): string | undefined {
    return this.store.doc.get().types?.[type]?.source;
  }

  private syncTypes(doc: Doc) {
    const run = async () => {
      const types = doc.types ?? {};
      const status: Record<string, CodeStatus> = { ...this.code.get() };
      const changed: string[] = [];
      for (const [type, { source }] of Object.entries(types)) {
        if (this.compiled.get(type) === source) continue;
        const hash = await hashSource(source);
        if (this.store.doc.get().types?.[type]?.source !== source) continue; // superseded while hashing
        if (!hash || !this.trust.has(hash)) {
          status[type] = { state: 'untrusted' };
          continue;
        }
        try {
          this.defs.set(type, compileModule(source, type));
          this.compiled.set(type, source);
          status[type] = { state: 'running' };
          changed.push(type);
        } catch (e) {
          // Keep the last good version running; report the problem.
          status[type] = { state: 'error', error: (e as Error).message };
        }
      }
      for (const type of [...this.compiled.keys()]) {
        if (types[type]) continue;
        this.compiled.delete(type);
        delete status[type];
        const b = this.builtins.get(type);
        if (b) this.defs.set(type, b);
        else this.defs.delete(type);
        changed.push(type);
      }
      for (const type of Object.keys(status)) if (!types[type]) delete status[type];
      this.code.set(status);
      if (changed.length) this.defsChanged.emit('types', changed);
    };
    this.syncing = this.syncing.then(run, run);
  }

  def(type: string) {
    return this.defs.get(type);
  }

  get types() {
    return [...this.defs.values()];
  }

  /** Register or replace a built-in module type at runtime (hot reload). Renderers swap existing modules of that type in place. */
  define(def: ModuleDef) {
    this.builtins.set(def.type, def);
    if (this.compiled.has(def.type)) return; // a custom version overrides it
    this.defs.set(def.type, def);
    this.defsChanged.emit('types', [def.type]);
  }

  /** Run a command: `run('add knob at 3,2')` or `run({ action: 'add', type: 'knob', at: [3, 2] })`. */
  run(input: ActionInput) {
    return this.actions.run(input);
  }

  /** `run`, awaiting actions that take time. What AI tool calls and the palette use. */
  runAsync(input: ActionInput) {
    return this.actions.runAsync(input);
  }

  /** Add a module. With a rect it goes there, pushing others aside; otherwise the first free spot. Returns its id. */
  add(type: string, rect?: Rect, extra: { title?: string; props?: Record<string, unknown>; id?: string } = {}) {
    const d = this.def(type);
    const [w, h] = d?.size ?? [2, 2];
    const id = extra.id ?? newId();
    const { id: _, ...rest } = extra;
    this.store.dispatch({ t: 'add', id, type, size: { w, h }, rect, ...rest });
    return id;
  }

  /** Find a module by id, title or type (active layer). Throws a readable error if it's missing or ambiguous. */
  find(ref: string): string {
    const mods = Object.values(this.store.layer.modules);
    const r = ref.trim().toLowerCase();
    const byId = mods.find((m) => m.id.toLowerCase() === r);
    if (byId) return byId.id;
    const titled = mods.filter((m) => (m.title ?? this.def(m.type)?.title ?? '').toLowerCase() === r);
    if (titled.length === 1) return titled[0].id;
    const typed = mods.filter((m) => m.type.toLowerCase() === r || m.type.toLowerCase() === r.replace(/s$/, ''));
    if (typed.length === 1) return typed[0].id;
    const many = titled.length > 1 ? titled : typed;
    if (many.length > 1) throw new Error(`There are ${many.length} “${ref}” modules. Use an id: ${many.map((m) => m.id).join(', ')}`);
    throw new Error(`No module called “${ref}” on this layer.`);
  }

  private resolve(type: ArgType, raw: unknown, spec: ArgSpec): unknown {
    switch (type) {
      case 'cell':
        return parseCell(raw);
      case 'size':
        return parseSize(raw);
      case 'number': {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (!Number.isFinite(n)) throw new Error(`${spec.name} should be a number, got “${raw}”.`);
        return n;
      }
      case 'value':
        return parseValue(raw);
      case 'module':
        return this.find(String(raw));
      case 'type': {
        const s = String(raw).toLowerCase();
        const d = this.types.find((t) => t.type.toLowerCase() === s || t.title.toLowerCase() === s || t.type.toLowerCase() === s.replace(/s$/, ''));
        if (!d) throw new Error(`No module type “${raw}”. Types: ${this.types.map((t) => t.type).join(', ')}`);
        return d.type;
      }
      case 'param':
        return this.resolveParam(String(raw));
      default:
        return String(raw);
    }
  }

  /** `knob.value`, `m12.cutoff`, or just `knob` when it has a single param. */
  private resolveParam(raw: string): string {
    const dot = raw.lastIndexOf('.');
    const tryModule = (ref: string) => {
      try {
        return this.find(ref);
      } catch {
        return null;
      }
    };
    // Prefer the whole string as a module ref (titles can contain dots), then split.
    let id = tryModule(raw);
    let key = '';
    if (!id && dot > 0) {
      id = tryModule(raw.slice(0, dot));
      key = raw.slice(dot + 1);
    }
    if (!id) this.find(dot > 0 ? raw.slice(0, dot) : raw); // throws the readable error
    const rec = this.store.layer.modules[id!];
    const specs = this.def(rec.type)?.params ?? {};
    const keys = Object.keys(specs);
    if (!keys.length) throw new Error(`${this.def(rec.type)?.title ?? rec.type} has no parameters.`);
    if (!key) {
      if (keys.length === 1) return Params.address(id!, keys[0]);
      throw new Error(`Which one? ${keys.map((k) => `${raw}.${k}`).join(', ')}`);
    }
    const k = keys.find((x) => x.toLowerCase() === key.toLowerCase() || specs[x].label?.toLowerCase() === key.toLowerCase());
    if (!k) throw new Error(`No param “${key}”. It has: ${keys.join(', ')}`);
    return Params.address(id!, k);
  }
}

export function parseValue(raw: unknown): number | boolean | string {
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const s = String(raw).trim();
  if (/^-?\d*\.?\d+(e-?\d+)?%?$/i.test(s)) return parseFloat(s);
  if (/^-?\d*\.?\d+k$/i.test(s)) return parseFloat(s) * 1000; // 2k = 2000, for Hz and ms
  if (/^(on|true|yes)$/i.test(s)) return true;
  if (/^(off|false|no)$/i.test(s)) return false;
  return s;
}

/* -------------------------------------------------------- core actions */

const A = (d: ActionDef<Engine>) => d;

const coreActions: ActionDef<Engine>[] = [
  A({
    name: 'add',
    describe: 'Add a module. Without a cell it goes in the first free spot.',
    args: [
      { name: 'type', type: 'type' },
      { name: 'at', type: 'cell', keyword: 'at', optional: true },
      { name: 'size', type: 'size', keyword: 'size', optional: true },
      { name: 'title', type: 'text', keyword: 'as', optional: true, describe: 'A name for it.' },
    ],
    run(a, e) {
      const d = e.def(a.type)!;
      const [w, h] = a.size ? [a.size.w, a.size.h] : d.size;
      const cols = e.store.cols.get();
      const rect = a.at ? { x: a.at.x, y: a.at.y, w, h } : a.size ? { ...firstFree(e.store.layout(), { w, h }, cols), w, h } : undefined;
      return e.add(a.type, rect, a.title ? { title: a.title } : {});
    },
  }),
  A({
    name: 'remove',
    describe: 'Remove a module.',
    args: [{ name: 'module', type: 'module' }],
    run: (a, e) => e.store.dispatch({ t: 'remove', id: a.module }),
  }),
  A({
    name: 'move',
    describe: 'Move a module so its top-left is at a cell. Only modules it lands on move aside.',
    args: [
      { name: 'module', type: 'module' },
      { name: 'to', type: 'cell', keyword: 'to' },
    ],
    run(a, e) {
      const r = e.store.layout()[a.module];
      e.store.dispatch({ t: 'place', id: a.module, rect: { ...r, x: a.to.x, y: a.to.y } });
    },
  }),
  A({
    name: 'resize',
    describe: 'Resize a module, in cells.',
    args: [
      { name: 'module', type: 'module' },
      { name: 'to', type: 'size', keyword: 'to' },
    ],
    run(a, e) {
      const r = e.store.layout()[a.module];
      e.store.dispatch({ t: 'place', id: a.module, rect: { ...r, w: a.to.w, h: a.to.h } });
    },
  }),
  A({
    name: 'set',
    describe: 'Set a parameter, e.g. set knob 80 or set filter.cutoff 2000.',
    args: [
      { name: 'param', type: 'param' },
      { name: 'value', type: 'value' },
    ],
    run(a, e) {
      e.params.set(a.param, a.value, { origin: 'command' });
      return e.params.text(a.param);
    },
  }),
  A({
    name: 'title',
    describe: 'Rename a module.',
    args: [
      { name: 'module', type: 'module' },
      { name: 'title', type: 'text' },
    ],
    run: (a, e) => e.store.dispatch({ t: 'title', id: a.module, title: a.title }),
  }),
  A({ name: 'tidy', describe: 'Pack every module upward. The only gravity on the board.', run: (_a, e) => e.store.dispatch({ t: 'tidy' }) }),
  A({ name: 'undo', describe: 'Undo the last change.', run: (_a, e) => e.store.undo() }),
  A({ name: 'redo', describe: 'Redo.', run: (_a, e) => e.store.redo() }),
  A({
    name: 'layer.add',
    describe: 'Add a layer and switch to it.',
    args: [{ name: 'name', type: 'text', optional: true }],
    run(a, e) {
      const n = e.store.doc.get().layers.length + 1;
      e.store.dispatch({ t: 'layer.add', id: newId('layer'), name: a.name ?? `Layer ${n}` });
    },
  }),
  A({
    name: 'layer.select',
    describe: 'Switch to a layer by number or name.',
    args: [{ name: 'layer', type: 'text' }],
    run(a, e) {
      const layers = e.store.doc.get().layers;
      const n = Number(a.layer);
      const i = Number.isInteger(n) ? n - 1 : layers.findIndex((l) => l.name.toLowerCase() === String(a.layer).toLowerCase());
      if (!layers[i]) throw new Error(`No layer “${a.layer}”.`);
      e.store.silent({ t: 'layer.select', index: i });
    },
  }),
  A({
    name: 'layer.rename',
    describe: 'Rename the current layer.',
    args: [{ name: 'name', type: 'text' }],
    run: (a, e) => e.store.dispatch({ t: 'layer.rename', index: e.store.doc.get().active, name: a.name }),
  }),
  A({
    name: 'map',
    describe: 'Map a controller to a parameter. Source looks like midi:cc:1:74.',
    args: [
      { name: 'param', type: 'param' },
      { name: 'source', type: 'text', keyword: 'from' },
    ],
    run: (a, e) => e.store.dispatch({ t: 'map', source: a.source, target: a.param }),
  }),
  A({
    name: 'learn',
    describe: 'MIDI learn: the next control you move on a MIDI device drives this parameter.',
    args: [{ name: 'param', type: 'param' }],
    run(a, e) {
      if (e.midi.status.get() === 'unknown') void e.midi.connect();
      e.midi.learn(a.param);
      return `Move a control on your MIDI device to map ${a.param}`;
    },
  }),
  A({
    name: 'unmap',
    describe: 'Remove every controller mapping on a parameter.',
    args: [{ name: 'param', type: 'param' }],
    run(a, e) {
      const m = e.store.doc.get().mappings ?? {};
      const cmds = Object.keys(m)
        .filter((s) => m[s] === a.param)
        .map((source) => ({ t: 'unmap' as const, source }));
      if (cmds.length) e.store.dispatch(cmds);
      return cmds.length;
    },
  }),
  A({
    name: 'list',
    describe: 'List the modules on this layer.',
    run(_a, e) {
      const layout = e.store.layout();
      return Object.values(e.store.layer.modules).map((m) => ({ id: m.id, type: m.type, title: m.title ?? e.def(m.type)?.title ?? m.type, ...layout[m.id] }));
    },
  }),
  A({
    name: 'params',
    describe: 'List parameters, of one module or the whole layer.',
    args: [{ name: 'module', type: 'module', optional: true }],
    run: (a, e) => e.params.list({ module: a.module }).map(({ spec: _s, ...p }) => p),
  }),
  A({
    name: 'new',
    describe: 'Make a new module type from code, add one, and open its code.',
    args: [{ name: 'title', type: 'text' }],
    async run(a, e) {
      const base = String(a.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
      let type = base;
      for (let i = 2; e.def(type) || e.sourceOf(type); i++) type = `${base}-${i}`;
      await e.defineType(type, templateSource(String(a.title)));
      return { type, id: e.add(type) };
    },
  }),
  A({
    name: 'types',
    describe: 'List the module types: built in, and custom ones with their status.',
    run(_a, e) {
      const code = e.code.get();
      return e.types.map((d) => ({ type: d.type, title: d.title, custom: !!e.sourceOf(d.type), status: code[d.type]?.state ?? 'built in' }))
        .concat(Object.keys(code).filter((t) => !e.def(t)).map((t) => ({ type: t, title: t, custom: true, status: code[t].state })));
    },
  }),
  A({
    name: 'trust',
    describe: 'Run the custom module code in a board you opened. Only do this for boards from people you trust.',
    run: (_a, e) => e.trustAll(),
  }),
  A({
    name: 'help',
    describe: 'Show how to use a command, or list them all.',
    args: [{ name: 'command', type: 'text', optional: true }],
    run(a, e) {
      if (a.command) return e.actions.usage(a.command.trim().replace(/\s+/g, '.'));
      return e.actions.list().map((d) => e.actions.usage(d.name));
    },
  }),
];


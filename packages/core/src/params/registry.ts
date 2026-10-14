import type { Store, DispatchOptions } from '../store/store';
import { type Doc, type ParamValue, moduleOf } from '../store/doc';
import type { ModuleDef } from '../modules/types';
import { type ParamSpec, coerce, format, fromNormal, toNormal } from './spec';

/** Everything about one parameter, for lists, palettes, AI and mapping UIs. */
export interface ParamInfo {
  /** `moduleId.key`: the one name MIDI, automation, remotes and AI use. */
  address: string;
  id: string;
  key: string;
  label: string;
  module: string;
  spec: ParamSpec;
  value: ParamValue;
  text: string;
}

/** A module's handle on one of its own parameters (from `ctx.param(key)`). */
export interface ParamHandle {
  readonly address: string;
  readonly spec: ParamSpec;
  get(): ParamValue;
  /** 0..1 */
  normal(): number;
  set(v: ParamValue): void;
  setNormal(n: number): void;
  text(v?: ParamValue): string;
  /** Fires with the new value whenever it changes, from anywhere: a drag, MIDI, undo, a remote. */
  subscribe(fn: (v: ParamValue) => void): () => void;
  /** Bracket a drag: everything between begin and end is one undo step. */
  begin(): void;
  end(): void;
}

let gestureSeq = 0;
/** A fresh coalesce key for one gesture. */
export const gestureKey = (name: string) => `gesture:${name}:${++gestureSeq}`;

/**
 * The parameter registry. Reads values out of the doc, writes them as
 * commands, so every change is undoable, saved, replayable and syncable.
 * Headless: no DOM.
 */
export class Params {
  private subs = new Map<string, { fns: Set<(v: ParamValue) => void>; last: ParamValue | undefined }>();

  constructor(
    private store: Store,
    private def: (type: string) => ModuleDef | undefined,
  ) {
    store.doc.subscribe((d) => this.notify(d));
  }

  static address = (id: string, key: string) => `${id}.${key}`;

  static split(address: string): { id: string; key: string } {
    const i = address.lastIndexOf('.');
    return i < 0 ? { id: address, key: '' } : { id: address.slice(0, i), key: address.slice(i + 1) };
  }

  spec(address: string): ParamSpec | undefined {
    const { id, key } = Params.split(address);
    const rec = moduleOf(this.store.doc.get(), id);
    return rec ? this.def(rec.type)?.params?.[key] : undefined;
  }

  has(address: string) {
    return !!this.spec(address);
  }

  get(address: string, doc = this.store.doc.get()): ParamValue | undefined {
    const { id, key } = Params.split(address);
    const rec = moduleOf(doc, id);
    const spec = rec && this.def(rec.type)?.params?.[key];
    if (!spec) return undefined;
    const v = rec.params?.[key];
    return v === undefined ? spec.default : v;
  }

  set(address: string, value: unknown, o: DispatchOptions = {}) {
    const spec = this.spec(address);
    if (!spec) return false;
    const { id, key } = Params.split(address);
    const v = coerce(spec, value);
    if (Object.is(v, this.get(address))) return true;
    this.store.dispatch({ t: 'param', id, values: { [key]: v } }, { coalesce: `param:${address}`, ...o });
    return true;
  }

  setNormal(address: string, n: number, o: DispatchOptions = {}) {
    const spec = this.spec(address);
    return spec ? this.set(address, fromNormal(spec, n), o) : false;
  }

  normal(address: string) {
    const spec = this.spec(address);
    const v = this.get(address);
    return spec && v !== undefined ? toNormal(spec, v) : 0;
  }

  text(address: string, v = this.get(address)) {
    const spec = this.spec(address);
    return spec && v !== undefined ? format(spec, v) : '';
  }

  /** Every parameter on a layer (default: the active one), or of one module. */
  list(opts: { module?: string; layer?: number } = {}): ParamInfo[] {
    const doc = this.store.doc.get();
    const layer = doc.layers[opts.layer ?? doc.active];
    const out: ParamInfo[] = [];
    for (const rec of Object.values(layer?.modules ?? {})) {
      if (opts.module && rec.id !== opts.module) continue;
      const def = this.def(rec.type);
      for (const [key, spec] of Object.entries(def?.params ?? {})) {
        const value = rec.params?.[key] ?? spec.default;
        out.push({
          address: Params.address(rec.id, key),
          id: rec.id,
          key,
          label: spec.label ?? key,
          module: rec.title ?? def?.title ?? rec.type,
          spec,
          value,
          text: format(spec, value),
        });
      }
    }
    return out;
  }

  subscribe(address: string, fn: (v: ParamValue) => void): () => void {
    let s = this.subs.get(address);
    if (!s) this.subs.set(address, (s = { fns: new Set(), last: this.get(address) }));
    s.fns.add(fn);
    return () => {
      s!.fns.delete(fn);
      if (!s!.fns.size) this.subs.delete(address);
    };
  }

  /** The handle a module gets from `ctx.param(key)`. */
  handle(id: string, key: string, group: () => string | null = () => null): ParamHandle {
    const address = Params.address(id, key);
    const spec = this.spec(address);
    if (!spec) throw new Error(`[mode7] "${address}" isn't a declared param. Add it to the module's params.`);
    let gesture: string | null = null;
    const opts = () => {
      const g = gesture ?? group();
      return g ? { coalesce: g, coalesceWindow: Infinity } : {};
    };
    return {
      address,
      spec,
      get: () => this.get(address) ?? spec.default,
      normal: () => this.normal(address),
      set: (v) => void this.set(address, v, opts()),
      setNormal: (n) => void this.setNormal(address, n, opts()),
      text: (v) => (v === undefined ? this.text(address) : format(spec, v)),
      subscribe: (fn) => this.subscribe(address, fn),
      begin: () => void (gesture = gestureKey(address)),
      end: () => void (gesture = null),
    };
  }

  private notify(doc: Doc) {
    for (const [address, s] of this.subs) {
      const v = this.get(address, doc);
      if (v === undefined || Object.is(v, s.last)) continue;
      s.last = v;
      for (const fn of [...s.fns]) fn(v);
    }
  }
}

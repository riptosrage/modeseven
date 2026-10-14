import type { Layout, Rect, Size } from '../solver/geometry';
import { firstFree, insert, place, reflow, remove, tidy } from '../solver/place';

/**
 * The document: everything that gets saved, undone, shared as a template.
 * Plain JSON, immutable updates only. A new object means "changed".
 */
export interface ModuleRecord {
  id: string;
  type: string;
  title?: string;
  props?: Record<string, unknown>;
}

export interface LayerRecord {
  id: string;
  name: string;
  /** Insertion order = creation order. */
  modules: Record<string, ModuleRecord>;
  /** One layout per column count the layer has been edited at, keyed by column count. */
  layouts: Record<string, Layout>;
}

export interface Doc {
  v: 1;
  layers: LayerRecord[];
  active: number;
}

export type Command =
  | { t: 'add'; id: string; type: string; size: Size; rect?: Rect; title?: string; props?: Record<string, unknown> }
  | { t: 'remove'; id: string }
  | { t: 'place'; id: string; rect: Rect }
  | { t: 'layout'; layout: Layout }
  | { t: 'props'; id: string; patch: Record<string, unknown> }
  | { t: 'title'; id: string; title: string }
  | { t: 'tidy' }
  | { t: 'layer.add'; id: string; name: string }
  | { t: 'layer.rename'; index: number; name: string }
  | { t: 'layer.remove'; index: number }
  | { t: 'layer.select'; index: number };

export const emptyDoc = (name = 'Board'): Doc => ({ v: 1, active: 0, layers: [{ id: 'layer-1', name, modules: {}, layouts: {} }] });

/* ---------------------------------------------------------- layouts */

const derived = new WeakMap<LayerRecord, Map<number, Layout>>();

/**
 * The layout for this layer at `cols` columns. Uses the stored one if it
 * covers every module; otherwise derives one from the closest stored layout
 * and places newcomers in the first free spots. Memoized per layer object.
 */
export function layoutFor(layer: LayerRecord, cols: number): Layout {
  let cache = derived.get(layer);
  if (!cache) derived.set(layer, (cache = new Map()));
  const hit = cache.get(cols);
  if (hit) return hit;

  const ids = Object.keys(layer.modules);
  const own = layer.layouts[String(cols)];
  let out: Layout;
  if (own && ids.every((id) => own[id]) && Object.keys(own).length === ids.length) {
    out = own;
  } else {
    const keys = Object.keys(layer.layouts)
      .map(Number)
      .sort((a, b) => Math.abs(a - cols) - Math.abs(b - cols) || b - a);
    const source = own ?? (keys.length ? layer.layouts[String(keys[0])] : {});
    const known: Layout = {};
    for (const id of ids) if (source[id]) known[id] = source[id];
    out = own ? { ...known } : reflow(known, cols);
    for (const id of ids) {
      if (out[id]) continue;
      // Size from any other layout that knows it, else 2×2.
      const any = keys.map((k) => layer.layouts[String(k)][id]).find(Boolean);
      const size = any ? { w: Math.min(any.w, cols), h: any.h } : { w: Math.min(2, cols), h: 2 };
      out[id] = { ...firstFree(out, size, cols), ...size };
    }
  }
  cache.set(cols, out);
  return out;
}

/* ---------------------------------------------------------- reducer */

const withLayer = (doc: Doc, fn: (l: LayerRecord) => LayerRecord, index = doc.active): Doc => ({
  ...doc,
  layers: doc.layers.map((l, i) => (i === index ? fn(l) : l)),
});

const setLayout = (l: LayerRecord, cols: number, layout: Layout): LayerRecord => ({
  ...l,
  layouts: { ...l.layouts, [String(cols)]: layout },
});

/** Apply one command. Pure: returns a new doc, or the same doc if nothing changed. */
export function reduce(doc: Doc, cmd: Command, cols: number): Doc {
  switch (cmd.t) {
    case 'add':
      return withLayer(doc, (l) => {
        if (l.modules[cmd.id]) return l;
        const mod: ModuleRecord = { id: cmd.id, type: cmd.type };
        if (cmd.title) mod.title = cmd.title;
        if (cmd.props) mod.props = cmd.props;
        const layout = insert(layoutFor(l, cols), cmd.id, cmd.size, cols, cmd.rect);
        return setLayout({ ...l, modules: { ...l.modules, [cmd.id]: mod } }, cols, layout);
      });
    case 'remove':
      return withLayer(doc, (l) => {
        if (!l.modules[cmd.id]) return l;
        const modules = { ...l.modules };
        delete modules[cmd.id];
        const layouts: Record<string, Layout> = {};
        for (const k in l.layouts) layouts[k] = remove(l.layouts[k], cmd.id);
        return { ...l, modules, layouts };
      });
    case 'place':
      return withLayer(doc, (l) => (l.modules[cmd.id] ? setLayout(l, cols, place(layoutFor(l, cols), cmd.id, cmd.rect, cols)) : l));
    case 'layout':
      return withLayer(doc, (l) => setLayout(l, cols, cmd.layout));
    case 'props':
      return withLayer(doc, (l) => {
        const m = l.modules[cmd.id];
        if (!m) return l;
        return { ...l, modules: { ...l.modules, [cmd.id]: { ...m, props: { ...(m.props ?? {}), ...cmd.patch } } } };
      });
    case 'title':
      return withLayer(doc, (l) => {
        const m = l.modules[cmd.id];
        if (!m) return l;
        return { ...l, modules: { ...l.modules, [cmd.id]: { ...m, title: cmd.title } } };
      });
    case 'tidy':
      return withLayer(doc, (l) => setLayout(l, cols, tidy(layoutFor(l, cols), cols)));
    case 'layer.add':
      return { ...doc, layers: [...doc.layers, { id: cmd.id, name: cmd.name, modules: {}, layouts: {} }], active: doc.layers.length };
    case 'layer.rename':
      return withLayer(doc, (l) => ({ ...l, name: cmd.name }), cmd.index);
    case 'layer.remove': {
      if (doc.layers.length <= 1) return doc;
      const layers = doc.layers.filter((_, i) => i !== cmd.index);
      return { ...doc, layers, active: Math.min(doc.active, layers.length - 1) };
    }
    case 'layer.select':
      return cmd.index === doc.active || !doc.layers[cmd.index] ? doc : { ...doc, active: cmd.index };
  }
}

/** Minimal schema check for loaded/pasted docs. Returns null if it isn't one. */
export function validateDoc(x: unknown): Doc | null {
  const d = x as Doc;
  if (!d || d.v !== 1 || !Array.isArray(d.layers) || !d.layers.length) return null;
  for (const l of d.layers) if (typeof l.id !== 'string' || typeof l.modules !== 'object' || typeof l.layouts !== 'object') return null;
  return { ...d, active: Math.min(Math.max(0, d.active | 0), d.layers.length - 1) };
}

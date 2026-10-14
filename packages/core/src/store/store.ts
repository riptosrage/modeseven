import { Emitter, type Signal, signal } from './signal';
import { type Command, type Doc, type LayerRecord, emptyDoc, layoutFor, reduce, validateDoc } from './doc';
import type { Layout } from '../solver/geometry';

export interface Transaction {
  /**
   * Doc the preview is built on: the doc when the transaction began, plus
   * anything dispatched since (MIDI, a remote edit). Never the last preview.
   */
  readonly base: Doc;
  /** Show the result of `cmd` applied to the base, without recording history. */
  preview(cmd: Command | Command[]): void;
  /** Keep the current preview as one undo step. */
  commit(): void;
  /** Put everything back as it was (keeping anything dispatched meanwhile). */
  cancel(): void;
  readonly open: boolean;
}

export interface StoreSnapshot {
  doc: Doc;
  past: Doc[];
  future: Doc[];
}

/** Where the doc is kept between sessions. Swap in IndexedDB, a file, or a server. */
export interface Persistence {
  load(): Doc | null;
  save(doc: Doc): void;
}

export interface StoreOptions {
  doc?: Doc;
  /** localStorage key. Shorthand for `persist: localPersistence(key)`. */
  storageKey?: string;
  persist?: Persistence;
  historyLimit?: number;
  /** How long changes with the same coalesce key keep merging into one undo step (ms). */
  coalesceWindow?: number;
}

export interface DispatchOptions {
  /**
   * Changes with the same key in quick succession become one undo step,
   * like typing in a text field. A knob turn or a MIDI sweep uses this.
   */
  coalesce?: string;
  /** Override the store's coalesce window for this change (ms). A drag uses Infinity: one gesture, one step. */
  coalesceWindow?: number;
  /** Where the change came from, passed through to `changes` listeners (e.g. 'midi', 'remote', 'ai'). */
  origin?: string;
  /** Apply as if the board showed this many columns (replays, remote edits). Defaults to the current count. */
  cols?: number;
}

/** One committed change, in order. Replay these to rebuild a session; stream them to sync. */
export type Change =
  | { kind: 'do'; cmds: Command[]; cols: number; origin?: string }
  | { kind: 'undo' | 'redo' | 'replace' | 'restore'; doc: Doc };

export const localPersistence = (key: string): Persistence => ({
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? validateDoc(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  save(doc) {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(doc));
    } catch {
      /* storage full or blocked */
    }
  },
});

const now = () => globalThis.performance?.now() ?? Date.now();

/**
 * Single source of truth. Every change goes through `dispatch` (one undo
 * step) or a transaction (many previews, one undo step). Pure TypeScript,
 * no DOM: runs in a browser, a worker, Node, or a test.
 */
export class Store {
  readonly doc: Signal<Doc>;
  /** Columns the board is currently showing. Set by the board when the screen size changes. */
  readonly cols: Signal<number>;
  readonly history = signal({ canUndo: false, canRedo: false });
  /** Every committed change, in order. Previews are not changes; their commit is. */
  readonly changes = new Emitter<{ change: Change }>();

  private past: Doc[] = [];
  private future: Doc[] = [];
  private txn: { base: Doc; preview: Command[] | null } | null = null;
  private coalescing: { key: string; at: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private savingPaused = false;
  private persist?: Persistence;

  constructor(private opts: StoreOptions = {}) {
    this.persist = opts.persist ?? (opts.storageKey ? localPersistence(opts.storageKey) : undefined);
    this.doc = signal(this.persist?.load() ?? opts.doc ?? emptyDoc());
    this.cols = signal(4);
    this.doc.subscribe(() => this.scheduleSave());
  }

  get layer(): LayerRecord {
    const d = this.doc.get();
    return d.layers[d.active];
  }

  /** The current layer's layout at the current column count. */
  layout(): Layout {
    return layoutFor(this.layer, this.cols.get());
  }

  /**
   * Apply a change as one undo step. Safe during a gesture: the change lands
   * under the gesture's preview, which is rebuilt on top of it.
   */
  dispatch(cmd: Command | Command[], o: DispatchOptions = {}) {
    const cmds = Array.isArray(cmd) ? cmd : [cmd];
    const t = this.txn;
    const prev = t ? t.base : this.doc.get();
    const next = this.apply(prev, cmds, o.cols);
    if (next === prev) return;
    if (!cmds.every((c) => c.t === 'layer.select')) this.record(prev, o.coalesce, o.coalesceWindow);
    this.commitDoc(next);
    this.changes.emit('change', { kind: 'do', cmds, cols: o.cols ?? this.cols.get(), origin: o.origin });
  }

  /** Change the doc without an undo step (e.g. switching layers). Still a change for listeners. */
  silent(cmd: Command | Command[], o: DispatchOptions = {}) {
    const cmds = Array.isArray(cmd) ? cmd : [cmd];
    const prev = this.txn ? this.txn.base : this.doc.get();
    const next = this.apply(prev, cmds, o.cols);
    if (next === prev) return;
    this.commitDoc(next);
    this.changes.emit('change', { kind: 'do', cmds, cols: o.cols ?? this.cols.get(), origin: o.origin });
  }

  begin(): Transaction {
    if (this.txn) this.cancelTxn();
    const t: { base: Doc; preview: Command[] | null } = { base: this.doc.get(), preview: null };
    this.txn = t;
    const self = this;
    return {
      get base() {
        return t.base;
      },
      get open() {
        return self.txn === t;
      },
      preview(cmd) {
        if (self.txn !== t) return;
        t.preview = Array.isArray(cmd) ? cmd : [cmd];
        self.doc.set(self.apply(t.base, t.preview));
      },
      commit() {
        if (self.txn !== t) return;
        self.txn = null;
        if (self.doc.get() === t.base || !t.preview) return;
        self.record(t.base);
        self.changes.emit('change', { kind: 'do', cmds: t.preview, cols: self.cols.get() });
        self.scheduleSave();
      },
      cancel() {
        if (self.txn !== t) return;
        self.cancelTxn();
      },
    };
  }

  undo() {
    if (this.txn) this.cancelTxn();
    const prev = this.past.pop();
    if (!prev) return;
    this.coalescing = null;
    this.future.push(this.doc.get());
    this.doc.set(prev);
    this.syncHistory();
    this.changes.emit('change', { kind: 'undo', doc: prev });
  }

  redo() {
    if (this.txn) this.cancelTxn();
    const next = this.future.pop();
    if (!next) return;
    this.coalescing = null;
    this.past.push(this.doc.get());
    this.doc.set(next);
    this.syncHistory();
    this.changes.emit('change', { kind: 'redo', doc: next });
  }

  /** Replace the whole doc (load a template). Undoable. */
  replace(doc: Doc) {
    const valid = validateDoc(doc);
    if (!valid) throw new Error('Not a Mode 7 document');
    if (this.txn) this.cancelTxn();
    this.record(this.doc.get());
    this.doc.set(valid);
    this.changes.emit('change', { kind: 'replace', doc: valid });
  }

  /** Everything needed to put the store back exactly: doc and undo history. */
  snapshot(): StoreSnapshot {
    if (this.txn) this.cancelTxn();
    return { doc: this.doc.get(), past: [...this.past], future: [...this.future] };
  }

  /** Put back a snapshot (used by demos and previews). Not itself undoable. */
  restore(s: StoreSnapshot) {
    if (this.txn) this.cancelTxn();
    this.past = [...s.past];
    this.future = [...s.future];
    this.coalescing = null;
    this.doc.set(s.doc);
    this.syncHistory();
    this.changes.emit('change', { kind: 'restore', doc: s.doc });
  }

  /** Stop persisting (e.g. while a demo borrows the board). */
  pauseSaving(paused: boolean) {
    this.savingPaused = paused;
    if (paused) clearTimeout(this.saveTimer);
  }

  /** True while a gesture is previewing. */
  get previewing() {
    return this.txn !== null;
  }

  toJSON(): Doc {
    return this.doc.get();
  }

  /* ---------------------------------------------------------------- */

  private apply(doc: Doc, cmds: Command[], cols = this.cols.get()): Doc {
    return cmds.reduce((d, c) => reduce(d, c, cols), doc);
  }

  /** Set the committed doc. During a gesture that's the base, with the preview rebuilt on top. */
  private commitDoc(next: Doc) {
    const t = this.txn;
    if (!t) return this.doc.set(next);
    t.base = next;
    this.doc.set(t.preview ? this.apply(next, t.preview) : next);
  }

  private cancelTxn() {
    const t = this.txn;
    this.txn = null;
    if (t) this.doc.set(t.base);
  }

  private record(prev: Doc, coalesce?: string, window = this.opts.coalesceWindow ?? 1000) {
    const c = this.coalescing;
    const at = now();
    if (coalesce && c && c.key === coalesce && at - c.at < window && this.past.length) {
      // Same gesture or sweep: extend the last undo step instead of adding one.
      c.at = at;
      this.future = [];
      return;
    }
    this.coalescing = coalesce ? { key: coalesce, at } : null;
    this.past.push(prev);
    if (this.past.length > (this.opts.historyLimit ?? 200)) this.past.shift();
    this.future = [];
    this.syncHistory();
  }

  private syncHistory() {
    this.history.set({ canUndo: this.past.length > 0, canRedo: this.future.length > 0 });
  }

  private scheduleSave() {
    if (!this.persist || this.txn || this.savingPaused) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist?.save(this.doc.get()), 250);
  }
}

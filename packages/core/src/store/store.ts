import { type Signal, signal } from './signal';
import { type Command, type Doc, type LayerRecord, emptyDoc, layoutFor, reduce, validateDoc } from './doc';
import type { Layout } from '../solver/geometry';

export interface Transaction {
  /** Doc when the transaction began. Gestures compute every preview from this, never from the last preview. */
  readonly base: Doc;
  /** Show the result of `cmd` applied to the base, without recording history. */
  preview(cmd: Command | Command[]): void;
  /** Keep the current preview as one undo step. */
  commit(): void;
  /** Put everything back as it was. */
  cancel(): void;
  readonly open: boolean;
}

export interface StoreSnapshot {
  doc: Doc;
  past: Doc[];
  future: Doc[];
}

export interface StoreOptions {
  doc?: Doc;
  /** localStorage key. Omit for no persistence. */
  storageKey?: string;
  historyLimit?: number;
}

/**
 * Single source of truth. Every change goes through `dispatch` (one undo
 * step) or a transaction (many previews, one undo step).
 */
export class Store {
  readonly doc: Signal<Doc>;
  /** Columns the board is currently showing. Set by the board when the screen size changes. */
  readonly cols: Signal<number>;
  private past: Doc[] = [];
  private future: Doc[] = [];
  private txn: { base: Doc } | null = null;
  private saveTimer = 0;
  readonly history = signal({ canUndo: false, canRedo: false });

  constructor(private opts: StoreOptions = {}) {
    this.doc = signal(this.load() ?? opts.doc ?? emptyDoc());
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

  dispatch(cmd: Command | Command[]) {
    if (this.txn) throw new Error('dispatch during an open transaction; use txn.preview');
    const prev = this.doc.get();
    const next = this.apply(prev, cmd);
    if (next === prev) return;
    if (!isSelectOnly(cmd)) this.record(prev);
    this.doc.set(next);
  }

  /** Change the doc without an undo step (e.g. switching layers). */
  silent(cmd: Command | Command[]) {
    this.doc.set(this.apply(this.doc.get(), cmd));
  }

  begin(): Transaction {
    if (this.txn) this.cancelTxn();
    const base = this.doc.get();
    const t = { base };
    this.txn = t;
    const self = this;
    return {
      base,
      get open() {
        return self.txn === t;
      },
      preview(cmd) {
        if (self.txn !== t) return;
        self.doc.set(self.apply(base, cmd));
      },
      commit() {
        if (self.txn !== t) return;
        self.txn = null;
        if (self.doc.get() !== base) self.record(base);
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
    this.future.push(this.doc.get());
    this.doc.set(prev);
    this.syncHistory();
  }

  redo() {
    if (this.txn) this.cancelTxn();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.doc.get());
    this.doc.set(next);
    this.syncHistory();
  }

  /** Replace the whole doc (load a template). Undoable. */
  replace(doc: Doc) {
    const valid = validateDoc(doc);
    if (!valid) throw new Error('Not a Mode 7 document');
    this.record(this.doc.get());
    this.doc.set(valid);
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
    this.doc.set(s.doc);
    this.syncHistory();
  }

  /** Stop writing to localStorage (e.g. while a demo borrows the board). */
  pauseSaving(paused: boolean) {
    this.savingPaused = paused;
    if (paused) clearTimeout(this.saveTimer);
  }
  private savingPaused = false;

  toJSON(): Doc {
    return this.doc.get();
  }

  /* ---------------------------------------------------------------- */

  private apply(doc: Doc, cmd: Command | Command[]): Doc {
    const cols = this.cols.get();
    const list = Array.isArray(cmd) ? cmd : [cmd];
    return list.reduce((d, c) => reduce(d, c, cols), doc);
  }

  private cancelTxn() {
    const t = this.txn;
    this.txn = null;
    if (t) this.doc.set(t.base);
  }

  private record(prev: Doc) {
    this.past.push(prev);
    if (this.past.length > (this.opts.historyLimit ?? 200)) this.past.shift();
    this.future = [];
    this.syncHistory();
  }

  private syncHistory() {
    this.history.set({ canUndo: this.past.length > 0, canRedo: this.future.length > 0 });
  }

  private load(): Doc | null {
    if (!this.opts.storageKey) return null;
    try {
      const raw = localStorage.getItem(this.opts.storageKey);
      return raw ? validateDoc(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private scheduleSave() {
    if (!this.opts.storageKey || this.txn || this.savingPaused) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.opts.storageKey!, JSON.stringify(this.doc.get()));
      } catch {
        /* storage full or blocked */
      }
    }, 250);
  }
}

const isSelectOnly = (cmd: Command | Command[]) => (Array.isArray(cmd) ? cmd.every((c) => c.t === 'layer.select') : cmd.t === 'layer.select');

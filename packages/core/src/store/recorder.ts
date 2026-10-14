import type { Change, Store } from './store';
import type { Doc } from './doc';

/**
 * A session as data: where it started and every change after, with timing.
 * Save one to reproduce a bug exactly, ship one as a tutorial, or play one
 * back as a demo. It's also the shape that live sync streams.
 */
export interface Recording {
  format: 'mode7-session';
  version: 1;
  start: Doc;
  steps: { at: number; change: Change }[];
}

/** Start recording a store. Call `stop()` to get the recording. */
export function record(store: Store): { stop(): Recording } {
  const start = store.doc.get();
  const t0 = Date.now();
  const steps: Recording['steps'] = [];
  const off = store.changes.on('change', (change) => steps.push({ at: Date.now() - t0, change }));
  return {
    stop() {
      off();
      return { format: 'mode7-session', version: 1, start, steps };
    },
  };
}

/** Apply one change to a store, exactly as it happened (columns included). */
export function applyChange(store: Store, change: Change) {
  if (change.kind === 'do') store.dispatch(change.cmds, { cols: change.cols, origin: change.origin ?? 'replay' });
  else store.replace(change.doc);
}

/**
 * Play a recording into a store. `speed: Infinity` applies everything at
 * once; otherwise steps keep their original timing. Resolves with the final doc.
 */
export async function replay(store: Store, rec: Recording, o: { speed?: number; signal?: AbortSignal } = {}): Promise<Doc> {
  const speed = o.speed ?? Infinity;
  store.replace(rec.start);
  let last = 0;
  for (const step of rec.steps) {
    if (o.signal?.aborted) break;
    const wait = (step.at - last) / speed;
    last = step.at;
    if (wait > 4) await new Promise((r) => setTimeout(r, wait));
    applyChange(store, step.change);
  }
  return store.doc.get();
}

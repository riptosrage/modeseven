/**
 * The smallest useful reactive value: get, set, subscribe.
 * No auto-tracking magic, so it's obvious what updates what.
 */
export interface Signal<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  /** Call `fn` on every change. Returns an unsubscribe function. Does not fire immediately. */
  subscribe(fn: (value: T, prev: T) => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<(v: T, p: T) => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      const prev = value;
      value = next;
      for (const fn of [...subs]) fn(value, prev);
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/** Tiny event emitter for things that aren't values (gestures, commands). */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let s = this.map.get(type);
    if (!s) this.map.set(type, (s = new Set()));
    s.add(fn as (p: never) => void);
    return () => void s!.delete(fn as (p: never) => void);
  }
  emit<K extends keyof E>(type: K, payload: E[K]) {
    this.map.get(type)?.forEach((fn) => (fn as (p: E[K]) => void)(payload));
  }
}

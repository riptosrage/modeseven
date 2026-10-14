import { describe, expect, it } from 'vitest';
import { Store, emptyDoc, layoutFor } from '../src/store';
import { isValid } from '../src/solver';

const add = (id: string, w = 2, h = 2) => ({ t: 'add' as const, id, type: 'blank', size: { w, h } });

describe('store', () => {
  it('dispatch records one undo step per command', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch(add('a'));
    s.dispatch(add('b'));
    expect(Object.keys(s.layer.modules)).toEqual(['a', 'b']);
    s.undo();
    expect(Object.keys(s.layer.modules)).toEqual(['a']);
    s.redo();
    expect(Object.keys(s.layer.modules)).toEqual(['a', 'b']);
  });

  it('a transaction previews from its base and commits as one step', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch([add('a'), add('b')]);
    const t = s.begin();
    t.preview({ t: 'place', id: 'a', rect: { x: 2, y: 0, w: 2, h: 2 } });
    expect(s.layout().b).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    t.preview({ t: 'place', id: 'a', rect: { x: 0, y: 5, w: 2, h: 2 } });
    expect(s.layout().b).toEqual({ x: 2, y: 0, w: 2, h: 2 }); // back home
    t.commit();
    s.undo();
    expect(s.layout().a).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('cancel restores the base', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch(add('a'));
    const before = s.doc.get();
    const t = s.begin();
    t.preview({ t: 'place', id: 'a', rect: { x: 4, y: 4, w: 2, h: 2 } });
    t.cancel();
    expect(s.doc.get()).toBe(before);
  });

  it('keeps a separate layout per column count, derived on first visit', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch([add('a', 6, 2), add('b'), add('c')]);
    s.cols.set(4);
    const four = s.layout();
    expect(isValid(four, 4)).toBe(true);
    expect(four.a.w).toBe(4);
    // Edit at 4 cols; the 8-col layout is untouched.
    s.dispatch({ t: 'place', id: 'b', rect: { x: 0, y: 8, w: 1, h: 1 } });
    s.cols.set(8);
    expect(s.layout().b).toEqual({ x: 6, y: 0, w: 2, h: 2 });
  });

  it('modules added at one width appear at others', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch(add('a'));
    s.cols.set(4);
    s.dispatch(add('b'));
    s.cols.set(8);
    const l = layoutFor(s.layer, 8);
    expect(l.b).toBeDefined();
    expect(isValid(l, 8)).toBe(true);
  });

  it('remove drops the module from every layout', () => {
    const s = new Store({ doc: emptyDoc() });
    s.cols.set(8);
    s.dispatch(add('a'));
    s.cols.set(4);
    s.dispatch({ t: 'place', id: 'a', rect: { x: 1, y: 1, w: 2, h: 2 } });
    s.dispatch({ t: 'remove', id: 'a' });
    expect(Object.values(s.layer.layouts).every((l) => !l.a)).toBe(true);
  });
});

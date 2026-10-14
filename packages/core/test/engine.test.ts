import { describe, expect, it } from 'vitest';
import { Store, emptyDoc, type Change } from '../src/store';
import { record, replay } from '../src/store/recorder';
import { Engine } from '../src/engine';
import { tokenize } from '../src/actions/actions';
import { param, coerce, toNormal, fromNormal, format } from '../src/params/spec';
import { parseMidi, describeSource } from '../src/midi/midi';
import { defineModule, type ModuleDef } from '../src/modules/types';

/* A headless module set: no DOM anywhere in these tests. */
const mods: ModuleDef[] = [
  defineModule({ type: 'blank', title: 'Blank', size: [2, 2], mount() {} }),
  defineModule({ type: 'knob', title: 'Knob', size: [1, 1], params: { value: param.number(0, 100, 50, { unit: '%' }) }, mount() {} }),
  defineModule({
    type: 'filter',
    title: 'Filter',
    size: [2, 1],
    params: {
      cutoff: param.number(20, 20000, 800, { unit: 'Hz', curve: 'exp', label: 'Cutoff' }),
      on: param.toggle(true),
      mode: param.choice(['low', 'band', 'high']),
    },
    mount() {},
  }),
];

const engine = () => {
  const e = new Engine({ modules: mods, store: new Store({ doc: emptyDoc() }) });
  e.store.cols.set(12);
  return e;
};

const must = <T>(r: { ok: boolean; value?: unknown; error?: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
};

describe('param specs', () => {
  const cutoff = param.number(20, 20000, 800, { unit: 'Hz', curve: 'exp' });
  it('round-trips normal values, with exp curves for frequency', () => {
    expect(toNormal(cutoff, 20)).toBe(0);
    expect(toNormal(cutoff, 20000)).toBe(1);
    expect(fromNormal(cutoff, toNormal(cutoff, 800))).toBeCloseTo(800, 6);
    // Halfway along an exp knob is the geometric middle, not 10 kHz.
    expect(fromNormal(cutoff, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 3);
  });
  it('coerces typed, out-of-range and stepped input', () => {
    const p = param.number(0, 10, 5, { step: 0.5 });
    expect(coerce(p, '7.3')).toBe(7.5);
    expect(coerce(p, 99)).toBe(10);
    expect(coerce(p, 'nope')).toBe(5);
    expect(coerce(param.toggle(), 'on')).toBe(true);
    expect(coerce(param.choice(['a', 'b']), 'B')).toBe('b');
    expect(coerce(param.choice(['a', 'b']), 1)).toBe('b');
  });
  it('formats with units', () => {
    expect(format(cutoff, 2400)).toBe('2.4 kHz');
    expect(format(cutoff, 800)).toBe('800 Hz');
    expect(format(param.number(0, 100, 50, { unit: '%' }), 75)).toBe('75%');
    expect(format(param.toggle(), true)).toBe('On');
  });
});

describe('store: gestures, coalescing, changes', () => {
  it('a change dispatched mid-gesture lands under the preview', () => {
    const e = engine();
    const k = e.add('knob', { x: 0, y: 0, w: 1, h: 1 }, { id: 'k' });
    e.add('blank', { x: 4, y: 0, w: 2, h: 2 }, { id: 'b' });
    const t = e.store.begin();
    t.preview({ t: 'place', id: 'b', rect: { x: 6, y: 3, w: 2, h: 2 } });
    e.params.set(`${k}.value`, 90); // e.g. MIDI while dragging
    expect(e.store.layout().b).toEqual({ x: 6, y: 3, w: 2, h: 2 });
    expect(e.params.get('k.value')).toBe(90);
    t.commit();
    e.store.undo(); // the move
    expect(e.store.layout().b).toEqual({ x: 4, y: 0, w: 2, h: 2 });
    expect(e.params.get('k.value')).toBe(90);
    e.store.undo(); // the param
    expect(e.params.get('k.value')).toBe(50);
  });

  it('cancelling a gesture keeps what was dispatched meanwhile', () => {
    const e = engine();
    e.add('knob', undefined, { id: 'k' });
    const t = e.store.begin();
    t.preview({ t: 'place', id: 'k', rect: { x: 5, y: 5, w: 1, h: 1 } });
    e.params.set('k.value', 10);
    t.cancel();
    expect(e.params.get('k.value')).toBe(10);
    expect(e.store.layout().k).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('a drag is one undo step however many values it sets', () => {
    const e = engine();
    e.add('knob', undefined, { id: 'k' });
    const h = e.params.handle('k', 'value');
    h.begin();
    for (let v = 50; v <= 80; v += 3) h.set(v);
    h.end();
    expect(e.params.get('k.value')).toBe(80);
    e.store.undo();
    expect(e.params.get('k.value')).toBe(50);
    expect(e.store.history.get().canUndo).toBe(true); // the add is still there
  });

  it('no-op commands make no undo steps', () => {
    const e = engine();
    e.add('knob', undefined, { id: 'k' });
    e.store.dispatch({ t: 'remove', id: 'ghost' });
    e.params.set('k.value', 50);
    e.store.undo();
    expect(Object.keys(e.store.layer.modules)).toEqual([]);
  });

  it('emits every committed change, and only commits', () => {
    const e = engine();
    const seen: Change['kind'][] = [];
    e.store.changes.on('change', (c) => seen.push(c.kind));
    e.add('blank', undefined, { id: 'a' });
    const t = e.store.begin();
    t.preview({ t: 'place', id: 'a', rect: { x: 3, y: 0, w: 2, h: 2 } });
    t.preview({ t: 'place', id: 'a', rect: { x: 4, y: 0, w: 2, h: 2 } });
    t.commit();
    e.store.undo();
    expect(seen).toEqual(['do', 'do', 'undo']);
  });
});

describe('command language', () => {
  it('adds, moves, resizes, sets and lists from plain text', () => {
    const e = engine();
    const id = must<string>(e.run('add knob at 3,2'));
    expect(e.store.layout()[id]).toEqual({ x: 3, y: 2, w: 1, h: 1 });
    must(e.run('add filter at 0,0 as Low pass'));
    must(e.run('move knob to 6,0'));
    expect(e.store.layout()[id]).toMatchObject({ x: 6, y: 0 });
    must(e.run('move knob 7,1')); // "to" is optional
    expect(e.store.layout()[id]).toMatchObject({ x: 7, y: 1 });
    must(e.run('resize knob to 2x2'));
    expect(e.store.layout()[id]).toMatchObject({ w: 2, h: 2 });
    expect(must(e.run('set knob to 80%'))).toBe('80%');
    expect(must(e.run('set "low pass".cutoff 2400'))).toBe('2.4 kHz');
    expect(must(e.run('set filter.mode high'))).toBe('high');
    expect(must(e.run('set filter.cutoff 2k'))).toBe('2 kHz');
    const list = must<{ title: string }[]>(e.run('list'));
    expect(list.map((m) => m.title).sort()).toEqual(['Knob', 'Low pass']);
  });

  it('tokenizes quotes and apostrophes sensibly', () => {
    expect(tokenize(`title note Felix's plan`)).toEqual(['title', 'note', "Felix's", 'plan']);
    expect(tokenize(`set "low pass".cutoff 2400`)).toEqual(['set', 'low pass.cutoff', '2400']);
  });

  it('takes objects, the shape AI tool calls arrive in', () => {
    const e = engine();
    const id = must<string>(e.run({ action: 'add', type: 'knob', at: [1, 1] }));
    must(e.run({ action: 'set', param: 'knob.value', value: 12 }));
    expect(e.params.get(`${id}.value`)).toBe(12);
    must(e.run({ action: 'layer_add', name: 'Drums' }));
    expect(e.store.layer.name).toBe('Drums');
  });

  it('explains mistakes instead of throwing', () => {
    const e = engine();
    e.run('add knob');
    e.run('add knob');
    const r1 = e.run('set knob 3');
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.error).toMatch(/There are 2/);
    const r2 = e.run('add synth');
    expect(!r2.ok && r2.error).toMatch(/Types: blank, knob, filter/);
    const r3 = e.run('frobnicate');
    expect(!r3.ok && r3.error).toMatch(/No command/);
    const r4 = e.run('move');
    expect(!r4.ok && r4.error).toMatch(/Usage: move <module> to x,y/);
  });

  it('describes itself as LLM tool definitions', () => {
    const tools = engine().actions.tools();
    const add = tools.find((t) => t.name === 'add')!;
    expect(add.input_schema.required).toEqual(['type']);
    expect(add.input_schema.properties.at).toMatchObject({ type: 'array' });
    expect(tools.find((t) => t.name === 'layer_add')).toBeTruthy();
  });
});

describe('recording and replay', () => {
  it('replays a session to the identical doc', async () => {
    const e = engine();
    const rec = record(e.store);
    e.run('add knob at 0,0');
    e.run('add filter at 2,0');
    e.run('set knob 70');
    e.run('move filter to 4,3');
    e.store.undo();
    e.run('tidy');
    e.run('layer add Second');
    e.run('add blank');
    const r = rec.stop();
    const fresh = new Store({ doc: emptyDoc() });
    const out = await replay(fresh, JSON.parse(JSON.stringify(r)));
    expect(out).toEqual(e.store.doc.get());
  });
});

describe('MIDI', () => {
  it('parses messages', () => {
    expect(parseMidi([0xb0, 74, 127])).toMatchObject({ control: 'cc:1:74', value: 1, kind: 'cc' });
    expect(parseMidi([0x99, 36, 100])).toMatchObject({ control: 'note:10:36', on: true });
    expect(parseMidi([0x89, 36, 0])).toMatchObject({ on: false });
    expect(parseMidi([0xf8])).toBeNull();
    expect(describeSource('midi:cc:1:74')).toBe('CC 74');
    expect(describeSource('midi:note:10:36')).toBe('C2 · ch 10');
  });

  it('learns a control and drives the param with it, as one undo step per sweep', () => {
    const e = engine();
    e.add('knob', undefined, { id: 'k' });
    e.add('filter', undefined, { id: 'f' });
    e.midi.learn('k.value');
    e.midi.inject([0xb0, 21, 64]);
    expect(e.store.doc.get().mappings).toEqual({ 'midi:cc:1:21': 'k.value' });
    for (let v = 0; v <= 127; v += 8) e.midi.inject([0xb0, 21, v]);
    e.midi.inject([0xb0, 21, 127]);
    expect(e.params.get('k.value')).toBe(100);
    e.store.undo(); // the whole sweep
    expect(e.params.get('k.value')).toBe(50);
    // A pad flips a toggle.
    e.run('map f.on from midi:note:10:36');
    e.midi.inject([0x99, 36, 100]);
    e.midi.inject([0x89, 36, 0]);
    expect(e.params.get('f.on')).toBe(false);
  });

  it('forgets mappings when their module goes', () => {
    const e = engine();
    e.add('knob', undefined, { id: 'k' });
    e.run('map knob from midi:cc:1:7');
    e.run('remove knob');
    expect(e.store.doc.get().mappings).toEqual({});
  });
});

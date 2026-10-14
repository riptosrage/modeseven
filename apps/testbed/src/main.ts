import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@mode7/core/styles.css';
import './style.css';
import { Board, Store, svg, type Doc, type Layout } from '@mode7/core';
import { blank } from './modules/blank';
import { note } from './modules/note';
import { knob } from './modules/knob';
import { wave } from './modules/wave';
import { clock } from './modules/clock';
import { xy } from './modules/xy';
import { Demo } from './demo';
import { isTauri, keepStorage, openText, registerOffline, saveText } from './platform';

/* ---- starter board: a few blanks at 12 columns; other widths derive from it ---- */
const mods: [string, string, [number, number, number, number], Record<string, unknown>?][] = [
  ['a', 'blank', [0, 0, 4, 2], { tint: 0 }],
  ['b', 'blank', [4, 0, 2, 2], { tint: 1 }],
  ['c', 'blank', [6, 0, 1, 1], { tint: 2 }],
  ['d', 'knob', [7, 0, 1, 1]],
  ['e', 'blank', [8, 0, 4, 4], { tint: 4 }],
  ['f', 'note', [6, 1, 2, 3]],
  ['g', 'blank', [0, 2, 2, 4], { tint: 3 }],
  ['h', 'blank', [2, 2, 4, 2], { tint: 5 }],
];
const layout: Layout = Object.fromEntries(mods.map(([id, , [x, y, w, h]]) => [id, { x, y, w, h }]));
const starter: Doc = {
  v: 1,
  active: 0,
  layers: [
    { id: 'board', name: 'Board', modules: Object.fromEntries(mods.map(([id, type, , props]) => [id, { id, type, ...(props ? { props } : {}) }])), layouts: { '12': layout } },
    { id: 'empty', name: 'Empty', modules: {}, layouts: {} },
  ],
};

const store = new Store({ doc: starter, storageKey: 'mode7.testbed.v1' });

const icon = {
  tile: svg('<rect x="8" y="8" width="8" height="8" rx="2"/>'),
  small: svg('<rect x="6" y="6" width="12" height="12" rx="3"/>'),
  wide: svg('<rect x="3" y="7" width="18" height="10" rx="3"/>'),
  large: svg('<rect x="4" y="4" width="16" height="16" rx="3"/>'),
  blank: svg('<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M12 9v6M9 12h6"/>'),
};

const board = new Board({
  root: document.getElementById('board')!,
  store,
  modules: [blank, note, knob, wave, clock, xy],
  addMenu: [
    {
      key: 'blanks',
      label: 'Blank',
      icon: icon.blank,
      children: [
        { key: 'blank:1x1', label: 'Tile 1×1', icon: icon.tile },
        { key: 'blank:2x2', label: 'Small 2×2', icon: icon.small },
        { key: 'blank:4x2', label: 'Wide 4×2', icon: icon.wide },
        { key: 'blank:4x4', label: 'Large 4×4', icon: icon.large },
      ],
    },
    {
      key: 'tools',
      label: 'Tools',
      icon: wave.icon!,
      children: [
        { key: 'wave', label: 'Waveform', icon: wave.icon! },
        { key: 'xy', label: 'XY pad', icon: xy.icon! },
        { key: 'knob', label: 'Knob', icon: knob.icon! },
      ],
    },
    { key: 'clock', label: 'Clock', icon: clock.icon! },
    { key: 'note', label: 'Note', icon: note.icon! },
    { key: 'ai', label: 'Ask AI (soon)', icon: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>') },
  ],
  onAdd(key, at, b) {
    if (key === 'ai') {
      b.overlays.toast('Prompt-to-module comes after the foundation');
      return true;
    }
    const m = /^blank:(\d)x(\d)$/.exec(key);
    if (m) {
      const [w, h] = [Number(m[1]), Number(m[2])];
      const drawn = at.rect.w > 1 || at.rect.h > 1;
      b.add('blank', drawn ? at.rect : { ...at.rect, w, h }, { props: { tint: Math.floor(Math.random() * 6) } });
      return true;
    }
  },
});

/* ---- toolbar ---- */
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const arrange = $('#arrange');
const undo = $<HTMLButtonElement>('#undo');
const redo = $<HTMLButtonElement>('#redo');
const zoom = $('#zoom');
const tilt = $<HTMLInputElement>('#tilt');
const cell = $<HTMLInputElement>('#cell');
const cellOut = $('#cell-out');

arrange.onclick = () => board.setMode(board.mode.get() === 'arrange' ? 'use' : 'arrange');
board.mode.subscribe((m) => {
  arrange.textContent = m === 'arrange' ? 'Done' : 'Arrange';
  arrange.classList.toggle('is-on', m === 'arrange');
});
undo.onclick = () => store.undo();
redo.onclick = () => store.redo();
store.history.subscribe((h) => {
  undo.disabled = !h.canUndo;
  redo.disabled = !h.canRedo;
});
undo.disabled = redo.disabled = true;

zoom.onclick = () => (board.tiltTo(0), board.setCamera({ zoom: 1 }));
tilt.oninput = () => board.tiltTo(Number(tilt.value), true);
cell.oninput = () => {
  board.metricsOptions.set({ minCell: Number(cell.value) });
  cellOut.textContent = `${board.metrics.cols} cols · ${Math.round(board.metrics.cell)} px`;
};
board.clock.every(() => {
  const c = board.camera();
  zoom.textContent = `${Math.round(c.zoom * 100)}%`;
  if (document.activeElement !== tilt) tilt.value = String(Math.round(c.tilt));
});
const syncCell = () => (cellOut.textContent = `${board.metrics.cols} cols · ${Math.round(board.metrics.cell)} px`);
store.cols.subscribe(syncCell);
syncCell();

$('#tidy').onclick = () => store.dispatch({ t: 'tidy' });
$('#midi').onclick = () => board.mapMode.set(!board.mapMode.on.get());
board.mapMode.on.subscribe((on) => $('#midi').classList.toggle('is-on', on));
$('#cmd').onclick = () => board.palette.open();
$('#debug').onclick = () => board.debug.set(!board.debug.get());
board.debug.subscribe((on) => $('#debug').classList.toggle('is-on', on));
$('#theme').onclick = () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem('mode7.theme', r.dataset.theme);
  } catch {
    /* ignore */
  }
};
$('#reset').onclick = () => {
  store.replace(starter);
  board.tiltTo(0, true);
  board.setCamera({ zoom: 1 }, true);
};
try {
  const t = localStorage.getItem('mode7.theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {
  /* ignore */
}

/* ---- demo ---- */
const demoBtn = $('#demo');
const demo = new Demo(board, store, {
  onChange(state) {
    demoBtn.textContent = state === 'idle' ? 'Demo' : state === 'running' ? 'Stop' : 'Exit demo';
    demoBtn.classList.toggle('is-on', state !== 'idle');
    if (state === 'showing') board.overlays.toast('Demo board. Your own board is safe.', { label: 'Back to mine', run: () => demo.exit() });
  },
});
demoBtn.onclick = () => (demo.running || demo.showing ? demo.exit() : demo.play());
// Open with #demo in the URL to start it automatically (handy for screen recordings).
if (location.hash === '#demo') setTimeout(() => demo.play(), 900);

/* ---- project files: save / open ---- */
$('#save').onclick = async () => {
  const name = `${store.layer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'board'}.mode7.json`;
  const file = JSON.stringify({ format: 'mode7', version: 1, savedAt: new Date().toISOString(), doc: store.doc.get() }, null, 2);
  try {
    if (await saveText(name, file)) board.overlays.toast('Saved');
  } catch (e) {
    board.overlays.toast("Couldn't save the file");
    console.error(e);
  }
};
$('#open').onclick = async () => {
  try {
    const text = await openText();
    if (!text) return;
    const data = JSON.parse(text);
    store.replace(data?.format === 'mode7' ? data.doc : data);
    board.overlays.toast('Opened', { label: 'Undo', run: () => store.undo() });
  } catch (e) {
    board.overlays.toast("That file isn't a Mode 7 project");
    console.error(e);
  }
};

/* ---- platform ---- */
if (isTauri) document.documentElement.classList.add('is-tauri');
keepStorage();
registerOffline();

Object.assign(window, { board, store, demo, engine: board.engine });

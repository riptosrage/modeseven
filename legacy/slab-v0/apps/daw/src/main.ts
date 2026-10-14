import '@slab/core/styles.css';
import './style.css';
import { createSurface, instance, EMPTY, type Layer } from '@slab/core';
import { I } from './icons';
import { openAiSheet } from './ai-sheet';
import { togglePlay, toggleRec } from './store';
import { timeline } from './modules/timeline';
import { record } from './modules/record';
import { browser } from './modules/browser';
import { mixer, fader } from './modules/faders';
import { sampler } from './modules/sampler';
import { building } from './modules/building';

const modules = [timeline, record, browser, mixer, fader, sampler, building];

const starter: Layer[] = [
  {
    id: 'session',
    name: 'Session',
    items: [instance('timeline', { w: 4, h: 2 }), instance('browser'), instance('record'), instance(EMPTY), instance(EMPTY)],
  },
  {
    id: 'mix',
    name: 'Mix',
    items: [instance('mixer'), instance('sampler', { title: 'Chop ×4' }), instance('fader', { w: 1, h: 2, title: 'Vox send' }), instance(EMPTY), instance(EMPTY)],
  },
];

const root = document.getElementById('surface')!;
const surface = createSurface({
  root,
  modules,
  layers: starter,
  storageKey: 'slab.daw.v1',
  addMenu: [
    {
      key: 'track',
      label: 'Track',
      icon: I.track,
      children: [
        { key: 'timeline', label: 'Timeline', icon: I.timeline },
        { key: 'mixer', label: 'Mixer', icon: I.mixer },
        { key: 'fader', label: 'Fader', icon: I.fader },
      ],
    },
    { key: 'record', label: 'Record', icon: I.record },
    { key: 'browser', label: 'Browser', icon: I.browser },
    { key: 'sampler', label: 'Sampler', icon: I.sampler },
    { key: 'ai', label: 'Ask AI', icon: I.spark },
  ],
  onAddAction(key, slot, s) {
    if (key !== 'ai') return false;
    openAiSheet(s, slot, 'new');
    return true;
  },
  moduleMenu: (it, s) => [{ label: 'Prompt this module', run: () => openAiSheet(s, it, 'edit') }],
});

/* ---- top bar ---- */
const layerName = document.getElementById('layer-name')!;
const zoomLabel = document.getElementById('zoom-label')!;
const syncBar = () => {
  layerName.textContent = surface.layer.name;
  zoomLabel.textContent = `${Math.round(surface.zoom * 100)}%`;
};
surface.on(syncBar);
syncBar();

document.getElementById('theme')!.innerHTML = I.theme;
document.getElementById('zoom-out')!.innerHTML = I.minus;
document.getElementById('zoom-in')!.innerHTML = I.plus;
document.getElementById('zoom-out')!.onclick = () => surface.setZoom(surface.zoom - 0.15);
document.getElementById('zoom-in')!.onclick = () => surface.setZoom(surface.zoom + 0.15);
document.getElementById('reset')!.onclick = () => surface.reset();
document.getElementById('theme')!.onclick = () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
};

/* ---- transport keys ---- */
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest?.('input,textarea,[contenteditable="true"]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  }
  if (e.key === 'r' || e.key === 'R') toggleRec();
});

/* ---- toast ---- */
let toastTimer = 0;
document.addEventListener('slab:toast', (e) => {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = String((e as CustomEvent).detail);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t!.hidden = true), 2600);
});

// Handy for poking at it from the devtools console.
Object.assign(window, { surface });

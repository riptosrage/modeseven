import { defineModule } from '@slab/core';
import { BARS, onChange, onFrame, position, state, togglePlay } from '../store';
import { I } from '../icons';

const TRACKS = [
  { k: 'rhodes', name: 'Rhodes chop', c: '#2B3038', fg: '#fff', clips: [[0, 0.25, 'A'], [0.25, 0.5, 'B'], [0.5, 0.75, 'A'], [0.75, 1, 'C']] },
  { k: 'drums', name: 'Drums', c: '#666E7A', fg: '#fff', clips: [[0, 0.5, 'break'], [0.5, 1, 'break']] },
  { k: 'vox', name: 'Vox', c: '#B6BCC4', fg: '#14181E', clips: [[0.25, 0.5, 'verse 1']] },
  { k: 'bass', name: 'Bass', c: '#474E59', fg: '#fff', clips: [[0.5, 1, 'line']] },
] as const;

const clip = (a: number, b: number, label: string, cls = '', c = '', fg = '') =>
  `<div class="clip ${cls}" style="left:${a * 100}%;width:calc(${(b - a) * 100}% - 2px);--c:${c};--fg:${fg}">${label}</div>`;

export const timeline = defineModule({
  type: 'timeline',
  title: 'Timeline',
  size: [4, 2],
  minSize: [2, 1],
  mount(body, ctx) {
    ctx.header.innerHTML = `<span class="tl-pos">1.1.1</span><button class="slab-hb play" aria-label="Play"></button>`;
    const pos = ctx.header.querySelector<HTMLElement>('.tl-pos')!;
    const play = ctx.header.querySelector<HTMLButtonElement>('.play')!;
    play.onclick = togglePlay;

    body.innerHTML = `<div class="tl">
      <div class="tl-ruler"><div></div><div class="bars">${Array.from({ length: BARS }, (_, i) => `<span>${i + 1}</span>`).join('')}</div></div>
      <div class="tl-lanes">${TRACKS.map(
        (t) =>
          `<div class="lane"><div class="lane-name">${t.name}</div><div class="lane-track" data-lane="${t.k}">${t.clips
            .map((c) => clip(c[0], c[1], c[2], '', t.c, t.fg))
            .join('')}${t.k === 'vox' ? '<div class="takes"></div>' : ''}</div></div>`,
      ).join('')}</div>
      <div class="playhead"></div></div>`;
    const tl = body.querySelector<HTMLElement>('.tl')!;
    const head = body.querySelector<HTMLElement>('.playhead')!;
    const takes = body.querySelector<HTMLElement>('.takes')!;

    const sync = () => {
      play.innerHTML = state.playing ? I.stop : I.play;
      play.setAttribute('aria-label', state.playing ? 'Stop' : 'Play');
      tl.classList.toggle('recording', state.rec);
      takes.innerHTML =
        state.takes.map((t, i) => clip(t[0], t[1], `take ${i + 1}`, 'rec')).join('') + (state.rec ? clip(state.recStart, state.recStart, 'rec', 'rec live') : '');
    };
    sync();

    const offChange = onChange(sync);
    const offFrame = onFrame(() => {
      head.style.setProperty('--p', String(state.p));
      pos.textContent = position(state.p);
      if (state.rec) {
        const live = takes.querySelector<HTMLElement>('.live');
        if (live) live.style.width = `calc(${Math.max(0, state.p - state.recStart) * 100}% - 2px)`;
      }
    });
    return () => {
      offChange();
      offFrame();
    };
  },
});

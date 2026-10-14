import { defineModule } from '@slab/core';

const SAMPLES = [
  ['dusty_rhodes_92.wav', '0:08'],
  ['soul_break_A.wav', '0:04'],
  ['yt_rip_0412.wav', '1:12'],
  ['choir_stab_Fm.wav', '0:02'],
  ['tape_hiss_room.wav', '0:30'],
  ['vinyl_kick_03.wav', '0:01'],
  ['bus_stop_field.wav', '0:46'],
];
const TRACKS = [
  ['Rhodes chop', 'sample'],
  ['Drums', 'sequence'],
  ['Vox', 'audio in'],
  ['Bass', 'midi'],
];
const FX = [
  ['Compressor', 'vox'],
  ['Tape', 'master'],
  ['Reverb', 'send'],
  ['Bitcrush', '—'],
  ['Warp', 'rhodes'],
];
const TABS = ['Samples', 'Tracks', 'FX'];

export const browser = defineModule({
  type: 'browser',
  title: 'Browser',
  size: [2, 2],
  mount(body, ctx) {
    let tab = Number(ctx.instance.props?.tab ?? 0);
    let sel = Number(ctx.instance.props?.sel ?? 0);

    const rows = () => {
      if (tab === 0)
        return SAMPLES.map(
          (s, i) => `<button class="row${sel === i ? ' on' : ''}" data-i="${i}"><span class="wv"></span><span class="nm">${s[0]}</span><span class="meta">${s[1]}</span></button>`,
        ).join('');
      const list = tab === 1 ? TRACKS : FX;
      return list.map((r) => `<button class="row"><span class="nm">${r[0]}</span><span class="meta">${r[1]}</span></button>`).join('');
    };
    const render = () => {
      body.innerHTML = `<div class="br"><div class="tabs">${TABS.map((t, i) => `<button data-tab="${i}" class="${tab === i ? 'on' : ''}">${t}</button>`).join('')}</div><div class="list">${rows()}</div></div>`;
    };
    render();

    body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tb = t.closest<HTMLElement>('[data-tab]');
      if (tb) {
        tab = Number(tb.dataset.tab);
        ctx.setProps({ tab });
        return render();
      }
      const row = t.closest<HTMLElement>('.row[data-i]');
      if (row) {
        sel = Number(row.dataset.i);
        ctx.setProps({ sel });
        body.querySelectorAll<HTMLElement>('.row[data-i]').forEach((r) => r.classList.toggle('on', Number(r.dataset.i) === sel));
      }
    });
  },
});

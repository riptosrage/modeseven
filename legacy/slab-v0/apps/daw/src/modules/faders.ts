import { defineModule } from '@slab/core';
import { dB, onChange, onFrame, setMix, state } from '../store';

const CHANNELS = ['Rhodes', 'Drums', 'Vox', 'Bass', 'Master'];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Wire a fader track element: drag sets value, onFrame animates the level bar. */
function wireFader(fd: HTMLElement, get: () => number, set: (v: number) => void) {
  const cap = fd.querySelector<HTMLElement>('.cap')!;
  const lv = fd.querySelector<HTMLElement>('.lv')!;
  const readout = fd.parentElement!.querySelector<HTMLElement>('.db');
  const paint = () => {
    const v = get();
    cap.style.bottom = `calc(6px + (100% - 12px) * ${v})`;
    if (readout) readout.textContent = dB(v);
  };
  fd.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fd.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = fd.getBoundingClientRect();
      set(clamp(1 - (ev.clientY - r.top - 6) / (r.height - 12)));
      paint();
    };
    move(e);
    const up = () => {
      fd.removeEventListener('pointermove', move);
      fd.removeEventListener('pointerup', up);
    };
    fd.addEventListener('pointermove', move);
    fd.addEventListener('pointerup', up);
  });
  paint();
  return {
    paint,
    meter: () => {
      const v = state.playing ? get() * (0.55 + Math.random() * 0.4) : 0;
      lv.style.height = `calc((100% - 12px) * ${v})`;
    },
  };
}

const faderHTML = () => `<div class="fd"><span class="lv"></span><span class="cap"></span></div><span class="db"></span>`;

export const mixer = defineModule({
  type: 'mixer',
  title: 'Mixer',
  size: [2, 2],
  mount(body) {
    body.innerHTML = `<div class="mix">${CHANNELS.map((n, i) => `<div class="ch${i === 4 ? ' master' : ''}">${faderHTML()}<span class="cn">${n}</span></div>`).join('')}</div>`;
    const wired = [...body.querySelectorAll<HTMLElement>('.fd')].map((fd, i) =>
      wireFader(
        fd,
        () => state.mix[i],
        (v) => setMix(i, v),
      ),
    );
    const offChange = onChange(() => wired.forEach((w) => w.paint()));
    const offFrame = onFrame(() => wired.forEach((w) => w.meter()));
    return () => {
      offChange();
      offFrame();
    };
  },
});

export const fader = defineModule({
  type: 'fader',
  title: 'Fader',
  size: [1, 2],
  mount(body, ctx) {
    let v = Number(ctx.instance.props?.value ?? 0.7);
    body.innerHTML = `<div class="one">${faderHTML()}</div>`;
    const w = wireFader(
      body.querySelector<HTMLElement>('.fd')!,
      () => v,
      (nv) => {
        v = nv;
        ctx.setProps({ value: v });
      },
    );
    return onFrame(w.meter);
  },
});

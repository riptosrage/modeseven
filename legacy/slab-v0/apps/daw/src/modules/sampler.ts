import { defineModule } from '@slab/core';

/** Fake peaks: four decaying hits, seeded so every sampler looks the same. */
const PEAKS = (() => {
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 320 }, (_, i) => {
    const q = (i % 80) / 80;
    return Math.min(1, (0.15 + 0.85 * Math.exp(-q * 3.2)) * (0.45 + 0.55 * rnd()));
  });
})();
const NOTES = [196, 247, 294, 392];

let audio: AudioContext | null = null;
function blip(i: number) {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(NOTES[i], t);
    o.frequency.exponentialRampToValueAtTime(NOTES[i] / 2, t + 0.18);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.24);
  } catch {
    /* no audio available */
  }
}

export const sampler = defineModule({
  type: 'sampler',
  title: 'Sampler',
  size: [2, 2],
  mount(body, ctx) {
    const slices = 4;
    body.innerHTML = `<div class="chop"><canvas></canvas><div class="pads">${Array.from({ length: slices }, (_, i) => `<button class="pad" data-pad="${i}">${i + 1}</button>`).join('')}</div></div>`;
    const canvas = body.querySelector('canvas')!;
    let hit: number | null = null;

    const draw = () => {
      const d = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = w * d;
      canvas.height = h * d;
      const x = canvas.getContext('2d')!;
      const css = getComputedStyle(body);
      x.scale(d, d);
      if (hit !== null) {
        x.fillStyle = 'rgba(226,55,44,.14)';
        x.fillRect((hit * w) / slices, 0, w / slices, h);
      }
      const bw = w / PEAKS.length;
      x.fillStyle = css.getPropertyValue('--slab-ink-2').trim() || '#58606B';
      PEAKS.forEach((p, i) => {
        const v = p * (h / 2 - 6);
        x.fillRect(i * bw, h / 2 - v, Math.max(1, bw - 0.6), v * 2);
      });
      x.fillStyle = css.getPropertyValue('--slab-ink').trim() || '#14181E';
      x.font = '500 10px "Geist Mono", monospace';
      for (let k = 0; k < slices; k++) {
        if (k) x.fillRect((k * w) / slices - 0.5, 0, 1, h);
        x.fillText(String(k + 1), (k * w) / slices + 6, 14);
      }
    };
    ctx.onResize(draw);

    body.addEventListener('pointerdown', (e) => {
      const pad = (e.target as HTMLElement).closest<HTMLElement>('.pad');
      if (!pad) return;
      const i = Number(pad.dataset.pad);
      pad.classList.add('hit');
      setTimeout(() => pad.classList.remove('hit'), 150);
      hit = i;
      draw();
      setTimeout(() => {
        if (hit === i) {
          hit = null;
          draw();
        }
      }, 260);
      blip(i);
    });
  },
});

import { defineModule, svg } from '@mode7/core';

/**
 * A live waveform, like an oscilloscope on a sample. Animates on the board's
 * clock and pauses while being dragged, as modules should.
 */
export const wave = defineModule({
  type: 'wave',
  title: 'Waveform',
  icon: svg('<path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/>'),
  size: [4, 2],
  minSize: [2, 1],
  mount(el, ctx) {
    const canvas = document.createElement('canvas');
    canvas.className = 'wave';
    el.appendChild(canvas);
    const g = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    let t = Math.random() * 10;

    const resize = () => {
      const d = devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, w * d);
      canvas.height = Math.max(1, h * d);
      g.setTransform(d, 0, 0, d, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (dt: number) => {
      if (!w || !h) return;
      if (!ctx.held.get()) t += dt;
      const css = getComputedStyle(el);
      const ink = css.getPropertyValue('--m7-ink-2').trim() || '#58606b';
      const live = css.getPropertyValue('--m7-live').trim() || '#e2372c';
      g.clearRect(0, 0, w, h);
      const bars = Math.max(24, Math.floor(w / 4));
      const bw = w / bars;
      const head = (t * 0.18) % 1;
      for (let i = 0; i < bars; i++) {
        const x = i / bars;
        // A few decaying "hits" plus texture: reads as a drum loop.
        const beat = (x * 4) % 1;
        const env = 0.18 + 0.82 * Math.exp(-beat * 5);
        const tex = 0.55 + 0.45 * Math.sin(i * 1.7 + t * 3) * Math.sin(i * 0.37 + t * 1.3);
        const a = Math.max(0.06, env * tex) * (h / 2 - 4);
        g.fillStyle = x < head ? live : ink;
        g.globalAlpha = x < head ? 0.9 : 0.55;
        g.fillRect(i * bw, h / 2 - a, Math.max(1, bw - 1), a * 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = live;
      g.fillRect(head * w - 1, 0, 2, h);
    };
    // Animate only while it can be seen; off screen it costs nothing.
    let stop: (() => void) | null = null;
    const run = (on: boolean) => {
      stop?.();
      stop = on ? ctx.board.clock.every(draw) : null;
    };
    run(ctx.visible.get());
    const offVis = ctx.visible.subscribe(run);
    return () => {
      stop?.();
      offVis();
      ro.disconnect();
    };
  },
});

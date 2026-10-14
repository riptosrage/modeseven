import { type Board, type Doc, type Store, type StoreSnapshot, SPRINGS } from '@mode7/core';

/**
 * A ~10 second scripted tour for screen recordings. A visible "finger"
 * sends real pointer events into the board, so everything you see is the
 * actual engine responding: long-press, radial menu, drag, resize, Arrange,
 * then the Mode 7 tilt.
 *
 * Borrows the board: your layout and undo history are snapshotted first and
 * put back when you exit. Saving to localStorage is paused meanwhile.
 */

const POINTER_ID = 77;
const demoDoc = (): Doc => ({ v: 1, active: 0, layers: [{ id: 'demo', name: 'Demo', modules: {}, layouts: {} }] });

class Aborted extends Error {}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Demo {
  running = false;
  /** True between a finished run and Exit: the demo board is still showing. */
  showing = false;
  private snap: StoreSnapshot | null = null;
  private prevMetrics: ReturnType<Board['metricsOptions']['get']> | null = null;
  private finger: HTMLElement;
  private title: HTMLElement;
  private pos = { x: 0, y: 0 };
  private pressed = false;
  private downTarget: Element | null = null;
  private cancelled = false;

  constructor(
    private board: Board,
    private store: Store,
    private hooks: { onChange(state: 'idle' | 'running' | 'showing'): void },
  ) {
    this.finger = document.createElement('div');
    this.finger.className = 'demo-finger';
    this.finger.hidden = true;
    document.body.appendChild(this.finger);
    this.title = document.createElement('div');
    this.title.className = 'demo-title';
    this.title.innerHTML = `<div class="demo-word">Mode 7</div><div class="demo-sub">A pegboard for your own tools</div>`;
    this.title.hidden = true;
    document.body.appendChild(this.title);
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.running || this.showing)) this.exit();
    });
  }

  async play() {
    if (this.running) return;
    const b = this.board;
    if (b.vp.w < 700) {
      b.overlays.toast('The demo needs a wider window, like an iPad in landscape or a laptop');
      return;
    }
    this.cancelled = false;
    this.running = true;
    if (!this.snap) {
      this.snap = this.store.snapshot();
      this.prevMetrics = b.metricsOptions.get();
    }
    this.hooks.onChange('running');
    document.body.classList.add('is-demo');
    try {
      await this.script();
      this.showing = true;
      this.hooks.onChange('showing');
    } catch (e) {
      if (!(e instanceof Aborted)) console.error(e);
    } finally {
      this.running = false;
      this.release();
      this.finger.hidden = true;
      this.title.hidden = true;
      this.title.classList.remove('is-in');
      document.body.classList.remove('is-demo');
      this.resetSprings();
      if (this.cancelled) this.restore();
    }
  }

  /** Stop and put the user's board back. */
  exit() {
    if (this.running) {
      this.cancelled = true;
      return;
    }
    this.restore();
  }

  private restore() {
    const b = this.board;
    if (this.snap) {
      b.setMode('use');
      if (this.prevMetrics) b.metricsOptions.set(this.prevMetrics);
      this.store.restore(this.snap);
      this.store.pauseSaving(false);
      b.tiltTo(0, true);
      b.setCamera({ zoom: 1, y: b.vp.h / 2 }, true);
    }
    this.snap = null;
    this.showing = false;
    this.hooks.onChange('idle');
  }

  /* ------------------------------------------------------------- script */

  private async script() {
    const b = this.board;
    const s = this.store;

    // A clean 12-column board.
    s.pauseSaving(true);
    b.unfocus(true);
    b.setMode('use');
    b.metricsOptions.set({ ...(this.prevMetrics ?? {}), steps: [12], minCell: 40 });
    s.restore({ doc: demoDoc(), past: [], future: [] });
    b.tiltTo(0, true);
    b.setCamera({ zoom: 1, y: b.vp.h / 2 }, true);
    await this.wait(250);

    // 1. Long-press an empty cell, slide through the radial menu, release.
    const start = this.cell(1.4, 1.6);
    this.pos = { x: start.x + 40, y: start.y + 60 };
    this.showFinger();
    await this.moveTo(start.x, start.y, 220);
    const at = this.cell(0.5, 0.5);
    await this.moveTo(at.x, at.y, 220);
    this.down();
    await this.wait(470); // long-press opens the radial under the finger
    const parent = this.nodeCenter('blanks');
    await this.moveTo(parent.x, parent.y, 220);
    await this.wait(90);
    const kid = this.nodeCenter('blank:4x4');
    await this.moveTo(kid.x, kid.y, 200);
    await this.wait(100);
    this.up();
    await this.wait(220);

    // 2. A burst of modules.
    const burst: [string, [number, number, number, number], Record<string, unknown>?][] = [
      ['wave', [4, 0, 6, 2]],
      ['knob', [10, 0, 1, 1], { value: 0.72 }],
      ['knob', [11, 0, 1, 1], { value: 0.3 }],
      ['clock', [10, 1, 2, 1]],
      ['xy', [4, 2, 2, 2]],
      ['blank', [6, 2, 2, 2], { tint: 1 }],
      ['note', [8, 2, 2, 2], { text: 'Hook idea: chop the rhodes into 4, pitch the last one down' }],
      ['blank', [10, 2, 2, 2], { tint: 2 }],
      ['blank', [0, 4, 4, 2], { tint: 5 }],
      ['blank', [4, 4, 1, 1], { tint: 3 }],
      ['blank', [5, 4, 1, 1], { tint: 4 }],
    ];
    const ids: string[] = [];
    this.moveTo(this.cell(7, 3).x, this.cell(7, 3).y, 500).catch(() => {}); // drift while they land
    for (const [type, [x, y, w, h], props] of burst) {
      ids.push(b.add(type, { x, y, w, h }, props ? { props } : {}));
      await this.wait(52);
    }
    await this.wait(300);

    // 3. Drag one onto another: they swap.
    const swapId = ids[5];
    const head = this.headPoint(swapId);
    await this.moveTo(head.x, head.y, 280);
    this.down();
    await this.wait(60);
    const dest = this.cellTopLeft(4, 2);
    await this.moveTo(dest.x + (head.x - this.cellTopLeft(6, 2).x), dest.y + (head.y - this.cellTopLeft(6, 2).y), 480);
    await this.wait(140);
    this.up();
    await this.wait(320);

    // 4. Resize: widen the strip, its neighbours step aside.
    const corner = this.handlePoint(ids[8]);
    await this.moveTo(corner.x, corner.y, 300);
    this.down();
    await this.wait(60);
    await this.moveTo(corner.x + b.metrics.pitch * 2 * b.camera().zoom, corner.y + b.metrics.pitch * 0.15, 480);
    await this.wait(160);
    this.up();
    await this.wait(320);

    // 5. Long-press for Arrange mode, then tap out.
    const noteEl = b.shells.get(ids[7])?.el.getBoundingClientRect();
    if (noteEl) {
      await this.moveTo(noteEl.left + noteEl.width / 2, noteEl.top + noteEl.height * 0.62, 280);
      this.down();
      await this.wait(470);
      this.up();
      await this.wait(520);
      const empty = this.cell(9.5, 5.2);
      await this.moveTo(empty.x, empty.y, 260);
      this.down();
      await this.wait(50);
      this.up();
      await this.wait(200);
    }

    // 6. Mode 7: lean the board back into a horizon, fly down it, title in the sky.
    this.hideFinger();
    const row = (r: number) => b.metrics.margin + r * b.metrics.pitch;
    const springs = (response: number) => {
      for (const k of ['x', 'y', 'zoom', 'tilt'] as const) b.cam[k].config = { response, damping: 1 };
    };
    b.setPerspective(0.7);
    springs(1.1);
    b.setCamera({ tilt: 66, zoom: 1.4, y: row(6.8) });
    await this.wait(850);
    b.cam.y.config = { response: 2.6, damping: 1 };
    b.setCamera({ y: row(3.6) });
    await this.wait(300);
    this.title.hidden = false;
    requestAnimationFrame(() => this.title.classList.add('is-in'));
    await this.wait(1600);
    this.title.classList.remove('is-in');
    springs(0.85);
    b.setCamera({ tilt: 0, zoom: 1, y: b.vp.h / 2 });
    await this.wait(950);
    b.setPerspective(1.1);
    this.title.hidden = true;
  }

  /* ------------------------------------------------------------ helpers */

  private check() {
    if (this.cancelled) throw new Aborted();
  }

  private wait(ms: number) {
    this.check();
    return new Promise<void>((res) => setTimeout(res, ms)).then(() => this.check());
  }

  /** Client coordinates of a point in cell space (cell units, so 0.5 = middle of the first cell). */
  private cell(cx: number, cy: number) {
    const b = this.board;
    const m = b.metrics;
    const s = b.toScreen(m.margin + cx * m.pitch - m.gap / 2 + m.gap / 2, m.margin + cy * m.pitch);
    const r = b.viewport.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }

  private cellTopLeft(x: number, y: number) {
    return this.cell(x, y);
  }

  private headPoint(id: string) {
    const r = this.board.shells.get(id)!.el.querySelector('.m7-title')!.getBoundingClientRect();
    return { x: r.left + 18, y: r.top + r.height / 2 };
  }

  private handlePoint(id: string) {
    const r = this.board.shells.get(id)!.el.querySelector('.m7-handle-se')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private nodeCenter(key: string) {
    const el = document.querySelector(`.m7-radial-node[data-key="${key}"]`);
    if (!el) throw new Aborted();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private showFinger() {
    this.finger.hidden = false;
    this.paintFinger();
    requestAnimationFrame(() => this.finger.classList.add('is-in'));
  }

  private hideFinger() {
    this.finger.classList.remove('is-in');
  }

  private paintFinger() {
    this.finger.style.transform = `translate3d(${this.pos.x}px, ${this.pos.y}px, 0)`;
    this.finger.classList.toggle('is-down', this.pressed);
  }

  private moveTo(x: number, y: number, ms: number) {
    this.check();
    const from = { ...this.pos };
    const t0 = performance.now();
    return new Promise<void>((res) => {
      const step = () => {
        if (this.cancelled) return res();
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = ease(k);
        this.pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
        this.paintFinger();
        this.fire('pointermove');
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    }).then(() => this.check());
  }

  private down() {
    this.pressed = true;
    this.paintFinger();
    this.downTarget = document.elementFromPoint(this.pos.x, this.pos.y);
    this.fire('pointerdown');
  }

  private up() {
    this.fire('pointerup');
    this.pressed = false;
    this.downTarget = null;
    this.paintFinger();
  }

  /** Let go cleanly if the demo is stopped mid-gesture. */
  private release() {
    if (!this.pressed) return;
    this.fire('pointercancel');
    this.pressed = false;
    this.downTarget = null;
  }

  private fire(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel') {
    const { x, y } = this.pos;
    const target = (type === 'pointerdown' ? this.downTarget : document.elementFromPoint(x, y)) ?? document.body;
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: POINTER_ID,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: this.pressed && type !== 'pointerup' && type !== 'pointercancel' ? 1 : 0,
      }),
    );
  }

  private resetSprings() {
    const b = this.board;
    b.setPerspective(1.1);
    for (const k of ['x', 'y', 'zoom', 'tilt'] as const) b.cam[k].config = SPRINGS.camera;
  }
}

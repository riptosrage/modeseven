import { signal } from '../store/signal';
import { describeSource } from '../midi/midi';
import { Params } from '../params/registry';
import type { Board } from './board';

/**
 * MIDI map mode, the way Ableton does it: every mappable control lights up,
 * tap one, move something on your controller, done. Any element a module
 * marks with `data-m7-param="key"` is mappable; modules write no MIDI code.
 */
export class MapMode {
  readonly on = signal(false);
  private hint: HTMLElement;
  private off: (() => void)[] = [];

  constructor(private b: Board) {
    this.hint = document.createElement('div');
    this.hint.className = 'm7-maphint';
    this.hint.hidden = true;
    this.hint.setAttribute('role', 'status');
    b.overlay.appendChild(this.hint);

    const midi = b.engine.midi;
    const down = (e: PointerEvent) => {
      if (!this.on.get()) return;
      const t = e.target as HTMLElement;
      const mod = t.closest<HTMLElement>('.m7-mod');
      if (!mod || t.closest('.m7-head, [data-m7-zone="chrome"]')) return; // headers, menus and the canvas behave normally
      e.preventDefault();
      e.stopPropagation();
      const el = t.closest<HTMLElement>('[data-m7-param]');
      if (!el || !mod.contains(el)) return midi.learn(null);
      const address = Params.address(mod.dataset.id!, el.dataset.m7Param!);
      midi.learn(midi.learning.get() === address ? null : address);
    };
    const swallow = (e: Event) => {
      if (this.on.get() && (e.target as HTMLElement).closest('.m7-content')) e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (!this.on.get()) return;
      const target = midi.learning.get();
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (target) midi.learn(null);
        else this.set(false);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && target) {
        e.stopImmediatePropagation();
        e.preventDefault();
        b.run({ action: 'unmap', param: target });
      }
    };
    b.root.addEventListener('pointerdown', down, true);
    b.root.addEventListener('click', swallow, true);
    window.addEventListener('keydown', key, true);
    this.off.push(
      () => b.root.removeEventListener('pointerdown', down, true),
      () => b.root.removeEventListener('click', swallow, true),
      () => window.removeEventListener('keydown', key, true),
      this.on.subscribe(() => this.paint()),
      midi.learning.subscribe(() => this.paint()),
      midi.status.subscribe(() => this.paint()),
      b.store.doc.subscribe((d, p) => d.mappings !== p.mappings && this.paint()),
    );
  }

  set(on: boolean) {
    if (on) {
      this.b.setMode('use');
      if (this.b.engine.midi.status.get() === 'unknown') void this.b.engine.midi.connect();
    } else this.b.engine.midi.learn(null);
    this.on.set(on);
  }

  /** Mark every mappable control with its mapping. Called on changes and after the board re-renders. */
  paint() {
    const b = this.b;
    const on = this.on.get();
    b.root.classList.toggle('is-mapping', on);
    const midi = b.engine.midi;
    const learning = midi.learning.get();
    const mappings = b.store.doc.get().mappings ?? {};
    const byTarget = new Map<string, string[]>();
    for (const [src, target] of Object.entries(mappings)) byTarget.set(target, [...(byTarget.get(target) ?? []), describeSource(src)]);
    for (const [id, s] of b.shells) {
      s.el.querySelectorAll<HTMLElement>('[data-m7-param]').forEach((el) => {
        const address = Params.address(id, el.dataset.m7Param!);
        const labels = byTarget.get(address);
        if (on && labels) el.dataset.m7Mapped = labels.join(', ');
        else delete el.dataset.m7Mapped;
        el.classList.toggle('is-learning', on && learning === address);
      });
    }
    const status = midi.status.get();
    this.hint.hidden = !on;
    this.hint.textContent =
      status === 'none'
        ? 'This browser has no MIDI. Chrome or Edge do. Mappings still save.'
        : status === 'denied'
          ? 'MIDI access was blocked. Allow it in the site settings.'
          : learning
            ? 'Now move a knob, fader or pad on your controller. Delete removes the mapping.'
            : 'Tap a control to map it. Esc when done.';
  }

  destroy() {
    this.off.forEach((f) => f());
    this.hint.remove();
  }
}

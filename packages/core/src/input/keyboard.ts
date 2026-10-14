import type { Board } from '../render/board';
import { place } from '../solver/place';

/**
 * Keyboard: everything a pointer can do to the layout, a key can too.
 * Arrows move the selected module a cell, Shift+arrows resize it.
 */
export class Keyboard {
  private off: () => void;

  constructor(private b: Board) {
    const fn = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', fn);
    this.off = () => window.removeEventListener('keydown', fn);
  }

  destroy() {
    this.off();
  }

  private key(e: KeyboardEvent) {
    const b = this.b;
    const t = e.target as HTMLElement;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
      if (b.gestures.abort()) return;
      if (b.radial.open) return b.radial.close();
      if (b.overlays.menuOpen) return b.overlays.closeMenu();
      if (b.focused.get()) return b.unfocus();
      if (b.mode.get() === 'arrange') return b.setMode('use');
      b.selected.set(null);
      b.hideSlot();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) b.store.redo();
      else b.store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      b.store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd' && b.selected.get()) {
      e.preventDefault();
      b.duplicate(b.selected.get()!);
      return;
    }
    if (mod || e.altKey) return;

    switch (e.key) {
      case '`':
        b.debug.set(!b.debug.get());
        return;
      case 'e':
      case 'E':
        b.setMode(b.mode.get() === 'arrange' ? 'use' : 'arrange');
        return;
      case '[':
      case ']': {
        const d = b.store.doc.get();
        const i = Math.max(0, Math.min(d.layers.length - 1, d.active + (e.key === ']' ? 1 : -1)));
        b.store.silent({ t: 'layer.select', index: i });
        return;
      }
      case '-':
        b.setCamera({ zoom: b.cameraTarget().zoom / 1.25 });
        return;
      case '=':
      case '+':
        b.setCamera({ zoom: b.cameraTarget().zoom * 1.25 });
        return;
      case '0':
        b.tiltTo(0);
        b.setCamera({ zoom: 1 });
        return;
      case 't':
      case 'T':
        b.tiltTo(b.cameraTarget().tilt > 1 ? 0 : 45);
        return;
    }

    const id = b.selected.get();
    if (!id) return;
    const r = b.store.layout()[id];
    if (!r) return;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (d) {
      e.preventDefault();
      b.root.classList.add('is-keyboard');
      const cols = b.metrics.cols;
      const next = e.shiftKey ? { ...r, w: Math.max(1, r.w + d[0]), h: Math.max(1, r.h + d[1]) } : { ...r, x: r.x + d[0], y: r.y + d[1] };
      b.store.dispatch({ t: 'layout', layout: place(b.store.layout(), id, next, cols) });
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      b.remove(id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (b.focused.get() === id) b.unfocus();
      else b.focus(id);
    }
  }
}

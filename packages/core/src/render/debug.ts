import type { Board } from './board';

/**
 * The engine's own inspector, toggled with the ` key. Cell outlines, hit
 * zones, camera, frame time and the selected module's data.
 */
export class Debug {
  private panel: HTMLElement;
  private stop: (() => void) | null = null;

  constructor(private b: Board) {
    this.panel = document.createElement('pre');
    this.panel.className = 'm7-debug-panel';
    this.panel.hidden = true;
    b.overlay.appendChild(this.panel);
    b.debug.subscribe((on) => {
      this.panel.hidden = !on;
      this.stop?.();
      this.stop = on ? b.clock.every(() => this.render()) : null;
      if (on) this.render();
    });
  }

  private last = 0;
  private render() {
    const now = performance.now();
    if (now - this.last < 120) return;
    this.last = now;
    const b = this.b;
    const m = b.metrics;
    const c = b.camera();
    const id = b.selected.get();
    const r = id ? b.store.layout()[id] : null;
    const d = b.store.doc.get();
    this.panel.textContent = [
      `cols ${m.cols}  cell ${m.cell.toFixed(1)}  gap ${m.gap}`,
      `viewport ${b.vp.w}×${b.vp.h}`,
      `camera x ${c.x.toFixed(0)} y ${c.y.toFixed(0)} zoom ${c.zoom.toFixed(2)} tilt ${c.tilt.toFixed(1)}°`,
      `mode ${b.mode.get()}  layer ${d.active + 1}/${d.layers.length}  modules ${Object.keys(b.store.layer.modules).length}`,
      `frame ${b.clock.frameMs.toFixed(1)} ms`,
      id && r ? `selected ${b.store.layer.modules[id]?.type} @ ${r.x},${r.y}  ${r.w}×${r.h}` : 'selected —',
    ].join('\n');
  }
}

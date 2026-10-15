import type { ActionDef } from '../actions/actions';
import type { Engine } from '../engine';
import type { Board } from './board';

/**
 * ⌘K: type any command. The same commands scripts and AI use, so whatever
 * works here works everywhere. `help` lists them.
 */
export class Palette {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private out: HTMLElement;
  private rows: ActionDef<Engine>[] = [];
  private index = 0;
  private history: string[] = [];
  private back = -1;
  private off: () => void;

  constructor(private b: Board) {
    this.el = document.createElement('div');
    this.el.className = 'm7-palette';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="m7-palette-box" role="dialog" aria-label="Command">
        <input class="m7-palette-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Type a command: add knob, set knob 80, tidy, help" aria-label="Command">
        <div class="m7-palette-out" hidden></div>
        <div class="m7-palette-list" role="listbox"></div>
      </div>`;
    b.root.appendChild(this.el);
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('.m7-palette-list')!;
    this.out = this.el.querySelector('.m7-palette-out')!;

    this.input.addEventListener('input', () => {
      this.back = -1;
      this.refresh();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && this.close());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row) this.fill(this.rows[Number(row.dataset.i)]);
    });

    const open = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t?.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.isOpen ? this.close() : this.open();
      } else if (e.key === '/' && !typing && !this.isOpen) {
        e.preventDefault();
        this.open();
      }
    };
    window.addEventListener('keydown', open);
    this.off = () => window.removeEventListener('keydown', open);
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(text = '') {
    this.el.hidden = false;
    this.input.value = text;
    this.out.hidden = true;
    this.refresh();
    this.input.focus({ preventScroll: true });
  }

  close() {
    this.el.hidden = true;
    this.input.blur();
  }

  private refresh() {
    const text = this.input.value;
    const word = text.trim().split(/\s+/).slice(0, 2).join(' ');
    const acts = this.b.engine.actions;
    this.rows = (word ? acts.complete(word) : acts.list()).slice(0, 8);
    if (!this.rows.length && word) this.rows = acts.complete(word.split(' ')[0]).slice(0, 8);
    this.index = Math.min(this.index, Math.max(0, this.rows.length - 1));
    this.list.innerHTML = this.rows
      .map(
        (d, i) =>
          `<div class="m7-palette-row${i === this.index ? ' is-on' : ''}" data-i="${i}" role="option"><code>${esc(acts.usage(d.name))}</code><span>${esc(d.describe)}</span></div>`,
      )
      .join('');
    const types = this.typeHint(text);
    if (types) this.list.insertAdjacentHTML('beforeend', `<div class="m7-palette-note">${esc(types)}</div>`);
  }

  /** After `add `, list the module types; after `set `, the params. */
  private typeHint(text: string) {
    const t = text.trimStart().toLowerCase();
    if (/^add\s+\S*$/.test(t)) return `Types: ${this.b.types.map((d) => d.type).join(', ')}`;
    if (/^(set|learn|unmap)\s+\S*$/.test(t)) {
      const ps = this.b.engine.params.list().map((p) => `${p.module.toLowerCase().replace(/\s+/g, '')}.${p.key}`);
      return ps.length ? `Params: ${[...new Set(ps)].slice(0, 12).join(', ')}` : 'No params on this layer yet';
    }
    return '';
  }

  private fill(d: ActionDef<Engine> | undefined) {
    if (!d) return;
    this.input.value = `${d.name.replace(/\./g, ' ')} `;
    this.input.focus();
    this.refresh();
  }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation(); // keep board shortcuts out of the text field
    if (e.key === 'Escape') return this.close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.key === 'ArrowUp' && (this.input.value === '' || this.back >= 0) && this.history.length) {
        this.back = Math.min(this.history.length - 1, this.back + 1);
        this.input.value = this.history[this.history.length - 1 - this.back];
        return;
      }
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + this.rows.length) % Math.max(1, this.rows.length);
      return this.refresh();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      return this.fill(this.rows[this.index]);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    }
  }

  private async submit() {
    const text = this.input.value.trim();
    if (!text) return this.fill(this.rows[this.index]);
    const r = await this.b.engine.runAsync(text);
    if (!r.ok) {
      this.show(r.error, true);
      return;
    }
    this.history.push(text);
    this.back = -1;
    const v = r.value;
    if (r.action === 'new') return this.close(); // the code editor takes over
    if (v && typeof v === 'object') {
      // Lists (help, list, params) stay up to read.
      this.show(Array.isArray(v) ? v.map(line).join('\n') : JSON.stringify(v, null, 2), false);
      this.input.value = '';
      this.refresh();
      return;
    }
    this.close();
    if (typeof v === 'string' && r.action !== 'add') this.b.overlays.toast(v);
  }

  private show(text: string, error: boolean) {
    this.out.hidden = false;
    this.out.classList.toggle('is-error', error);
    this.out.textContent = text;
  }

  destroy() {
    this.off();
    this.el.remove();
  }
}

const line = (x: unknown) => {
  if (typeof x !== 'object' || !x) return String(x);
  const o = x as Record<string, unknown>;
  if ('address' in o) return `${o.address}  ${o.label} = ${o.text}`;
  if ('id' in o && 'type' in o) return `${o.id}  ${o.title}  ${o.w}×${o.h} at ${o.x},${o.y}`;
  return JSON.stringify(o);
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

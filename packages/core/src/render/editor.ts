import { compileModule } from '../modules/code';
import type { Board } from './board';

/**
 * Live code for custom module types. Type, and every module of that type on
 * the board swaps to the new code as soon as it compiles. If it doesn't, the
 * last good version keeps running and the problem shows here. Each pause in
 * typing is an undo step.
 */
export class CodeEditor {
  private el: HTMLElement;
  private text: HTMLTextAreaElement;
  private status: HTMLElement;
  private name: HTMLElement;
  private type: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private off: (() => void)[] = [];

  constructor(private b: Board) {
    this.el = document.createElement('aside');
    this.el.className = 'm7-editor';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Module code');
    this.el.innerHTML = `
      <header class="m7-editor-head">
        <span class="m7-editor-name"></span>
        <span class="m7-editor-status" role="status"></span>
        <button class="m7-editor-close" aria-label="Close code">Done</button>
      </header>
      <textarea class="m7-editor-text" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Module source code"></textarea>`;
    b.root.appendChild(this.el);
    this.text = this.el.querySelector('textarea')!;
    this.status = this.el.querySelector('.m7-editor-status')!;
    this.name = this.el.querySelector('.m7-editor-name')!;
    this.el.querySelector<HTMLButtonElement>('.m7-editor-close')!.onclick = () => this.close();

    this.text.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.apply(), 450);
    });
    this.text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the board's shortcuts stay out of the code
      if (e.key === 'Escape') return this.close();
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: z, value } = this.text;
        this.text.value = `${value.slice(0, a)}  ${value.slice(z)}`;
        this.text.selectionStart = this.text.selectionEnd = a + 2;
        this.text.dispatchEvent(new Event('input'));
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        clearTimeout(this.timer);
        this.apply();
      }
    });

    this.off.push(
      // Undo, redo or a remote edit changed the code: show it, unless they're mid-typing.
      b.store.doc.subscribe((d, p) => {
        if (!this.type || d.types === p.types || document.activeElement === this.text) return;
        const src = d.types?.[this.type]?.source;
        if (src !== undefined && src !== this.text.value) this.text.value = src;
      }),
      b.engine.code.subscribe(() => this.paintStatus()),
    );
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(type: string) {
    const src = this.b.engine.sourceOf(type);
    if (src === undefined) return;
    this.type = type;
    this.name.textContent = this.b.def(type)?.title ?? type;
    this.text.value = src;
    // Sit on the side away from the module, so you can watch it change as you type.
    // (From the layout, not the DOM: a module added a moment ago hasn't been drawn yet.)
    const mods = this.b.store.layer.modules;
    const sel = this.b.selected.get();
    const id = sel && mods[sel]?.type === type ? sel : Object.keys(mods).find((k) => mods[k].type === type);
    const rect = id ? this.b.store.layout()[id] : undefined;
    if (rect) {
      const p = this.b.px(rect);
      const centre = this.b.toScreen(p.x + p.w / 2, p.y + p.h / 2).x;
      this.el.classList.toggle('is-left', centre > this.b.vp.w / 2);
    }
    this.el.hidden = false;
    this.b.root.classList.add('is-editing');
    this.paintStatus();
    this.text.focus({ preventScroll: true });
  }

  close() {
    clearTimeout(this.timer);
    if (this.type && this.text.value !== this.b.engine.sourceOf(this.type)) this.apply();
    this.el.hidden = true;
    this.b.root.classList.remove('is-editing');
    this.type = null;
  }

  private async apply() {
    const type = this.type;
    if (!type) return;
    const src = this.text.value;
    if (src === this.b.engine.sourceOf(type)) return;
    try {
      compileModule(src, type); // check first; the board keeps the last good version
    } catch (e) {
      return this.paintStatus((e as Error).message);
    }
    try {
      await this.b.engine.defineType(type, src);
      this.name.textContent = this.b.def(type)?.title ?? type;
    } catch (e) {
      this.paintStatus((e as Error).message);
    }
  }

  private paintStatus(error?: string) {
    if (!this.type) return;
    const s = this.b.engine.code.get()[this.type];
    const msg = error ?? (s?.state === 'error' ? s.error : '');
    this.status.textContent = msg || 'Running';
    this.status.classList.toggle('is-error', !!msg);
    this.status.title = msg;
  }

  destroy() {
    clearTimeout(this.timer);
    this.off.forEach((f) => f());
    this.el.remove();
  }
}

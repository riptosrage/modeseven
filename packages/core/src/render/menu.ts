import type { MenuItem } from '../modules/types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Quiet popover menu (the ⋯ menu) and a toast with an optional action. */
export class Overlays {
  private menuEl: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;

  constructor(private host: HTMLElement) {
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.menuEl && !(e.target as HTMLElement).closest('.m7-menu, [data-m7-act="menu"]')) this.closeMenu();
      },
      true,
    );
  }

  get menuOpen() {
    return !!this.menuEl;
  }

  menu(anchor: DOMRect, items: MenuItem[]) {
    this.closeMenu();
    const m = document.createElement('div');
    m.className = 'm7-menu';
    m.setAttribute('role', 'menu');
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.setAttribute('role', 'menuitem');
      if (it.danger) b.classList.add('is-danger');
      b.onclick = () => {
        this.closeMenu();
        it.run();
      };
      m.appendChild(b);
    }
    this.host.appendChild(m);
    m.style.left = `${clamp(anchor.right - m.offsetWidth, 8, innerWidth - m.offsetWidth - 8)}px`;
    m.style.top = `${clamp(anchor.bottom + 4, 8, innerHeight - m.offsetHeight - 8)}px`;
    this.menuEl = m;
    m.querySelector('button')?.focus({ preventScroll: true });
  }

  closeMenu() {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  toast(text: string, action?: { label: string; run(): void }) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'm7-toast';
      this.toastEl.setAttribute('role', 'status');
      this.host.appendChild(this.toastEl);
    }
    const t = this.toastEl;
    t.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    t.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => {
        t.hidden = true;
        action.run();
      };
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), action ? 4000 : 2400);
  }
}

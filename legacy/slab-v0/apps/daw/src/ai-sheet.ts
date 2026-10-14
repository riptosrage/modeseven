import type { ModuleInstance, Surface } from '@slab/core';
import { escapeHtml } from '@slab/core';

const NEW_IDEAS = ['chop that sample into four', 'one big fader for vox', 'a mixer for the drums'];
const EDIT_IDEAS = ['make it darker', 'add a swing knob', 'show it as a list'];

let sheet: HTMLElement | null = null;

export function closeSheet() {
  sheet?.remove();
  sheet = null;
}

/** Prompt UI for "Ask AI". Mocked: the result is a canned module. */
export function openAiSheet(surface: Surface, target: ModuleInstance, mode: 'new' | 'edit') {
  closeSheet();
  const el = surface.grid.querySelector<HTMLElement>(`[data-id="${target.id}"]`);
  const r = el?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0);
  const isNew = mode === 'new';
  const name = target.title ?? surface.def(target.type)?.title ?? target.type;

  sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<span class="k">${isNew ? 'New module' : `Prompt · ${escapeHtml(name)}`}</span>
    <h3>${isNew ? 'What should it do?' : 'What should change?'}</h3>
    <textarea id="ai-prompt" placeholder="${isNew ? NEW_IDEAS[0] : EDIT_IDEAS[0]}"></textarea>
    <div class="chips">${(isNew ? NEW_IDEAS : EDIT_IDEAS).map((c) => `<button>${c}</button>`).join('')}</div>
    <div class="acts"><button class="no">Cancel</button><button class="go">${isNew ? 'Build' : 'Apply'}</button></div>`;
  document.body.appendChild(sheet);

  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  sheet.style.left = `${Math.max(16, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 16))}px`;
  sheet.style.top = `${Math.max(16, Math.min(r.top + Math.min(40, r.height / 4), innerHeight - h - 16))}px`;

  const ta = sheet.querySelector('textarea')!;
  setTimeout(() => ta.focus(), 0);
  sheet.querySelectorAll<HTMLButtonElement>('.chips button').forEach((b) => (b.onclick = () => ((ta.value = b.textContent ?? ''), ta.focus())));
  sheet.querySelector<HTMLButtonElement>('.no')!.onclick = closeSheet;

  const go = () => {
    const prompt = ta.value.trim() || ta.placeholder;
    closeSheet();
    if (isNew) surface.replace(target.id, 'building', { props: { prompt } });
    else
      surface.replace(target.id, 'building', {
        w: target.w,
        h: target.h,
        props: { prompt, restore: { type: target.type, title: target.title, w: target.w, h: target.h } },
      });
  };
  sheet.querySelector<HTMLButtonElement>('.go')!.onclick = go;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      go();
    }
    if (e.key === 'Escape') closeSheet();
  });
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (sheet && !(e.target as HTMLElement).closest('.sheet')) closeSheet();
  },
  true,
);

import { defineModule } from '@slab/core';
import { cycleInput, onChange, onFrame, state, toggleRec } from '../store';

export const record = defineModule({
  type: 'record',
  title: 'Record',
  size: [2, 2],
  mount(body) {
    body.innerHTML = `<div class="rec">
      <button class="rec-btn" aria-label="Record"><i></i></button>
      <div class="rec-meta"><div class="rec-time">00:00.0</div><button class="rec-in"></button><div class="meter"><b></b></div></div>
    </div>`;
    const btn = body.querySelector<HTMLButtonElement>('.rec-btn')!;
    const time = body.querySelector<HTMLElement>('.rec-time')!;
    const input = body.querySelector<HTMLButtonElement>('.rec-in')!;
    const meter = body.querySelector<HTMLElement>('.meter b')!;
    btn.onclick = toggleRec;
    input.onclick = cycleInput;

    const sync = () => {
      btn.classList.toggle('on', state.rec);
      btn.setAttribute('aria-label', state.rec ? 'Stop recording' : 'Record');
      input.textContent = state.inputs[state.input];
    };
    sync();

    const offChange = onChange(sync);
    const offFrame = onFrame((now) => {
      const el = state.rec ? (now - state.recT0) / 1000 : 0;
      time.textContent = `${String(Math.floor(el / 60)).padStart(2, '0')}:${(el % 60).toFixed(1).padStart(4, '0')}`;
      meter.style.width = `${state.level * 100}%`;
    });
    return () => {
      offChange();
      offFrame();
    };
  },
});

/**
 * Shared DAW state. Fake for now: the transport runs a clock and records
 * "takes" as time ranges, but no audio is captured yet.
 * Modules subscribe on mount and unsubscribe in their cleanup.
 */
export const BPM = 92;
export const BARS = 8;
export const LOOP_SECONDS = (BARS * 4 * 60) / BPM;

export const state = {
  playing: false,
  /** Loop position, 0..1 */
  p: 0,
  t0: 0,
  rec: false,
  recStart: 0,
  recT0: 0,
  takes: [] as [number, number][],
  level: 0,
  mix: [0.78, 0.66, 0.84, 0.6, 0.88],
  inputs: ['Input 1 · Mic', 'Input 2 · Line', 'Browser tab', 'Resample master'],
  input: 0,
};

type Fn = () => void;
type FrameFn = (now: number) => void;
const changeSubs = new Set<Fn>();
const frameSubs = new Set<FrameFn>();

export function onChange(f: Fn) {
  changeSubs.add(f);
  return () => void changeSubs.delete(f);
}
export function onFrame(f: FrameFn) {
  frameSubs.add(f);
  return () => void frameSubs.delete(f);
}
export function emit() {
  changeSubs.forEach((f) => f());
}

export function togglePlay() {
  if (state.playing) {
    if (state.rec) toggleRec();
    state.playing = false;
  } else {
    state.playing = true;
    state.t0 = performance.now() - state.p * LOOP_SECONDS * 1000;
  }
  emit();
}

export function toggleRec() {
  if (!state.rec) {
    if (!state.playing) togglePlay();
    state.rec = true;
    state.recStart = state.p;
    state.recT0 = performance.now();
  } else {
    if (state.p > state.recStart + 0.005) state.takes.push([state.recStart, state.p]);
    state.rec = false;
  }
  emit();
}

export function setMix(ch: number, v: number) {
  state.mix[ch] = v;
  emit();
}

export function cycleInput() {
  state.input = (state.input + 1) % state.inputs.length;
  emit();
}

export const dB = (v: number) => (v < 0.02 ? '−∞' : (v >= 0.75 ? '+' : '') + (Math.log10(v / 0.75) * 40).toFixed(1));

export function position(p: number) {
  const beat = p * BARS * 4;
  return `${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}.${Math.floor((beat % 1) * 4) + 1}`;
}

let target = 0;
let nextTarget = 0;
function tick(now: number) {
  if (state.playing) {
    const p = ((now - state.t0) / 1000 / LOOP_SECONDS) % 1;
    if (state.rec && p < state.p) {
      state.takes.push([state.recStart, 1]);
      state.recStart = 0;
      state.p = p;
      emit();
    }
    state.p = p;
  }
  if (now > nextTarget) {
    target = (state.rec ? 0.55 : 0.22) + Math.random() * (state.rec ? 0.4 : 0.25);
    nextTarget = now + 70 + Math.random() * 60;
  }
  state.level += (target - state.level) * 0.25;
  frameSubs.forEach((f) => f(now));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

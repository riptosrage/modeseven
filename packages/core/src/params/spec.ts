import type { ParamValue } from '../store/doc';

/**
 * Parameters: every control a module exposes, described once.
 *
 * A module declares `params: { cutoff: param.number(20, 20000, 800, { unit: 'Hz', curve: 'exp' }) }`
 * and from then on MIDI, automation, presets, the phone remote and AI can all
 * read and set it by address (`moduleId.cutoff`) without knowing the module.
 *
 * Pure maths, no DOM. Normal values are always 0..1, which is what
 * controllers, sliders and automation lanes speak.
 */

interface Base {
  /** Human name. Defaults to the key. */
  label?: string;
}

export interface NumberParam extends Base {
  kind: 'number';
  min: number;
  max: number;
  default: number;
  /** Snap to multiples of this (from min). */
  step?: number;
  unit?: string;
  /** 'exp' for frequencies and times: equal knob travel = equal ratio. Needs min > 0. */
  curve?: 'linear' | 'exp';
  /** Custom display, e.g. note names. */
  format?: (v: number) => string;
}

export interface ToggleParam extends Base {
  kind: 'toggle';
  default: boolean;
}

export interface ChoiceParam extends Base {
  kind: 'choice';
  options: readonly string[];
  default: string;
}

export type ParamSpec = NumberParam | ToggleParam | ChoiceParam;

/** Builders, so a module's param list reads like a spec sheet. */
export const param = {
  number: (min: number, max: number, def: number, o: Omit<NumberParam, 'kind' | 'min' | 'max' | 'default'> = {}): NumberParam => ({
    kind: 'number',
    min,
    max,
    default: def,
    ...o,
  }),
  toggle: (def = false, o: Base = {}): ToggleParam => ({ kind: 'toggle', default: def, ...o }),
  choice: (options: readonly string[], def = options[0], o: Base = {}): ChoiceParam => ({ kind: 'choice', options, default: def, ...o }),
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Coerce anything (a typed "80", a MIDI float, a stale saved value) into a valid value for this spec. */
export function coerce(spec: ParamSpec, v: unknown): ParamValue {
  switch (spec.kind) {
    case 'number': {
      let n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? spec.max : spec.min) : parseFloat(String(v));
      if (!Number.isFinite(n)) return spec.default;
      n = Math.min(spec.max, Math.max(spec.min, n));
      if (spec.step) n = spec.min + Math.round((n - spec.min) / spec.step) * spec.step;
      // Kill float dust (0.30000000000000004) so values compare and save cleanly.
      return Math.min(spec.max, Math.max(spec.min, +n.toPrecision(12)));
    }
    case 'toggle':
      if (typeof v === 'string') return /^(1|true|on|yes)$/i.test(v.trim());
      return typeof v === 'number' ? v >= 0.5 : Boolean(v);
    case 'choice': {
      if (typeof v === 'number' && Number.isInteger(v) && spec.options[v] !== undefined) return spec.options[v];
      const s = String(v).toLowerCase();
      return spec.options.find((o) => o.toLowerCase() === s) ?? spec.default;
    }
  }
}

/** Value → 0..1. */
export function toNormal(spec: ParamSpec, v: ParamValue): number {
  switch (spec.kind) {
    case 'number': {
      const n = Number(v);
      if (spec.max === spec.min) return 0;
      if (spec.curve === 'exp' && spec.min > 0) return clamp01(Math.log(n / spec.min) / Math.log(spec.max / spec.min));
      return clamp01((n - spec.min) / (spec.max - spec.min));
    }
    case 'toggle':
      return v ? 1 : 0;
    case 'choice': {
      const i = Math.max(0, spec.options.indexOf(String(v)));
      return spec.options.length > 1 ? i / (spec.options.length - 1) : 0;
    }
  }
}

/** 0..1 → value. */
export function fromNormal(spec: ParamSpec, n: number): ParamValue {
  const t = clamp01(n);
  switch (spec.kind) {
    case 'number':
      if (spec.curve === 'exp' && spec.min > 0) return coerce(spec, spec.min * Math.pow(spec.max / spec.min, t));
      return coerce(spec, spec.min + t * (spec.max - spec.min));
    case 'toggle':
      return t >= 0.5;
    case 'choice':
      return spec.options[Math.round(t * (spec.options.length - 1))] ?? spec.default;
  }
}

/** Display string: "800 Hz", "2.4 kHz", "75%", "On", "Saw". */
export function format(spec: ParamSpec, v: ParamValue): string {
  switch (spec.kind) {
    case 'toggle':
      return v ? 'On' : 'Off';
    case 'choice':
      return String(v);
    case 'number': {
      const n = Number(v);
      if (spec.format) return spec.format(n);
      let unit = spec.unit ?? '';
      let shown = n;
      if (unit === 'Hz' && Math.abs(n) >= 1000) (shown = n / 1000), (unit = 'kHz');
      if (unit === 'ms' && Math.abs(n) >= 1000) (shown = n / 1000), (unit = 's');
      const scaled = unit !== (spec.unit ?? '');
      const decimals = spec.step && !scaled ? decimalsOf(spec.step) : scaled ? (Math.abs(shown) >= 100 ? 0 : 1) : decimalsFor(spec.max - spec.min);
      const text = scaled ? shown.toFixed(decimals).replace(/\.0$/, '') : shown.toFixed(decimals); // 2 kHz, not 2.0 kHz
      return unit === '%' || unit === '' ? `${text}${unit}` : `${text} ${unit}`;
    }
  }
}

export const defaultOf = (spec: ParamSpec): ParamValue => spec.default;

const decimalsOf = (step: number) => {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};
const decimalsFor = (range: number) => {
  const r = Math.abs(range);
  return r >= 100 ? 0 : r >= 10 ? 1 : 2;
};

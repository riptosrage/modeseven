import { type Signal, signal } from '../store/signal';
import type { Store } from '../store/store';
import type { Params } from '../params/registry';

/**
 * MIDI in, mapped to params.
 *
 * Messages can come from anywhere: Web MIDI (Chrome, Edge), a native bridge
 * in the Mac app later, the phone acting as a controller, or a test. Call
 * `inject()` with raw bytes and the rest is the same. Mappings live in the
 * doc, so they save with the board and undo like any other change.
 */

export interface MidiMessage {
  /** Stable name for what was touched: `cc:1:74`, `note:10:36`, `bend:1`. */
  control: string;
  /** 0..1 */
  value: number;
  kind: 'cc' | 'note' | 'bend';
  /** True for note-on (and every cc/bend). False for note-off. */
  on: boolean;
}

/** Raw MIDI bytes → message, or null for things we don't map (clock, sysex…). Pure. */
export function parseMidi(data: ArrayLike<number>): MidiMessage | null {
  const status = data[0] ?? 0;
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  switch (type) {
    case 0xb0:
      return { control: `cc:${ch}:${d1}`, value: d2 / 127, kind: 'cc', on: true };
    case 0x90:
      return { control: `note:${ch}:${d1}`, value: d2 / 127, kind: 'note', on: d2 > 0 };
    case 0x80:
      return { control: `note:${ch}:${d1}`, value: 0, kind: 'note', on: false };
    case 0xe0:
      return { control: `bend:${ch}`, value: ((d2 << 7) | d1) / 16383, kind: 'bend', on: true };
    default:
      return null;
  }
}

/** `midi:cc:1:74` → `CC 74` (channel shown when it isn't 1). For labels. */
export function describeSource(source: string): string {
  const [, kind, ch, n] = source.split(':');
  const chan = ch && ch !== '1' ? ` · ch ${ch}` : '';
  if (kind === 'cc') return `CC ${n}${chan}`;
  if (kind === 'note') return `${noteName(Number(n))}${chan}`;
  if (kind === 'bend') return `Bend${chan}`;
  return source;
}

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (n: number) => `${NOTES[n % 12]}${Math.floor(n / 12) - 1}`;

type MIDIAccessLike = { inputs: Map<string, { name?: string | null; onmidimessage: ((e: { data: Uint8Array | null }) => void) | null }>; onstatechange: (() => void) | null };

export class Midi {
  /** 'unknown' until `connect()`; 'none' where the browser has no Web MIDI (Safari). */
  readonly status: Signal<'unknown' | 'ready' | 'none' | 'denied'> = signal('unknown');
  readonly devices: Signal<string[]> = signal([]);
  /** The param address waiting for a control to be moved, or null. */
  readonly learning: Signal<string | null> = signal(null);
  /** The last message, for activity lights. */
  readonly last: Signal<MidiMessage | null> = signal(null);

  constructor(
    private store: Store,
    private params: Params,
  ) {}

  /** Ask for Web MIDI. Resolves true when connected. Safe to call more than once. */
  async connect(): Promise<boolean> {
    const nav = globalThis.navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccessLike> };
    if (!nav?.requestMIDIAccess) {
      this.status.set('none');
      return false;
    }
    try {
      const access = await nav.requestMIDIAccess();
      const bind = () => {
        const names: string[] = [];
        access.inputs.forEach((input) => {
          names.push(input.name ?? 'MIDI device');
          input.onmidimessage = (e) => e.data && this.inject(e.data);
        });
        this.devices.set(names);
      };
      bind();
      access.onstatechange = bind;
      this.status.set('ready');
      return true;
    } catch {
      this.status.set('denied');
      return false;
    }
  }

  /** Wait for the next control moved, and map it to this param. Pass null to stop waiting. */
  learn(address: string | null) {
    this.learning.set(address);
  }

  /** Feed a message in: raw bytes, or an already-parsed message. */
  inject(input: ArrayLike<number> | MidiMessage) {
    const msg = 'control' in input ? input : parseMidi(input);
    if (!msg) return;
    this.last.set(msg);
    const source = `midi:${msg.control}`;

    const target = this.learning.get();
    if (target) {
      if (!msg.on) return; // learn on press, not release
      this.store.dispatch({ t: 'map', source, target });
      this.learning.set(null);
      return;
    }

    const address = this.store.doc.get().mappings?.[source];
    if (!address) return;
    const spec = this.params.spec(address);
    if (!spec) return;
    const o = { coalesce: source, origin: 'midi' };
    if (spec.kind === 'toggle' && msg.kind === 'note') {
      // A pad press flips a toggle; release does nothing.
      if (msg.on) this.params.set(address, !this.params.get(address), o);
    } else if (msg.kind === 'note' && !msg.on) {
      return;
    } else {
      this.params.setNormal(address, msg.value, o);
    }
  }

  /** Sources mapped to a param. */
  sourcesFor(address: string): string[] {
    const m = this.store.doc.get().mappings ?? {};
    return Object.keys(m).filter((s) => m[s] === address);
  }
}


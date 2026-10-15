/**
 * Actions: the one language for driving Mode 7.
 *
 * Every verb (add, move, set, tidy, focus…) is declared once with typed args.
 * The same declaration then serves:
 *   - text:    run('add knob at 3,2')            (⌘K palette, scripts, chat)
 *   - objects: run({ action: 'add', type: 'knob', at: [3, 2] })   (code, AI tool calls)
 *   - schemas: tools()                           (hand to an LLM as tool definitions)
 *   - help:    usage('add') → 'add <type> [at x,y] [size w×h]'
 *
 * Pure TypeScript. The registry knows nothing about boards; arg values are
 * resolved by the host (the Engine) through `resolve`.
 */

export type ArgType =
  /** Free text. As the last arg, it soaks up the rest of the line. */
  | 'text'
  | 'number'
  /** A cell, written `3,2`. */
  | 'cell'
  /** A size, written `2x2` or `2×2`. */
  | 'size'
  /** A module: its id, title or type. */
  | 'module'
  /** A module type that can be added. */
  | 'type'
  /** A parameter address: `module.key`, where module is an id, title or type. */
  | 'param'
  /** A number, on/off, or a word. */
  | 'value'
  | 'choice';

export interface ArgSpec {
  name: string;
  type: ArgType;
  optional?: boolean;
  /** Introduces the arg in text: `at 3,2`, `to 4x2`. Without one, the arg is positional. */
  keyword?: string;
  options?: readonly string[];
  describe?: string;
}

export interface ActionDef<C = unknown> {
  /** Dotted for groups: `layer.add` (typed as `layer add`). */
  name: string;
  describe: string;
  args?: ArgSpec[];
  run(args: Record<string, any>, ctx: C): unknown;
}

export type ActionInput = string | ({ action: string } & Record<string, unknown>);

export type ActionResult = { ok: true; action: string; value?: unknown } | { ok: false; error: string; action?: string };

export interface Parsed {
  name: string;
  raw: Record<string, unknown>;
}

/** Turns a raw arg (string from text, or anything from an object call) into a typed value, or throws a friendly Error. */
export type Resolver = (type: ArgType, raw: unknown, spec: ArgSpec) => unknown;

export class Actions<C = unknown> {
  private defs = new Map<string, ActionDef<C>>();

  constructor(
    private ctx: C,
    private resolve: Resolver = (_t, raw) => raw,
  ) {}

  register(...defs: ActionDef<C>[]) {
    for (const d of defs) this.defs.set(d.name, d);
    return this;
  }

  get(name: string) {
    return this.defs.get(name);
  }

  list(): ActionDef<C>[] {
    return [...this.defs.values()];
  }

  /** `add <type> [at x,y] [size w×h]` */
  usage(name: string): string {
    const d = this.defs.get(name);
    if (!d) return name;
    const parts = (d.args ?? []).map((a) => {
      const body = `${a.keyword ? `${a.keyword} ` : ''}${hint(a)}`;
      return a.optional ? `[${body}]` : body;
    });
    return [d.name.replace(/\./g, ' '), ...parts].join(' ');
  }

  /** Run an action from text or an object. Never throws: errors come back as `{ ok: false, error }`. */
  run(input: ActionInput): ActionResult {
    let parsed: Parsed;
    try {
      parsed = typeof input === 'string' ? this.parse(input) : this.fromObject(input);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const d = this.defs.get(parsed.name)!;
    try {
      const args: Record<string, unknown> = {};
      for (const a of d.args ?? []) {
        const raw = parsed.raw[a.name];
        if (raw === undefined || raw === '') {
          if (!a.optional) throw new Error(`${d.name.replace(/\./g, ' ')} needs ${hint(a)}. Usage: ${this.usage(d.name)}`);
          continue;
        }
        args[a.name] = a.type === 'choice' ? choice(a, raw) : this.resolve(a.type, raw, a);
      }
      return { ok: true, action: d.name, value: d.run(args, this.ctx) };
    } catch (e) {
      return { ok: false, action: d.name, error: (e as Error).message };
    }
  }

  /** Like `run`, but waits for actions that take time (compiling code, loading) and reports their errors too. */
  async runAsync(input: ActionInput): Promise<ActionResult> {
    const r = this.run(input);
    if (!r.ok || !(r.value instanceof Promise)) return r;
    try {
      return { ok: true, action: r.action, value: await r.value };
    } catch (e) {
      return { ok: false, action: r.action, error: (e as Error).message };
    }
  }

  /** Text → action name + raw arg strings. */
  parse(text: string): Parsed {
    const tokens = tokenize(text);
    if (!tokens.length) throw new Error('Type a command, like: add knob');
    // Longest action name first, so `layer add` beats `layer`.
    let d: ActionDef<C> | undefined;
    let used = 0;
    for (let n = Math.min(3, tokens.length); n > 0 && !d; n--) {
      const name = tokens.slice(0, n).join('.').toLowerCase();
      d = this.defs.get(name);
      if (d) used = n;
    }
    if (!d) throw new Error(`No command called “${tokens[0]}”. ${this.suggest(tokens[0])}`);
    const args = d.args ?? [];
    const raw: Record<string, unknown> = {};
    const rest = tokens.slice(used);
    const keyed = new Map(args.filter((a) => a.keyword).map((a) => [a.keyword!.toLowerCase(), a]));
    const positional = args.filter((a) => !a.keyword);
    let pos = 0;
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      const kw = keyed.get(tok.toLowerCase());
      if (kw && i + 1 < rest.length) {
        if (kw.type === 'text') {
          // Text runs until the next keyword: `add note as My plan at 3,2`.
          const end = rest.findIndex((t, j) => j > i + 1 && keyed.has(t.toLowerCase()));
          raw[kw.name] = rest.slice(i + 1, end < 0 ? undefined : end).join(' ');
          if (end < 0) break;
          i = end - 1;
          continue;
        }
        raw[kw.name] = rest[i + 1];
        i++;
        continue;
      }
      // Filler words read naturally ("set knob to 80") and mean nothing.
      if (FILLER.has(tok.toLowerCase()) && !kw && positional[pos]?.type !== 'text') continue;
      // Out of positional slots? Fill the next keyword arg, so `move knob 4,0` works without `to`.
      const a = positional[pos++] ?? args.find((x) => x.keyword && raw[x.name] === undefined);
      if (!a) throw new Error(`Didn't expect “${tok}”. Usage: ${this.usage(d.name)}`);
      if (a.type === 'text' && pos === positional.length) {
        // Last text arg soaks up the rest (stopping at a keyword).
        const end = rest.findIndex((t, j) => j > i && keyed.has(t.toLowerCase()));
        raw[a.name] = rest.slice(i, end < 0 ? undefined : end).join(' ');
        if (end < 0) break;
        i = end - 1;
        continue;
      }
      raw[a.name] = tok;
    }
    return { name: d.name, raw };
  }

  /**
   * Tool definitions for an LLM (JSON Schema). Hand these to a model and
   * pipe its tool calls straight into `run({ action, ...input })`.
   */
  tools() {
    return this.list().map((d) => ({
      name: d.name.replace(/\./g, '_'),
      description: `${d.describe} Usage: ${this.usage(d.name)}`,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries((d.args ?? []).map((a) => [a.name, schemaOf(a)])),
        required: (d.args ?? []).filter((a) => !a.optional).map((a) => a.name),
      },
    }));
  }

  /** Commands whose name starts with what's typed, for autocomplete. */
  complete(prefix: string): ActionDef<C>[] {
    const p = prefix.trim().toLowerCase().replace(/\s+/g, '.');
    return this.list().filter((d) => d.name.startsWith(p) || (p.startsWith(d.name) && p.length > d.name.length));
  }

  private fromObject(o: { action: string } & Record<string, unknown>): Parsed {
    const name = String(o.action).replace(/[_\s]+/g, '.');
    if (!this.defs.has(name)) throw new Error(`No command called “${o.action}”. ${this.suggest(o.action)}`);
    const { action: _, ...raw } = o;
    return { name, raw };
  }

  private suggest(word: string) {
    const w = word.toLowerCase();
    const near = this.list().find((d) => d.name.startsWith(w.slice(0, 2)));
    return near ? `Did you mean “${near.name.replace(/\./g, ' ')}”?` : `Try: ${this.list().slice(0, 4).map((d) => d.name.replace(/\./g, ' ')).join(', ')}`;
  }
}

/* ------------------------------------------------------------------ */

const FILLER = new Set(['to', '=', 'the']);

/** Split on spaces, keeping "quoted strings" together (also inside a word: `"low pass".cutoff`). */
export function tokenize(text: string): string[] {
  return (text.match(/(?:"[^"]*"|'[^']*'|[^\s"']+|["'])+/g) ?? []).map((t) => t.replace(/"([^"]*)"|'([^']*)'/g, '$1$2'));
}

/** `3,2` / `(3, 2)` / [3, 2] / {x, y} → {x, y} */
export function parseCell(raw: unknown): { x: number; y: number } {
  if (Array.isArray(raw)) return check({ x: Number(raw[0]), y: Number(raw[1]) }, raw);
  if (raw && typeof raw === 'object') return check({ x: Number((raw as any).x), y: Number((raw as any).y) }, raw);
  const m = /^\(?\s*(-?\d+)\s*[, ]\s*(-?\d+)\s*\)?$/.exec(String(raw).trim());
  if (!m) throw new Error(`“${raw}” isn't a cell. Write it like 3,2`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** `2x2` / `2×2` / [2, 2] / {w, h} → {w, h} */
export function parseSize(raw: unknown): { w: number; h: number } {
  const ok = (s: { w: number; h: number }) => {
    if (!(s.w >= 1 && s.h >= 1 && Number.isInteger(s.w) && Number.isInteger(s.h))) throw new Error(`“${JSON.stringify(raw)}” isn't a size. Write it like 2x2`);
    return s;
  };
  if (Array.isArray(raw)) return ok({ w: Number(raw[0]), h: Number(raw[1]) });
  if (raw && typeof raw === 'object') return ok({ w: Number((raw as any).w), h: Number((raw as any).h) });
  const m = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(String(raw).trim());
  if (!m) throw new Error(`“${raw}” isn't a size. Write it like 2x2`);
  return ok({ w: Number(m[1]), h: Number(m[2]) });
}

const check = (c: { x: number; y: number }, raw: unknown) => {
  if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) throw new Error(`“${JSON.stringify(raw)}” isn't a cell. Write it like 3,2`);
  return c;
};

const choice = (a: ArgSpec, raw: unknown) => {
  const s = String(raw).toLowerCase();
  const hit = a.options?.find((o) => o.toLowerCase() === s);
  if (!hit) throw new Error(`${a.name} is one of: ${a.options?.join(', ')}`);
  return hit;
};

const hint = (a: ArgSpec) =>
  ({ cell: 'x,y', size: 'w×h', text: `<${a.name}>`, number: `<${a.name}>`, module: '<module>', type: '<type>', param: '<module.param>', value: '<value>', choice: a.options?.join('|') ?? a.name })[a.type];

function schemaOf(a: ArgSpec): Record<string, unknown> {
  const describe = a.describe ? { description: a.describe } : {};
  switch (a.type) {
    case 'number':
      return { type: 'number', ...describe };
    case 'cell':
      return { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: a.describe ?? 'Grid cell [x, y], 0-based from the top left.' };
    case 'size':
      return { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 2, maxItems: 2, description: a.describe ?? 'Size in cells [w, h].' };
    case 'choice':
      return { type: 'string', enum: a.options, ...describe };
    case 'value':
      return { type: ['number', 'string', 'boolean'], ...describe };
    case 'module':
      return { type: 'string', description: a.describe ?? 'Module id, title or type.' };
    case 'param':
      return { type: 'string', description: a.describe ?? 'Parameter address "module.key", e.g. "knob.value".' };
    case 'type':
      return { type: 'string', description: a.describe ?? 'Module type to add.' };
    default:
      return { type: 'string', ...describe };
  }
}

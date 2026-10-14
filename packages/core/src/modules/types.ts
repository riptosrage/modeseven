import type { Signal } from '../store/signal';
import type { ModuleRecord } from '../store/doc';
import type { SizeClass } from '../solver/metrics';
import type { Board } from '../render/board';

export interface ModuleSize {
  /** Position and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  cls: SizeClass;
  /** True while shown full screen. */
  focused: boolean;
}

export type Mode = 'use' | 'arrange';

export interface ModuleContext {
  readonly id: string;
  readonly board: Board;
  /** Cell size and size class. Updates live during resize previews. */
  readonly size: Signal<ModuleSize>;
  /** The saved record: title and props. */
  readonly record: Signal<ModuleRecord>;
  /** Use or Arrange. In Arrange the module's content gets no input. */
  readonly mode: Signal<Mode>;
  /** True while the module is being dragged or resized. Pause expensive work. */
  readonly held: Signal<boolean>;
  /** Slot in the header for small buttons or readouts. */
  readonly header: HTMLElement;
  setProps(patch: Record<string, unknown>): void;
  setTitle(title: string): void;
}

export interface ModuleDef {
  type: string;
  title: string;
  /** Inline SVG for menus. */
  icon?: string;
  /** Default size in cells. */
  size: [number, number];
  minSize?: [number, number];
  maxSize?: [number, number];
  /** Build into `el`. Return a cleanup function. */
  mount(el: HTMLElement, ctx: ModuleContext): void | (() => void);
}

/** Identity helper for type checking module files. */
export const defineModule = (def: ModuleDef) => def;

export interface RadialNode {
  key: string;
  label: string;
  icon: string;
  children?: RadialNode[];
}

export interface MenuItem {
  label: string;
  danger?: boolean;
  run(): void;
}

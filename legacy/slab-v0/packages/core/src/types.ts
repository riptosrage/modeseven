import type { Surface } from './surface';

/** One placed module on a layer. Plain data so it can be saved, loaded and shared as a template. */
export interface ModuleInstance {
  id: string;
  /** Matches a registered ModuleDef.type, or "empty" for an open slot. */
  type: string;
  /** Width and height in grid cells. */
  w: number;
  h: number;
  title?: string;
  /** Module-owned data. Anything JSON-serializable. */
  props?: Record<string, unknown>;
  /** Bump to force a remount without changing type. */
  rev?: number;
}

export interface Layer {
  id: string;
  name: string;
  items: ModuleInstance[];
}

export interface ModuleContext {
  instance: ModuleInstance;
  surface: Surface;
  /** Slot in the module header for buttons or readouts. */
  header: HTMLElement;
  body: HTMLElement;
  /** Fires whenever the module body changes size (resize, zoom, full screen). */
  onResize(cb: (rect: DOMRectReadOnly) => void): void;
  setTitle(title: string): void;
  /** Merge into instance.props and save. Does not remount. */
  setProps(patch: Record<string, unknown>): void;
}

export interface ModuleDef {
  type: string;
  title: string;
  /** Default size in cells [w, h]. */
  size: [number, number];
  minSize?: [number, number];
  maxSize?: [number, number];
  resizable?: boolean;
  /**
   * Build the module into `body`. Return a cleanup function to run when the
   * module is removed, replaced or remounted.
   */
  mount(body: HTMLElement, ctx: ModuleContext): void | (() => void);
}

/** A node in the radial add menu. Nodes with children open a second ring. */
export interface RadialNode {
  key: string;
  label: string;
  /** Inline SVG markup. */
  icon: string;
  children?: RadialNode[];
}

export interface MenuItem {
  label: string;
  danger?: boolean;
  run(): void;
}

export interface SurfaceOptions {
  root: HTMLElement;
  modules: ModuleDef[];
  addMenu: RadialNode[];
  /** Starting layers when nothing is saved. */
  layers?: Layer[];
  /** localStorage key. Omit to disable saving. */
  storageKey?: string;
  /** Columns on wide screens. Narrow screens (<720px) use 2. Default 4. */
  columns?: number;
  /** How many rows fit the viewport at 100% zoom on wide screens. Default 4. */
  visibleRows?: number;
  /** Keep at least this many open slots on each layer. Default 2. */
  minEmpty?: number;
  /**
   * Called when a radial node is picked. Return true if you handled it
   * (e.g. opened your own prompt UI). Otherwise, if the key names a module
   * type, the slot becomes that module.
   */
  onAddAction?(key: string, slot: ModuleInstance, surface: Surface): boolean | void;
  /** Extra items at the top of each module's ⋯ menu. */
  moduleMenu?(instance: ModuleInstance, surface: Surface): MenuItem[];
}

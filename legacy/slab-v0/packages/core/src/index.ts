import { Surface } from './surface';
import type { ModuleDef, SurfaceOptions } from './types';

export { Surface, EMPTY, instance, newId, escapeHtml } from './surface';
export { pack } from './layout';
export { openRadial, closeRadial } from './radial';
export { icons, svg } from './icons';
export type * from './types';

export function createSurface(opts: SurfaceOptions) {
  return new Surface(opts);
}

/** Identity helper so module files get type checking without importing the type. */
export function defineModule(def: ModuleDef): ModuleDef {
  return def;
}

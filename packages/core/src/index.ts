import { Board, type BoardOptions } from './render/board';
import { Store, type StoreOptions } from './store/store';

export * from './solver';
export * from './store';
export * from './modules/types';
export { Board, type BoardOptions, newId, MIN_ZOOM, MAX_ZOOM, MAX_TILT } from './render/board';
export { screenToWorld, worldToScreen, zoomAround, type CameraState } from './render/camera';
export { Spring, SPRINGS, project } from './loop/spring';
export { Clock } from './loop/clock';
export { icons, svg } from './render/icons';

/** One call to get a working board. */
export function createBoard(opts: Omit<BoardOptions, 'store'> & { store?: Store; storage?: StoreOptions }) {
  const store = opts.store ?? new Store(opts.storage);
  return new Board({ ...opts, store });
}

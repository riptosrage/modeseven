import { Board, type BoardOptions } from './render/board';
import { Engine, type EngineOptions } from './engine';

export * from './solver';
export * from './store';
export * from './modules/types';
export { record, replay, applyChange, type Recording } from './store/recorder';
export { Engine, newId, parseValue, type EngineOptions } from './engine';
export { Params, type ParamInfo, type ParamHandle } from './params/registry';
export { param, coerce, toNormal, fromNormal, format as formatParam, type ParamSpec, type NumberParam, type ToggleParam, type ChoiceParam } from './params/spec';
export { Actions, tokenize, parseCell, parseSize, type ActionDef, type ArgSpec, type ArgType, type ActionInput, type ActionResult } from './actions/actions';
export { Midi, parseMidi, describeSource, noteName, type MidiMessage } from './midi/midi';
export { Board, type BoardOptions, MIN_ZOOM, MAX_ZOOM, MAX_TILT } from './render/board';
export { screenToWorld, worldToScreen, zoomAround, type CameraState } from './render/camera';
export { Spring, SPRINGS, project } from './loop/spring';
export { Clock } from './loop/clock';
export { icons, svg } from './render/icons';

/** One call to get a working board. */
export function createBoard(opts: Omit<BoardOptions, 'engine'> & EngineOptions) {
  const engine = new Engine(opts);
  return new Board({ ...opts, engine });
}

/** Mode 7 with no screen: for scripts, tests, workers, servers and agents. */
export const createEngine = (opts: EngineOptions) => new Engine(opts);

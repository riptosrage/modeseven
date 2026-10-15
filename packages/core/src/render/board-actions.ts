import type { ActionDef } from '../actions/actions';
import type { Engine } from '../engine';
import type { Board } from './board';

/**
 * Commands that need a screen: camera, focus, modes. Registered on the
 * engine by the board, so the palette, scripts and AI see one list.
 */
export function boardActions(b: Board): ActionDef<Engine>[] {
  // Capture the engine's own versions before these wrappers replace them.
  const add = b.engine.actions.get('add')!;
  const make = b.engine.actions.get('new')!;
  const defs: ActionDef<Engine>[] = [
    {
      // Same args as the engine's add, plus the board's select-and-pop.
      ...add,
      run(a, e) {
        const id = add.run(a, e) as string;
        b.selected.set(id);
        b.pop(id);
        b.reveal(id);
        return id;
      },
    },
    {
      ...make,
      async run(a, e) {
        const r = (await make.run(a, e)) as { type: string; id: string };
        b.selected.set(r.id);
        b.pop(r.id);
        b.reveal(r.id);
        b.editor.open(r.type);
        return r;
      },
    },
    {
      name: 'code',
      describe: 'Open the code of a custom module type, by type or by a module of that type.',
      args: [{ name: 'type', type: 'text' }],
      run(a, e) {
        const ref = String(a.type).trim();
        let type = e.sourceOf(ref) !== undefined ? ref : '';
        if (!type) {
          try {
            type = e.store.layer.modules[e.find(ref)].type;
          } catch {
            type = ref;
          }
        }
        if (e.sourceOf(type) === undefined) {
          throw new Error(e.def(type) ? `${e.def(type)!.title} is built in, so its code lives in the app. Make your own with: new <name>` : `No custom module “${ref}”. Make one with: new <name>`);
        }
        b.editor.open(type);
      },
    },
    { name: 'arrange', describe: 'Arrange mode: move and resize anything.', run: () => b.setMode('arrange') },
    { name: 'done', describe: 'Leave Arrange, full screen and map mode.', run: () => (b.unfocus(), b.setMode('use'), b.mapMode.set(false)) },
    { name: 'focus', describe: 'Show a module full screen.', args: [{ name: 'module', type: 'module' }], run: (a) => b.focus(a.module) },
    { name: 'select', describe: 'Select a module.', args: [{ name: 'module', type: 'module' }], run: (a) => (b.selected.set(a.module), b.reveal(a.module)) },
    { name: 'zoom', describe: 'Zoom the board, in percent.', args: [{ name: 'percent', type: 'number' }], run: (a) => b.setCamera({ zoom: a.percent / 100 }) },
    { name: 'tilt', describe: 'Tilt the board back, in degrees (0 is flat).', args: [{ name: 'degrees', type: 'number' }], run: (a) => b.tiltTo(a.degrees) },
    { name: 'flat', describe: 'Back to flat, 100%.', run: () => (b.tiltTo(0), b.setCamera({ zoom: 1 })) },
    { name: 'midi', describe: 'MIDI map mode: tap a control, move a knob on your controller.', run: () => b.mapMode.set(!b.mapMode.on.get()) },
    { name: 'debug', describe: 'Toggle the debug overlay.', run: () => b.debug.set(!b.debug.get()) },
  ];
  return defs;
}

# Mode 7

**Try it live: [modeseven.vercel.app](https://modeseven.vercel.app)** · [10-second demo](https://modeseven.vercel.app/#demo)

A pegboard for building your own tools. Mode 7 is an endless grid you mount modules on: add one, resize it from a single cell to the full width, move it anywhere, and it stays exactly where you put it. Tilt the whole board back like the SNES Mode 7 effect and look down it toward the horizon.

It runs in a browser, so it runs on a Mac, an iPad, a phone, a Steam Deck. It works offline, installs to your home screen, and there's a native Mac app. The first tool built on it will be a minimal DAW. The long-term goal is that any module can be prompted into existence and its code edited live.

**Status:** the foundation. The grid, solver, camera, gestures and module API are real and tested. The modules in the testbed are blank placeholders.

## Get it

- **Web:** open [modeseven.vercel.app](https://modeseven.vercel.app). After the first visit it works offline. On iPhone/iPad: Share → Add to Home Screen. In Chrome on a Mac: the install icon in the address bar.
- **Mac app:** download the `.dmg` from the latest [Mac app build](https://github.com/riptosrage/modeseven/actions/workflows/desktop.yml) (open a green run → Artifacts → Mode7-mac). It isn't signed yet, so the first time: right-click Mode 7 → Open. Tagged versions also appear under Releases.
- **Save and open:** the download/folder buttons in the toolbar save your board to a `.mode7.json` file and open one back. Browser storage isn't a safe only copy; files are.

## Run it

```sh
npm install
npm run dev
```

Open the URL it prints. The Network URL works on an iPad or phone on the same Wi-Fi.

**Demo:** hit **Demo** in the toolbar for a 10-second tour (Esc stops it, your own board comes back after). Open the page with `#demo` on the end of the URL to start it automatically, handy for screen recordings.

```sh
npm test             # solver, store, camera unit tests (Vitest)
npm run e2e          # gesture tests in a real browser (Playwright)
npm run typecheck
```

First e2e run on a machine: `npx playwright install chromium`.

## Using the board

Gestures follow iOS wherever iOS has an answer.

| Do this | Get this |
| --- | --- |
| Drag a module's header | Move it. Only modules it lands on move out of the way |
| Drag the bottom-right corner | Resize, snapping to whole cells. A badge shows `4 × 2 · Wide` |
| Long-press a module's header, or the Arrange button | Arrange mode: modules wobble, any edge resizes, drag from anywhere. (Holding a module's controls never triggers it.) |
| In Arrange, drag across empty cells | Draw a new module that size, then pick what it is |
| Tap or hover an empty cell, tap the + | Radial add menu |
| Hold an empty cell, slide, release | Radial add menu, picked on release |
| Double-tap a header, or Enter | Full screen. Again, or Escape, to return |
| Drag empty canvas, or scroll | Pan |
| Pinch, or ⌘/Ctrl + scroll | Zoom |
| ⌥ + scroll, the Tilt slider, or T | Tilt the board (Mode 7) |
| ⌘Z / ⇧⌘Z | Undo / redo any layout change |
| Arrows / ⇧ + arrows | Move / resize the selected module one cell |
| Delete | Remove the selected module (with Undo) |
| E | Toggle Arrange |
| ⌘K or / | Command palette |
| [ ] | Previous / next layer |
| \` | Debug overlay |
| Escape | Cancel a drag, close a menu, leave full screen or Arrange |

**Tidy** packs everything upward. It's the only gravity on the board.

### Commands (⌘K)

Press ⌘K or / and type. Everything the board can do is a command, and the same commands work from code and from AI.

```
add knob at 3,2 as Cutoff
set knob 80
move knob to 6,0
resize note to 4x2
learn knob            (then move a control on your MIDI device)
layer add Drums
tilt 60
list · params · help
stress 1000           (a layer of 1,000 modules, to feel the scale)
new Meter             (make your own module from code; it updates as you type)
code meter            (open a custom module's code again)
look plastic · look matte · theme dark · theme auto
```

### MIDI

Hit **MIDI** in the toolbar (or type `midi`): every mappable control gets a ring. Tap one, move a knob, fader or pad on your controller. Mappings save with the board and undo like anything else. Needs Chrome or Edge for now; Safari and the Mac app don't have Web MIDI yet.

## Layout

```
packages/core/src/
  solver/   pure layout maths: metrics, placement, reflow. No DOM. Unit tested.
  engine.ts the headless engine: doc + module types + params + MIDI + commands
  store/    the document, commands, undo, transactions, change stream, recorder
  actions/  the command language: typed verbs, text parser, LLM tool schemas
  params/   parameter specs and registry
  midi/     MIDI parsing, learn, mappings
  loop/     one frame clock for everything, Apple-style springs
  render/   board, module shells, camera (pan/zoom/tilt), radial, menus, debug
  input/    the gesture state machine, keyboard
  modules/  the module API types
  styles/   design tokens and board styles
apps/testbed/   blank-widget playground (and its e2e tests); also the web/PWA build
apps/desktop/   the Mac app: a Tauri shell around the testbed build
legacy/slab-v0/ the first prototype, kept for reference
docs/           architecture and design notes
```

## Building the Mac app yourself

Needs macOS with Xcode command line tools and Rust (`curl https://sh.rustup.rs -sSf | sh`).

```sh
npm install
npm run dev -w @mode7/desktop     # live-reloading app window
npm run build -w @mode7/desktop   # Mode 7.app and a .dmg in apps/desktop/src-tauri/target/release/bundle
```

GitHub builds it automatically on every push to `main` (see `.github/workflows/desktop.yml`).

## Writing a module

Declare the controls as params and you get MIDI learn, undo, saving, commands (`set filter.cutoff 2000`) and AI access with no extra code:

```ts
import { defineModule, param } from '@mode7/core';

export const filter = defineModule({
  type: 'filter',
  title: 'Filter',
  size: [2, 1],
  params: { cutoff: param.number(20, 20000, 800, { unit: 'Hz', curve: 'exp' }) },
  mount(el, ctx) {
    const cutoff = ctx.param('cutoff');
    el.innerHTML = `<input type="range" min="0" max="1" step="0.001" data-m7-interactive data-m7-param="cutoff"><output></output>`;
    const [slider, out] = [el.querySelector('input')!, el.querySelector('output')!];
    const paint = () => ((slider.value = String(cutoff.normal())), (out.textContent = cutoff.text()));
    paint();
    slider.onpointerdown = () => cutoff.begin(); // one drag = one undo step
    slider.onpointerup = () => cutoff.end();
    slider.oninput = () => cutoff.setNormal(Number(slider.value));
    return cutoff.subscribe(paint); // MIDI, undo and commands land here too
  },
});
```

Free-form state that isn't a control goes in props:

```ts
export const counter = defineModule({
  type: 'counter',
  title: 'Counter',
  size: [2, 1],
  mount(el, ctx) {
    const b = document.createElement('button');
    let n = Number(ctx.record.get().props?.n ?? 0);
    b.textContent = String(n);
    b.onclick = () => ctx.setProps({ n: ++n }); // saved, undoable
    el.appendChild(b);
    // Show a different view per size class, not a scaled one.
    const off = ctx.size.subscribe((s) => el.dataset.cls = s.cls); // tile, small, wide, tall, large
    return off; // cleanup
  },
});
```

Register it with `new Board({ root, store, modules: [filter, counter, ...] })`. Mark draggable controls inside a module with `data-m7-interactive` so they keep their own drag in Use mode.

### Without a screen

The engine runs headless, in Node, a worker or a test, which is how scripts and AI agents drive a board:

```ts
import { createEngine, record, replay } from '@mode7/core';

const e = createEngine({ modules: [filter] });
const rec = record(e.store);
e.run('add filter at 0,0');
e.run({ action: 'set', param: 'filter.cutoff', value: 2400 }); // the shape an LLM tool call arrives in
e.actions.tools();                                              // JSON Schema tool definitions for a model
await replay(otherStore, rec.stop());                           // the identical board, step by step
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and [docs/MODULE-IDEAS.md](docs/MODULE-IDEAS.md) for modules on the way.

## License

MIT

# Mode 7

A pegboard for building your own tools. Mode 7 is an endless grid you mount modules on: add one, resize it from a single cell to the full width, move it anywhere, and it stays exactly where you put it. Tilt the whole board back like the SNES Mode 7 effect and look down it toward the horizon.

It runs in a browser, so it runs on a Mac, an iPad, a phone, a Steam Deck. The first tool built on it will be a minimal DAW. The long-term goal is that any module can be prompted into existence and its code edited live.

**Status:** the foundation. The grid, solver, camera, gestures and module API are real and tested. The modules in the testbed are blank placeholders.

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
| Long-press a module | Arrange mode: modules wobble, any edge resizes, drag from anywhere |
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
| [ ] | Previous / next layer |
| \` | Debug overlay |
| Escape | Cancel a drag, close a menu, leave full screen or Arrange |

**Tidy** packs everything upward. It's the only gravity on the board.

## Layout

```
packages/core/src/
  solver/   pure layout maths: metrics, placement, reflow. No DOM. Unit tested.
  store/    the document, commands, undo history, transactions, persistence
  loop/     one frame clock for everything, Apple-style springs
  render/   board, module shells, camera (pan/zoom/tilt), radial, menus, debug
  input/    the gesture state machine, keyboard
  modules/  the module API types
  styles/   design tokens and board styles
apps/testbed/   blank-widget playground (and its e2e tests)
legacy/slab-v0/ the first prototype, kept for reference
docs/           architecture and design notes
```

## Writing a module

```ts
import { defineModule } from '@mode7/core';

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

Register it with `new Board({ modules: [counter, ...] })`. Mark draggable controls inside a module with `data-m7-interactive` so they keep their own drag in Use mode.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit.

## License

MIT

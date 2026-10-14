# Architecture

Mode 7 is built like a small game engine: one data store, one clock, and systems that each do one job. Every change follows the same path:

```
pointer / keyboard / (MIDI, AI later)
        │
        ▼
  input/gestures.ts ── decides what a touch means, turns it into a command
        │
        ▼
  store/ ── Doc (plain JSON) ── reduce(doc, command) ── undo history
        │
        ▼
  solver/ ── pure layout maths (placement, reflow, metrics)
        │
        ▼
  render/board.ts ── shells get spring targets ── loop/clock.ts steps springs
        │
        ▼
  modules ── mounted once, told their size class, live while moving
```

## The document

`store/doc.ts`. Everything that gets saved, undone or shared as a template.

- A **Doc** has layers. A **layer** has modules (id, type, title, props) and **layouts**.
- A layout is `id → {x, y, w, h}` in cells. A layer keeps **one layout per column count** (4, 8, 12, 16). The first time you view a layer at a new width, a layout is derived from the nearest stored one. Edits at a width are saved for that width only, so arranging on the iPad never wrecks the Mac layout.
- All updates are immutable: a new object means "changed". That makes undo a stack of old docs.

## Commands, history, transactions

`store/store.ts`. `dispatch(cmd)` is one undo step. A gesture opens a **transaction**: every pointer move calls `txn.preview(cmd)`, which applies the command to the doc **as it was when the gesture began**, never to the last preview. That is why modules pushed aside return home when the dragged module moves on, and why a drag is a single undo step (`txn.commit()`), or nothing at all (`txn.cancel()` on Escape).

## The solver

`solver/place.ts`. Pure functions, no DOM, covered by unit tests including a 2,000-move fuzz test.

- **Pegboard rule:** nothing has gravity. A module stays where it's put.
- `place(layout, id, rect, cols)`: put a module somewhere. Only modules it now covers move, each to the nearest free spot. If exactly one is covered and it fits where the mover came from, they swap. Nothing cascades.
- `tidy`: the one explicit gravity command.
- `reflow`: derive a layout for a different column count.
- `computeMetrics(width)`: picks 4/8/12/16 columns so cells stay at least 76 px (adjustable), then stretches cells to fill the width.

## The camera

`render/camera.ts`. The camera has `x, y` (world point at the centre of the screen), `zoom` and `tilt`. The world element gets one CSS transform:

```
translate(centre) perspective(d) rotateX(tilt) scale(zoom) translate(-camera)
```

`screenToWorld` inverts that exactly, including tilt (a ray–plane intersection), so drags land in the right cell when the board is leaning back. Round-trips are unit tested at 0°, 25° and 50°.

## The frame loop and springs

`loop/clock.ts` runs one `requestAnimationFrame` loop for the whole engine and **stops completely when nothing moves**, so an idle board costs zero CPU. `loop/spring.ts` implements Apple's spring model (response + damping ratio, no durations). Springs can be retargeted mid-flight and keep their velocity, which is what makes interrupted motion feel physical.

Shells (module frames) own springs for x, y, width, height and lift. During a drag the dragged shell is pinned 1:1 to the finger; everything else glides. On release it takes the finger's velocity into its landing spring.

## Gestures

`input/gestures.ts` is one state machine. A touch is undecided until it travels 8 px or the long-press fires (420 ms). Then where it started and the mode decide the gesture:

| Started on | Use mode | Arrange mode |
| --- | --- | --- |
| Header | move | move |
| Module body | the module's own | move |
| Resize handle | resize | resize (any edge) |
| Empty canvas | pan; tap shows +; hold opens radial | draw a new module; tap = Done |
| Anywhere on a module, long-press | enter Arrange, keep dragging | lift |

Drop targets come from the layout model, not the DOM, with hysteresis so the target doesn't flicker at cell borders. Fast flicks are projected forward using scroll-style deceleration.

## Modules

`modules/types.ts`. A module is `{ type, title, size, mount(el, ctx) }`. `ctx` gives:

- `size`: a signal of `{x, y, w, h, cls, focused}`. `cls` is `tile | small | wide | tall | large`. Show a different view per class, the way iOS widgets do.
- `record`: the saved title and props. `setProps` / `setTitle` write through the store (undoable).
- `mode` and `held`: pause expensive work while the module is being dragged.
- `header`: a slot for small buttons.

Each module renders into its own `.m7-content` box and can style it freely. A module that throws while mounting shows an error instead of taking down the board. Later, AI-generated modules will mount through the same function inside a sandbox.

## Design tokens

`styles/tokens.css`. Colour by role (`--m7-ground`, `--m7-surface-1..3`, `--m7-ink-1..3`, `--m7-live`), one type family with two voices (Geist for words, Geist Mono for numbers), a five-step type scale, a 4 px spacing base, radius by nesting, and three heights (inset, resting, lifted). Dark mode only redefines values. A theme like "1977 cockpit" would do the same.

## Debugging

Press \` for the debug overlay: cell outlines, hit zones, camera, frame time and the selected module's rect. `window.board` and `window.store` are exposed in the testbed console.

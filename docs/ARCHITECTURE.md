# Architecture

Mode 7 is built like a small game engine: one data store, one clock, and systems that each do one job.

There are two halves. The **Engine** (`engine.ts`) is everything that isn't pixels: the document, module types, parameters, MIDI and the command language. It has no DOM and runs in a browser, a worker, Node or a test. The **Board** (`render/board.ts`) renders an engine and adds gestures, the camera and overlays. Every change, from any source, follows the same path:

```
pointer / keyboard        ⌘K text / scripts / AI tool calls        MIDI / (phone remote later)
        │                              │                                  │
        ▼                              ▼                                  ▼
  input/gestures.ts            actions/ (one verb list)             midi/ → params/
        └──────────────────────────────┼──────────────────────────────────┘
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

**Gestures rebase.** If something else changes the doc mid-gesture (a MIDI knob, a remote edit), `dispatch` applies it to the transaction's base and rebuilds the preview on top. Gestures preview *intents* (`place this module here`), not results, so the rebuild is always right. Undo stays in order: the outside change is its own step, the gesture another.

**Coalescing.** `dispatch(cmd, { coalesce: key })`: changes with the same key in quick succession extend one undo step, like typing. A knob drag uses a per-gesture key (one drag, one step), a MIDI sweep uses the control's key.

**The change stream.** `store.changes` emits every committed change (`do` with its commands and column count, or `undo`/`redo`/`replace`). Previews aren't changes; their commit is. `store/recorder.ts` records it into a session file and replays it to the identical doc. Live sync will stream the same thing.

**Persistence** is an adapter (`{ load, save }`). localStorage by default; IndexedDB, a file or a server slot in the same way.

## Actions: one command language

`actions/actions.ts`, registered in `engine.ts` (headless verbs) and `render/board-actions.ts` (camera, focus, modes). Each verb is declared once with typed args, and that one declaration serves:

- **text**: `run('add knob at 3,2 as Cutoff')`, `run('set filter.cutoff 2k')`. Quotes, filler words (`set knob to 80`) and missing keywords (`move knob 4,0`) are fine. Mistakes come back as `{ ok: false, error }` with a usage line, never a throw.
- **objects**: `run({ action: 'add', type: 'knob', at: [3, 2] })`, which is exactly the shape an LLM tool call arrives in.
- **tool schemas**: `actions.tools()` returns JSON Schema tool definitions to hand to a model.
- **help**: `usage(name)` and the ⌘K palette.

Modules are referred to by id, title or type ("the knob"), with a readable error when that's ambiguous.

## Parameters

`params/`. A module declares its controls: `params: { cutoff: param.number(20, 20000, 800, { unit: 'Hz', curve: 'exp' }) }`. Values live in the doc (`record.params`), so they save, undo, replay and sync like everything else. Every param has an **address**, `moduleId.key`, and normalised 0..1 access, which is what MIDI, automation and sliders speak. `spec.ts` is pure maths (coerce, normalise, exp curves, formatting like `2.4 kHz`).

In a module, `ctx.param('cutoff')` gives a handle: `get/set/setNormal/text`, `subscribe` (paint from here, since changes arrive from MIDI, undo or a command too), and `begin/end` to make a drag one undo step. `ctx.begin/end` groups several params (an XY pad).

## MIDI

`midi/midi.ts`. Messages come in through `inject(bytes)`, from Web MIDI (Chrome, Edge), later a native bridge in the Mac app (WebKit has no Web MIDI), the phone, or a test. Mappings (`midi:cc:1:74 → m12.cutoff`) live in the doc. **Map mode** (`render/mapmode.ts`) works like Ableton's: any element a module marks `data-m7-param="key"` gets a ring; tap it, move a control, mapped. Modules write no MIDI code.

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

## Scale: culling and level of detail

Like a game engine, the board only pays for what's on screen. Tested at 1,000 modules (`stress 1000` in ⌘K; an e2e test keeps it honest).

- **Culling.** Every frame anything moves, `Board.cull()` projects the viewport's corners onto the board (tilt included) and hides modules outside it, plus a margin. Hidden modules aren't drawn and their `ctx.visible` is false, so they can stop animating.
- **Lazy mounting.** A module's content is built the first time it's on screen *and* big enough to see. A 1,000-module board opens with ~50 modules built. Set `keepAlive: true` on a module type that must run while unseen (an audio engine).
- **Level of detail.** When one grid cell is under ~40 px on screen (zoomed out, or far rows under tilt), modules drop their content and keep only their shape. Below a fingertip it can't be used anyway. Zoomed out or tilted, shadows switch to a cheap unblurred version.
- **Incremental sync.** A knob turn touches one shell. Layout work only runs when the layout or metrics change, content-only changes (params, props, titles) share the derived-layout cache, and root CSS variables are only written when they change.

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
- `visible`: false while off screen. Pause drawing until it's true again.
- `param(key)`: a declared parameter (see Parameters). Mark its control `data-m7-param="key"` for MIDI learn.

Each module renders into its own `.m7-content` box and can style it freely. A module that throws while mounting shows an error instead of taking down the board. Later, AI-generated modules will mount through the same function inside a sandbox.

## Design tokens

`styles/tokens.css`. Colour by role (`--m7-ground`, `--m7-surface-1..3`, `--m7-ink-1..3`, `--m7-live`), one type family with two voices (Geist for words, Geist Mono for numbers), a five-step type scale, a 4 px spacing base, radius by nesting, and three heights (inset, resting, lifted). Dark mode only redefines values. A theme like "1977 cockpit" would do the same.

## Debugging

Press \` for the debug overlay: cell outlines, hit zones, camera, frame time and the selected module's rect. `window.board`, `window.store` and `window.engine` are exposed in the testbed console: try `engine.run('help')`.

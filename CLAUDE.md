# Mode 7: notes for Claude

Mode 7 is Felix's open-source "pegboard" framework: an infinite grid of resizable modules, tap-first, any device, with a tiltable SNES-Mode-7 camera. The engine comes first; a minimal DAW is the first app planned on top. Design rationale lives in `docs/ARCHITECTURE.md` and the "Slab Foundations" proposal doc Felix has.

## Working with Felix

- He's a product designer and musician, not primarily an engineer. Bring him decisions and things to try, not implementation detail.
- Short, plain, casual. No hype, no restating his idea back to him.
- Lean on iOS interaction patterns; Apple is the reference for feel.

## Commands

```sh
npm run dev        # testbed at :5173 (with --host for iPad testing)
npm test           # Vitest: solver, store, camera
npm run e2e        # Playwright gesture tests (apps/testbed/e2e)
npm run typecheck
```

In a sandbox without Playwright browsers, set `PW_CHROMIUM` to a Chromium binary path.

## Rules of the codebase

- **Layout maths stays pure.** Anything in `packages/core/src/solver` has no DOM and gets a unit test. A layout bug becomes a solver test first.
- **Every change is a command.** UI never mutates the doc; it dispatches (`store.dispatch`) or previews inside a transaction (`store.begin()`). Gestures always preview from `txn.base`, never from the previous preview.
- **Pegboard: no gravity.** Modules stay put. Only `tidy` compacts.
- **One clock.** Animate through springs stepped by `board.clock`; no `setInterval`, no CSS transitions on positions. The loop must go idle when nothing moves.
- **No literal colours** in engine CSS; use the tokens in `styles/tokens.css`.
- **Modules own `.m7-content` only.** They never touch the shell. Interactive controls inside a module get `data-m7-interactive`.
- A new gesture or gesture fix gets a Playwright test in `apps/testbed/e2e`.
- Keep the engine framework-free TypeScript. Modules may use anything inside their box.

## Layout

- `packages/core`: the engine (`@mode7/core`)
- `apps/testbed`: blank-widget playground
- `legacy/slab-v0`: first prototype (old Slab DAW mock), reference only, not built

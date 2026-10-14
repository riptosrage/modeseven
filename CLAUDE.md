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

## Platforms

- Web/PWA first, offline after first load. Fonts are self-hosted (@fontsource); no network requests at runtime.
- Mac app via Tauri (uses WebKit, so it inherits Safari's audio behaviour). Built by GitHub Actions on macOS (`desktop.yml`); unsigned until there's an Apple Developer account.
- Phone: same board, phone-tuned; later also a remote/controller for a bigger screen.
- CI (`ci.yml`) runs typecheck, unit and e2e tests on every push.

## Rules of the codebase

- **Layout maths stays pure.** Anything in `packages/core/src/solver` has no DOM and gets a unit test. A layout bug becomes a solver test first.
- **Every change is a command.** UI never mutates the doc; it dispatches (`store.dispatch`) or previews inside a transaction (`store.begin()`). Gestures always preview from `txn.base`, never from the previous preview.
- **Pegboard: no gravity.** Modules stay put. Only `tidy` compacts.
- **Arrange is entered from a module's header (long-press) or an explicit button, never from module content.**
- **One clock.** Animate through springs stepped by `board.clock`; no `setInterval`, no CSS transitions on positions. The loop must go idle when nothing moves.
- **No literal colours** in engine CSS; use the tokens in `styles/tokens.css`.
- **Modules own `.m7-content` only.** They never touch the shell. Interactive controls inside a module get `data-m7-interactive`.
- A new gesture or gesture fix gets a Playwright test in `apps/testbed/e2e`.
- Keep the engine framework-free TypeScript. Modules may use anything inside their box.

## Layout

- `packages/core`: the engine (`@mode7/core`)
- `apps/testbed`: blank-widget playground; also the offline web app (PWA, vite-plugin-pwa) and the frontend the Mac app bundles
- `apps/desktop`: Tauri v2 Mac app (`src-tauri/`). Native powers go in as Tauri plugins; JS reaches them through `apps/testbed/src/platform.ts`, which falls back to browser APIs. Never call Tauri APIs from module code.
- `legacy/slab-v0`: first prototype (old Slab DAW mock), reference only, not built

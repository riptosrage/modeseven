# Mode 7: notes for Claude

Mode 7 is Felix's open-source "pegboard" framework: an infinite grid of resizable modules, tap-first, any device, with a tiltable SNES-Mode-7 camera. The engine comes first; a minimal DAW is the first app planned on top. Start with `docs/PROJECT.md` (vision, decisions, status, research, roadmap); code structure is in `docs/ARCHITECTURE.md`. Keep `docs/PROJECT.md` current: update its status and next-steps sections when a milestone lands or a decision is made.

## Working with Felix

- He's a product designer and musician, not primarily an engineer. Bring him decisions and things to try, not implementation detail.
- Short, plain, casual. No hype, no restating his idea back to him.
- Lean on iOS interaction patterns; Apple is the reference for feel.
- When he shares a module idea, add it to `docs/MODULE-IDEAS.md` (what it is, how it feels, what engine pieces it needs) rather than building it straight away, unless he says to.

## Staying on target

- **The north star decides.** Phone or Mac, offline: a beat plays, Flow turns a mumbled verse into syllable blocks, a controller drives the knobs, the board rearranges under your thumb. Work that doesn't move toward that, or make the engine more elegant for everything after it, waits. The order is in `docs/PROJECT.md` §6.
- **Engine first, then the module.** If a module needs something general (tempo, audio routing, assets), build it once in the engine as an action/param/command, then build the module on it.
- **Finish one thing end to end** (working, tested, live, Felix told what to try) before starting the next. No half-built features on `main`.
- **Small, deliberate surface.** Before adding an API, option or dependency, check whether an existing piece (actions, params, the doc, tokens) already does it. Prefer MIT/permissive dependencies; never AGPL/GPL.
- **Felix decides product and feel; you decide engineering.** Ask him only real product questions, a few at a time, each with a recommendation.

## Spending tokens well

When working on this repo:
- Read `docs/PROJECT.md` and this file, then only the files the task touches. Use search before reading whole files; read large files in parts.
- Don't re-read files you just wrote. Batch independent commands in one call. Keep test output short (grep for pass/fail).
- Keep these instruction files lean; details belong in `docs/`. Update `docs/PROJECT.md` when a milestone lands so the next session doesn't rediscover it.
- Replies to Felix are short: what changed, the version code, one or two things to try, any decision needed.

When the product calls the Claude API (Ask AI, commands in words, code repair): follow `docs/AI.md`. Cheapest model that can do the job, escalate once; cached, stable prefix (tools → system → small board summary); validate locally with `compileModule` before any retry; user's own key, stored on the device only; show the cost.

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
- **The engine is headless.** `engine.ts`, `store/`, `solver/`, `params/`, `actions/`, `midi/` never touch the DOM; they get unit tests in Node. Pixels live in `render/` and `input/`.
- **Every verb is an action.** New capability = an `ActionDef` (engine or board), so ⌘K, scripts and AI get it for free. Actions never throw at callers; errors explain themselves with a usage line.
- **Every control is a param.** Module controls are declared in `params` and read/written through `ctx.param()`, painted from `subscribe`. Mark the element `data-m7-param="key"`. Free-form state stays in props.
- **Every change is a command.** UI never mutates the doc; it dispatches (`store.dispatch`) or previews inside a transaction (`store.begin()`). Gestures always preview from `txn.base`, never from the previous preview, and preview intents (`place`), not computed layouts, so outside changes rebase cleanly.
- **Pegboard: no gravity.** Modules stay put. Only `tidy` compacts.
- **Arrange is entered from a module's header (long-press) or an explicit button, never from module content.**
- **One clock.** Animate through springs stepped by `board.clock`; no `setInterval`, no CSS transitions on positions. The loop must go idle when nothing moves.
- **No literal colours** in engine CSS; use the tokens in `styles/tokens.css`.
- **Pay only for what's on screen.** Modules mount lazily and get culled/LOD'd; anything animated inside a module pauses on `ctx.visible === false`. Per-frame and per-change work must be O(changed), not O(modules). `stress 1000` in ⌘K to check.
- **Never run code nobody trusted.** Custom module source in a doc only compiles once its hash is in the `TrustStore` (authored here, or the person pressed "Run its code"). Keep the module API (`moduleApi` in `modules/code.ts`) small and deliberate.
- **Looks are tokens.** Visual changes to the shell go through tokens in `styles/tokens.css`, defined for every look (matte, plastic) and theme (light, dark).
- **Modules own `.m7-content` only.** They never touch the shell. Interactive controls inside a module get `data-m7-interactive`.
- A new gesture or gesture fix gets a Playwright test in `apps/testbed/e2e`.
- Keep the engine framework-free TypeScript. Modules may use anything inside their box.

## Layout

- `packages/core`: the engine (`@mode7/core`)
- `apps/testbed`: blank-widget playground; also the offline web app (PWA, vite-plugin-pwa) and the frontend the Mac app bundles
- `apps/desktop`: Tauri v2 Mac app (`src-tauri/`). Native powers go in as Tauri plugins; JS reaches them through `apps/testbed/src/platform.ts`, which falls back to browser APIs. Never call Tauri APIs from module code.
- `legacy/slab-v0`: first prototype (old Slab DAW mock), reference only, not built

# Mode 7: project brief

The high-level view: what we're building, why, what's done, what we learned, and what's next. Read this first, then `CLAUDE.md` (rules), `docs/ARCHITECTURE.md` (how the code fits) and `docs/MODULE-IDEAS.md` (modules on the way).

Owner: Felix (product designer, musician as Holy Felix). Repo: `riptosrage/modeseven`. Live: <https://modeseven.vercel.app>. Licence: MIT.

---

## 1. What it is

Mode 7 is a pegboard for building your own tools. It's an endless grid you mount modules on, like iOS widgets that go from one cell to full width. Modules stay exactly where you put them. Tilt the whole board back like the SNES Mode 7 effect and look down it toward the horizon.

It's an engine first. The first app on top is a minimal, opinionated DAW for how Felix actually makes music: sample, warp, chop, loop, record vocals through a compressor, rap over sections, add instruments. The long game is that any module can be described in words and written by AI, and its code edited live on the board.

**North star:** open the board on a phone or a Mac, offline. A beat module plays, a Flow module records a mumbled verse and turns it into syllable blocks you write words into, a MIDI controller drives the knobs, and you rearrange it all with your thumb. When someone opens the code, the reaction is "oh, you can do *that* too?"

## 2. What we're going for

- **Feel like Apple.** iOS interaction patterns wherever iOS has an answer: long-press to arrange, widgets that open full screen, springs not tweens, undo for everything, 44 pt touch targets.
- **Snappy over pretty.** Every interaction answers on the next frame. The loop goes idle when nothing moves. Scale is proven (1,000 modules) and tested.
- **A pegboard, not a feed.** No gravity. Only the modules you cover move, to the nearest free spot. Only "Tidy" compacts.
- **Matte, not glossy.** The default look is like e-ink paper: flat panels with printed edges, fine grain that moves with the board, one soft light from the top left that stays on the screen. It sits between Ableton's discipline and something with a surface. (Plastic, the first look, is kept as an option.)
- **Any device, offline.** Web first, installable, works with no connection. A native Mac app. A phone-tuned board, later also a remote for a bigger screen.
- **Everything is data.** Layouts, parameter values, controller mappings and even custom module code live in one JSON document. That's why undo, save files, replay, sync and AI all fall out of the same design.
- **One language for everything.** Every verb is a command (`add knob at 3,2`, `set filter.cutoff 2k`), so the UI, the ⌘K box, scripts and AI all drive the board the same way.
- **Elegant code.** Framework-free TypeScript, headless engine, small modules, tests for every gesture and layout rule.

## 3. Decisions so far (and why)

| Decision | Why |
| --- | --- |
| Name: **Mode 7** (was "Slab") | The tilt-the-board idea; SNES Mode 7. |
| Pegboard placement, no gravity | iOS reflow felt like things moving on their own; a pegboard respects where you put things. |
| Modules (not widgets or blocks) | Felix's call. |
| Arrange: long-press a module's **header** or the Arrange button, never module content | Holding a pad or knob must never start jiggle mode. |
| Framework-free TypeScript engine, Vite, Vitest, Playwright | Fast, no lock-in, anything can run inside a module's box. |
| Web/PWA + **Tauri** Mac app | Offline everywhere; the Mac app uses WebKit (so it inherits Safari's audio limits). |
| Phone: both a tuned board **and** later a remote | Phone pass done; remote waits for sync. |
| Matte look as default | Felix wanted something closer to Ableton, "like a Kindle screen". |
| MIT licence; avoid AGPL dependencies | Keeps the open-source promise usable by anyone. |
| Module ideas get written down, not built straight away | `docs/MODULE-IDEAS.md`; build when the engine pieces exist. |

## 4. Where it stands (October 2026)

Built, tested and live. About 5,000 lines in the engine, 65 unit tests and 20 browser tests, all run by CI on every push.

1. **Foundation.** Grid and pegboard solver, store with undo/redo and transactions, one frame clock with Apple-style springs, camera with pan/zoom/tilt and exact touch maths under tilt, gestures (move, resize from any edge with size detents, draw-to-add, radial add menu, full screen, pinch), keyboard control, layers, per-screen-width layouts.
2. **Testbed and demo.** Placeholder modules (blank, note, knob, waveform, clock, XY pad), a 10-second demo for screen recordings (`#demo` in the URL).
3. **Offline and native.** Installable web app with self-hosted fonts; save/open board files; Tauri Mac app built by GitHub Actions (download from a Release).
4. **Engine foundation.** A headless engine (runs with no screen). The command language: typed verbs, text parser, ⌘K palette, and JSON Schema tool definitions for an LLM. Parameters: modules declare their controls once (ranges, units, curves) and get undo, saving, commands and MIDI. MIDI learn with an Ableton-style map mode. Session recording and replay. Gestures that absorb outside changes mid-drag.
5. **Scale.** Culling, lazy mounting, level of detail, incremental updates; smooth at 1,000 modules (`stress 1000`), with a test that fails if it regresses.
6. **Matte look** and a token system where a look is only values (`look matte|plastic`, `theme light|dark|auto`).
7. **Live code.** Custom module types are plain JS saved inside the board; edit and every module of that type swaps in place keeping its values; broken code keeps the last good version running; code from someone else's file only runs after "Run its code". Built-in module files hot-reload in `npm run dev`.
8. **Phone pass.** Bottom toolbar (Arrange, Undo, Add, Redo, More), tap a header to open a module full screen with Done, finger-sized targets.
9. **Build stamp** next to the name so you can see which version is live.

## 5. Research we did

- **Browsers and audio.** Safari (so iPhone, iPad and the Tauri Mac app) has no Web MIDI. Only desktop Chromium can capture tab or system audio. iOS background audio is unreliable. So: the DAW is desktop-first (Chrome) for heavy audio; phones are great for sketching, recording and control. The Mac app will need a native MIDI bridge (a Tauri plugin) for controllers.
- **Phone + Bluetooth latency.** AirPods on an iPhone lag roughly 150–250 ms, steady. Fix it the way rhythm games do: a quick "say ta on the clicks" calibration saved per headphones, plus per-take auto-align to the beat grid. This belongs in the shared transport so every recording module gets it.
- **Time-stretching.** Signalsmith Stretch (MIT) for warping samples to tempo.
- **Existing DAWs.** openDAW is AGPL, which would compromise MIT, so don't build on it. Nobody combines a free-form pegboard of resizable, AI-writable modules with a real DAW; that's the gap.
- **AI modules.** AI writes modules in the same format as `new <name>`, composed from kit controls (knob, fader, pad…) that already have named parameters, and runs them in a sandboxed iframe. Rough cost: $0.10–0.25 per accepted module. Start with bring-your-own-key.
- **Naming and branding.** Avoid third-party branding (e.g. a "YouTube ripper"); ship a neutral "Resample" module that records what the computer plays.

## 6. What's next

In order. Each line is roughly one working session.

1. **Transport.** One shared tempo, bar position and play/stop, driven by the audio clock, plus latency compensation (calibrate + auto-align).
2. **Beat module.** Plays a loop at that tempo. *Decision pending:* load your own file, a small drum machine, or both (recommended: own file first).
3. **Flow v1** (one or two sessions). Record over the beat, find syllables and pitch, show syllable blocks, loop back, type words in. See `docs/MODULE-IDEAS.md`.
4. **Kit v1.** Knob, fader, pad, XY, meter, readout, list, toggle, button: each a proper parameter with labels and accessibility. Rebuild the testbed modules from it.
5. **Audio engine basics.** Audio input/output routing between modules, an asset store for samples (IndexedDB/OPFS; localStorage is too small), then Resample, the sampler/chopper with Signalsmith Stretch, and the vocal recorder.
6. **Live sync.** Same board on phone and Mac, and the phone as a remote. *Decision pending:* the Mac app as the hub over Wi-Fi with a QR code (recommended first), or a cloud relay.
7. **Ask AI.** Prompt-to-module in a sandboxed iframe using the kit and the command tool schemas; bring-your-own-key.
8. **Looks.** The 1977 cockpit theme (needs reference images from Felix); optional colour or icon for modules when zoomed far out.
9. **Mac app polish.** Native MIDI bridge, Apple Developer signing so it opens without the right-click step.

Known rough edges: built-in modules can't be opened in the code editor (only `new` types can); the editor is a plain text area; radial menu labels are small on touch; the trust list is per device; the testbed is doubling as the app (a proper app shell comes with the DAW).

Open questions for Felix: the beat module type; sync hub vs cloud; far-away colour for modules; cockpit references; Flow's real name.

## 7. Handing over to another agent or developer

**Read in this order:** this file → `CLAUDE.md` (rules of the codebase, how Felix likes to work) → `docs/ARCHITECTURE.md` → `docs/MODULE-IDEAS.md` → `README.md`. Agents that look for `AGENTS.md` get pointed here too.

**Working with Felix.** He's the designer and decision-maker, not the engineer. Bring him things to try and the few real decisions, not implementation detail. Short, plain, casual; no hype; don't restate his ideas back to him. Lean on iOS patterns. Make the engineering calls yourself.

**Loop that works:**
1. Make the change with a test (unit test for engine/solver logic, Playwright test for any gesture).
2. `npm run typecheck && npm test && npm run e2e` (in a sandbox without Playwright browsers, set `PW_CHROMIUM` to a Chromium binary).
3. Commit and push to `main`. Vercel redeploys the live site in about a minute; CI runs the tests; the build stamp next to "Mode 7" changes so Felix can tell he's on the new version (the offline cache may need one extra reload).
4. Tell Felix the version code and one or two things to try.

**Mac app releases:** Felix publishes a GitHub Release (tag like `v0.2.0`); the workflow builds and attaches the `.dmg`. Automated sessions may not be allowed to create releases or tags.

**Principles to keep:** headless engine; every verb an action; every control a param; every change a command; pay only for what's on screen; never run untrusted code; looks are tokens; modules own their own box. Details in `CLAUDE.md`.

**Describing it to a new agent in one paragraph:**
> Mode 7 is an open-source (MIT), framework-free TypeScript "pegboard" UI engine: an endless grid of resizable modules that stay where you put them, a tiltable SNES-style camera, iOS-grade gestures, and a headless core where everything (layout, parameters, MIDI mappings, even custom module code) is one undoable JSON document driven by a single command language. It runs offline on web, phone and a Tauri Mac app. The first app on top is a minimal DAW for sketching rap and beats; the next milestones are a shared tempo transport with Bluetooth latency compensation, a beat module, and "Flow", which turns a mumbled verse into syllable blocks you write lyrics into. Read docs/PROJECT.md, CLAUDE.md and docs/ARCHITECTURE.md before changing anything; test every gesture; keep the owner's decisions few and clear.

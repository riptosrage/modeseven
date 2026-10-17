# AI in Mode 7: calling the Claude API, efficiently

How the product uses Claude: "Ask AI" (describe a module, get a working one), driving the board in words, and fixing broken module code. The rule throughout is that every token should buy something the person sees. Facts about models and prices were checked against the Claude docs in October 2026; check <https://platform.claude.com/docs> before changing anything here.

## What we already have that makes this cheap

The engine was built for this. Use these pieces; don't rebuild them for AI.

- **Tool definitions for free.** `engine.actions.tools()` turns every command into a JSON Schema tool. A model drives the board with the same verbs as the ⌘K box, and `engine.runAsync({ action, ...input })` executes its tool calls and returns readable errors instead of throwing.
- **A small, fixed module format.** Custom modules are plain JS with no imports, written against `moduleApi` (`defineModule`, `param`, `svg`, `icons`), so the model needs one short reference, not the codebase.
- **A free local compiler.** `compileModule(source, type)` says exactly what's wrong without calling the API. Check every generated module locally first; only go back to the model with the compiler's message.
- **Parameters.** A generated module that declares params gets MIDI, undo, saving and `set` commands with no extra code, so prompts never need to ask for that plumbing.
- **A headless engine.** Generated modules and command sequences can be tested in Node, which is how we evaluate prompts without a browser.

## Which model for which job

| Job | Model | Why |
| --- | --- | --- |
| Turn a sentence into commands ("add a knob and map it to CC 21"), name things, classify a request | `claude-haiku-5-5` | Fast and cheap; the command schemas do the heavy lifting. |
| Write or edit a module | `claude-sonnet-5-5` | Strong code at a sensible price. The default for Ask AI. |
| Hard modules (audio DSP, complex UI), or a second attempt that still fails | `claude-opus-5-5` | Escalate only when needed, never as the default. |

- Route by job, not by habit. Start on the cheapest model that can do it and **escalate once** on failure, carrying the compiler error.
- Set `max_tokens` to what the job needs (commands: a few hundred; a module: a few thousand). Use low or medium effort for small jobs.
- Stream responses so the person sees progress; it doesn't cost more.

## Prompt layout: cache the big stable part

Prompt caching makes a repeated prefix cost a small fraction of normal input (reads are 0.05× on Opus 5.5 and Sonnet 5.5, 0.1× on standard models; writes cost 1.25× for the 5-minute cache, 2× for the 1-hour cache). The cache covers **tools → system → messages** in that order, and any change to a level invalidates it and everything after it. So lay every request out like this:

1. **Tools** (cached): the action schemas, in a **fixed order** with stable key order. Never rebuild them per request; any change to tools invalidates the whole cache.
2. **System** (cached, 1-hour TTL): who the model is in Mode 7, the module format and `moduleApi` reference, the kit controls, the design tokens and look rules, and two or three short example modules. Version this text in the repo (`ai/system.md`) and only change it deliberately.
3. **Messages** (not cached, kept small): a *summary* of the board (module types, titles, sizes, param names; never the whole doc), the selected module's source if editing, and the person's request.

Check the usage fields on every response (`cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`) and log the hit rate. If reads stay at zero, something in the prefix is changing between calls (often JSON key order or a timestamp).

## The loop for "make me a module"

1. Haiku decides what's being asked: a new module, an edit, or board commands. Commands go straight to `runAsync`; done.
2. Sonnet writes the module source (cached prefix + small request).
3. `compileModule` locally. If it fails, send **only** the error and the failing source back, once. If it fails again, escalate to Opus once, then stop and show the person the error.
4. Mount it on the board. It runs in a **sandboxed iframe** (`allow-scripts` only, no same-origin), talking to the board through postMessage, so generated code can't read the page, the key or other boards.
5. Save it with `engine.defineType`, so it's in the doc, undoable and trusted on this device only.

Never send the model the whole board doc, other modules' source, or images unless the request needs them.

## Keys, privacy and cost to the person

- **Bring your own key first.** The key is stored on the device only (never in the doc, never in a board file, never in logs). Browser calls need the `anthropic-dangerous-direct-browser-access: true` header; that's acceptable *only* because the key is the user's own. A hosted proxy with our key comes later, if ever.
- **Show the cost.** Each AI action reports tokens and an approximate price from the usage fields, with a running total per session and a monthly cap the person sets.
- **Offline-first still holds.** Everything except the AI call works with no connection; AI features say clearly when they need one.

## Testing prompts without burning tokens

- Keep an **eval set** (`ai/evals/`): requests paired with checks that run headless (does it compile, declare the right params, respond to `set`, render without throwing in a fake DOM).
- CI runs evals against **recorded responses**, never the live API. Re-record deliberately (by hand, or a scheduled job using the Batch API, which is half price) when the system prompt or model changes, and compare pass rates before switching.
- A change to `ai/system.md` or the model choice ships only with its eval results.

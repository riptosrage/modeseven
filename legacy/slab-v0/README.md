# Slab

A surface you build tools on. Slab is a grid of modules: add one, drag a corner to resize it, drag its header to move it, and everything else gets out of the way. Every module is its own little program, and the long-term goal is that you can prompt any of them into existence or into something else.

It runs in a browser, so it runs on anything with one: a Mac, an iPad, a phone, a Steam Deck.

The first app built on Slab is a minimal DAW for sampling, looping and tracking vocals.

## Run it

```sh
npm install
npm run dev
```

Open the URL it prints. `--host` is on, so the Network URL also works on an iPad or phone on the same Wi-Fi.

## Layout

```
packages/core   @slab/core, the engine. Grid, packing, resize, drag, radial add menu,
                layers, zoom, full screen, module API, save/load. Knows nothing about audio.
apps/daw        The DAW. Registers modules (timeline, record, browser, mixer, fader,
                sampler) and the mock "Ask AI" flow on top of the engine.
```

## Gestures

| Do this | Get this |
| --- | --- |
| Tap `+` | Radial menu opens around the slot, tap a node |
| Hold `+`, slide, release | Same menu, pick by releasing over a node |
| Hover a node with a dot | A second ring opens |
| Drag a module's corner | Resize, snapping to cells |
| Drag a module's header | Move it, others reflow |
| Double-tap a header | Full screen, again to exit |
| Ctrl/⌘ + scroll, or `-` `=` `0` | Zoom out to see more |
| Horizontal swipe, or `[` `]` | Switch layers |
| Double-click a layer | Rename it |
| `Space` / `R` | Play / record (DAW) |

Layout saves to localStorage. **Reset** in the top bar goes back to the starter layout.

## Writing a module

```ts
import { defineModule } from '@slab/core';

export const hello = defineModule({
  type: 'hello',
  title: 'Hello',
  size: [2, 1],          // cells
  maxSize: [4, 2],
  mount(body, ctx) {
    body.innerHTML = `<button>Count: 0</button>`;
    let n = Number(ctx.instance.props?.n ?? 0);
    const b = body.querySelector('button')!;
    b.textContent = `Count: ${n}`;
    b.onclick = () => {
      b.textContent = `Count: ${++n}`;
      ctx.setProps({ n });   // saved with the layout
    };
    ctx.onResize((r) => console.log('now', r.width, r.height));
    return () => {};         // cleanup when removed
  },
});
```

Register it in `createSurface({ modules: [...] })` and add a node for it to `addMenu`.

## What's real and what's fake

Real: the whole engine. Grid, resize, drag, radial menu, layers, zoom, full screen, persistence, theming.

Fake: all audio except the sampler pad blips. The transport is a clock, recording draws takes without capturing sound, and "Ask AI" picks a canned module. `apps/daw/src/modules/building.ts` is where a real prompt-to-module generator plugs in.

## Next

- Real audio: Web Audio transport, mic recording into the Vox lane, sample loading and warping
- Prompt-to-module: generate module code from a prompt, run it sandboxed, edit it live
- Web MIDI: map controller knobs to any module control
- iPad: pinch to zoom, three-finger swipe between layers
- Templates: export and import layouts as JSON

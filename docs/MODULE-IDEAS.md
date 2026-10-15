# Module ideas

Modules we want, parked until the foundation is ready for them. Newest first. Each entry says what it is, how it should feel, and what it needs from the engine, so whoever picks it up knows when it's buildable.

Status: **idea** → **ready** (everything it needs exists) → **building** → **shipped**.

---

## Flow (working name)

**Status:** idea · **Needs:** transport/clock, audio input, recording

Sketch the rhythm of a verse before you have the words.

1. A beat or click plays (another module's loop, or a built-in metronome locked to the board's tempo).
2. Hit record and mumble a phonetic flow over it: "da-da da-DA, da-da-da".
3. Flow finds each syllable's start (onset detection), snaps it to the grid with adjustable swing/quantise strength, and tracks the pitch contour, so it captures melody as well as rhythm.
4. The result is a row of syllable blocks on a little timeline: position, length, accent and pitch. It loops back as a groove (your own voice, or a click per syllable) so you can hear the pocket.
5. Tap a block and type the word for it. Words fill the syllables like boxes; the original mumble can stay underneath as a guide track.

Feel: record, loop and fill in the words, all in one place. No menus.

Engine pieces it needs:
- A shared **transport**: tempo, bar position, play/stop, which every module can follow.
- **Audio input** plus a recorder (desktop Chrome first; Safari's input is fine, but its background audio isn't).
- Onset detection and pitch tracking in an AudioWorklet (YIN or similar). No network needed.
- Each syllable as data in the doc (time, length, pitch, text), so it saves, undoes and could feed a lyric sheet or a MIDI clip.

**Latency (the phone + Bluetooth problem).** You perform to what you hear, so a take arrives late by output latency (Bluetooth: ~150–250 ms on AirPods) plus input latency. It's a steady offset, so shift every recording earlier by it:
- *Calibrate:* say "ta" on 8 clicks; the mean lag is the whole chain (including human timing), saved per headphones.
- *Auto-align:* per take, search ±400 ms for the shift that best lines onsets up with the beat grid; refines the calibration with no setup.
This belongs in the shared transport/recorder, not just Flow, so every recording module is compensated.

Nice later: export the rhythm as MIDI; scale the syllables to a different tempo; "count the syllables" helper for lines you've already written.

---

## From earlier conversations

Shorter notes, to flesh out when we get to them.

- **Resample.** Record whatever the computer is playing into a sample (desktop Chrome can capture tab audio). Neutral name and look, no third-party branding.
- **Sampler / chopper.** Load a sample, warp it to tempo (Signalsmith Stretch, MIT licence), chop into pads.
- **Vocal recorder.** Record through a compressor into sections of the arrangement, punch in over a loop.
- **Arrangement.** The timeline itself as a module, so it can be any size or full screen.
- **Ask AI.** Describe a module and it's written for you (runs sandboxed, same code format as `new <name>`).
- **Kit controls.** Knob, fader, pad, XY, meter, readout, list, toggle, button: the building blocks the others are made from, each a proper parameter.

# Changelog

## 0.1.0 — 2026-10-11

First public version. Created by David Blackwood.

* Attribution: NOTICE (GPL-3.0 §7(b) author-credit term), AUTHORS.md, CITATION.cff, copyright headers, “Created by David Blackwood” on the start screen and in About.
* GitHub: user guide, issue/PR templates, CI, automatic GitHub Pages deployment, tagged-release workflow that attaches the zip and .deb.

* Two AudioWorklet decks with sample-accurate transport, micro-fades, loops, CDJ-style cue, 8 hot cues, jog wheel, pitch ±8/16/50 %, nudge, tap tempo.
* Mixer: gain, 3-band Linkwitz–Riley isolator EQ with kills, channel faders, equal-power/sharp crossfader, master, meters, clip LEDs, look-ahead limiter.
* Effects: bipolar filter, echo (beat-synced), reverb, flanger.
* Analysis worker: BPM + beat grid with confidence, key estimate (Camelot), cached waveforms; manual grid tools.
* Sync (tempo + phase, sync-lock), phase meter.
* WAV recording (streamed to disk or downloaded).
* Library: file/folder import, drag & drop, search/sort/filter, playlists, queue, recently played, missing-file detection, relink, preview on a separate output.
* Keyboard shortcuts (remappable), Web MIDI with learn/import/export.
* PWA (offline, installable, Open-with), `.deb` package, Python/Node localhost servers.
* 50 unit tests and 20 browser acceptance tests that measure the recorded master output.

### Fixed during development (covered by regression tests)

* Neutral signal path was +0.86 dB hot because `DynamicsCompressorNode` adds automatic make-up gain → replaced with a custom look-ahead limiter (E2E: “neutral path error”).
* Low-shelf EQ “kill” also cut the mids by 8.6 dB → replaced with a 3-band Linkwitz–Riley crossover EQ (E2E: “EQ low kill”).
* CUE did nothing for synthetic/touch pointer events because `setPointerCapture` threw first (E2E: “CUE”).
* Startup crash when drawing the platter before layout (E2E: “no uncaught page errors”).

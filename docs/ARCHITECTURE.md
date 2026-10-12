# Architecture and feasibility

## 1. Feasibility on a Chromebook (ChromeOS 150, x86-64)

**Verdict: feasible, with the audio engine running in ChromeOS's Chrome browser rather than inside the Linux container.**

What ChromeOS gives a DJ app:

| Capability | Inside Chrome (ChromeOS) | Inside the Linux container (Crostini) |
|---|---|---|
| Audio output | Native ChromeOS audio stack (CRAS) directly | Virtualised: container PulseAudio/PipeWire → VM → CRAS. Works, but adds buffering and can be more prone to under-runs under load |
| Latency | Browser buffer + device buffer, reported live by `baseLatency`/`outputLatency` (shown in the app); adjustable via the latency hint | Adds the VM audio path on top; expect higher and more variable latency, especially on low-end devices |
| USB MIDI controllers | Web MIDI works with class-compliant controllers, no setup | Each USB device must be shared manually (Settings → Developers → Linux → USB), one at a time |
| Music files | File pickers reach Downloads, Google Drive, USB drives, *and* Linux files | Only Linux files and folders explicitly shared with Linux |
| GPU / UI | Hardware-accelerated canvas | GPU support in the container varies by device |
| Install | No admin rights; PWA install | Linux must be enabled (blocked on some managed/school devices) |

Crostini audio playback has been supported since ChromeOS R74 and microphone capture since M84 (opt-in), and USB devices are shared one at a time — so a native Linux DJ app *can* run, but every hardware path goes through an extra virtualisation layer. The browser path avoids all of them.

## 2. The two approaches

### Approach A — Native Linux desktop app (e.g. C++/Rust + JACK/PipeWire/ALSA + Qt/GTK)

* ✅ Best possible latency on real Linux hardware; access to every Linux audio API; mature DSP libraries (Rubber Band, SoundTouch).
* ❌ On ChromeOS it runs in the VM: higher audio latency, manual USB sharing, file access limited to shared folders, Linux must be enabled.
* ❌ Large build toolchain on a Chromebook (compilers, Qt, codec libraries); ARM vs x86 builds.
* ❌ Codec licensing to manage when bundling FFmpeg.

### Approach B — Browser app / PWA (TypeScript + Web Audio + AudioWorklet)  ← **selected**

* ✅ Runs in ChromeOS's own browser: native audio path, Web MIDI, File System Access API, GPU canvas.
* ✅ Same build runs on Linux, Windows, macOS (Chrome/Edge), x86-64 **and ARM64** without recompiling.
* ✅ Codecs come from the browser (MP3, WAV, FLAC, Ogg Vorbis, Opus, AAC/M4A) — nothing to bundle or license.
* ✅ Installable, offline-capable, no admin rights.
* ❌ Stereo output only → no split headphone cue (PFL) on one device.
* ❌ No high-quality time-stretch built in (must be implemented in a worklet).
* ❌ File access requires user permission, re-confirmed by the browser after restarts.
* ❌ Needs a secure context (`https://` or `http://localhost`).

**Decision:** B as the primary edition. A native edition is not ruled out: the DSP core (`deck-kernel.ts`, `limiter-kernel.ts`, `bpm.ts`, `key.ts`) is pure, allocation-free code that ports directly to Rust or C++ if a native Linux build (for example JACK on a Raspberry Pi) is wanted later. On Linux desktops today, the `.deb` package serves the same app on localhost and opens it in the browser.

## 3. Technology stack and why

| Choice | Why |
|---|---|
| **TypeScript, no UI framework** | The UI is dominated by 60 fps canvases, meters and knobs that update outside any component tree. Direct DOM keeps per-frame work minimal on low-end Chromebooks, removes a runtime dependency (license and supply-chain surface: **zero runtime dependencies**), and the app is ~105 KB of JavaScript. React was evaluated and rejected because it adds reconciliation overhead to a UI that would mostly bypass it anyway. |
| **Web Audio API + AudioWorklet** | Each deck's transport (play, seek, rate, loop, micro-fades) runs sample-accurately on the real-time audio thread. Mixer, EQ and effects use native Web Audio nodes (C++ inside Chrome). The limiter and recorder are worklets too. |
| **Web Worker for analysis** | BPM, key and waveform analysis never block the UI or the audio thread. |
| **Browser `decodeAudioData`** | All supported codecs with no bundled decoder (no FFmpeg licensing). |
| **IndexedDB** | Library, analysis cache, playlists, cues, settings; also stores File System Access handles so files re-open after a restart. |
| **File System Access API** (fallback `<input type=file>`) | User-authorised files and folders only; no filesystem scanning. |
| **Web MIDI** (no SysEx) | Controller support with MIDI-learn. |
| **Vite 8 + Vitest 5 + TypeScript 5.9 (pinned)** | Fast reproducible builds; workers and worklets bundled as separate modules. |
| **Playwright-core + Chrome** | End-to-end acceptance tests that record and measure the real audio output. |

## 4. Audio graph

```
            ┌──────────── Deck A (AudioWorklet: DeckKernel) ────────────┐
 PCM (RAM) →│ play/pause/seek/rate/loop, 64-frame micro-fades, interp.  │
            └──────────────────────────────┬────────────────────────────┘
   trim → 3-band isolator EQ (LR4 @250 Hz / 2.5 kHz) → HPF → LPF → FX unit (dry + echo/reverb/flanger wet)
        → channel fader → crossfader gain ─┐   (post-fader channel meter)
                                           ├→ master gain → [pre-limiter meter → CLIP LED]
   Deck B … identical …  ──────────────────┘        → look-ahead limiter worklet (−1 dBFS) → master meter
                                                                         ├→ speakers (setSinkId-selectable)
                                                                         └→ recorder worklet → WAV stream to disk
```

Design rules that the tests enforce:

* **No allocation and no locks in audio callbacks** (`DeckKernel.render`, `LimiterKernel.process`, recorder accumulates into a pre-allocated buffer).
* **Every parameter change is ramped** (`setTargetAtTime`) → no zipper noise; transport changes use micro-fades → no clicks.
* **Neutral = transparent**: at default settings the signal path is bit-level unity (measured 0.00 dB error), because the limiter adds no make-up gain and the EQ crossover sums flat (< 0.001 dB analytically).
* **Analysis is never on the audio thread** and results are cached; waveforms are drawn from cached peak data, never from decoded audio.
* **Main-thread position** is extrapolated from worklet reports (every ~16 ms) using `AudioContext.currentTime`, so waveforms are smooth without cross-thread shared memory (which would need cross-origin isolation headers on every host).

## 5. Project structure

```
spindle-dj/
├── index.html                 entry (CSP: self only, no network)
├── public/                    manifest, icons, service worker (offline)
├── src/
│   ├── main.ts                boot, secure-context check, PWA launch handler
│   ├── deck.ts                DJ logic: cue, hot cues, loops, sync, grid editing
│   ├── settings.ts            persisted settings + default keymap
│   ├── audio/
│   │   ├── deck-kernel.ts     pure playback kernel (unit-tested)
│   │   ├── deck-worklet.ts    AudioWorkletProcessor wrapper
│   │   ├── limiter-kernel.ts  look-ahead limiter (unit-tested)
│   │   ├── limiter-worklet.ts
│   │   ├── recorder-worklet.ts / recorder.ts   WAV recording (streamed)
│   │   ├── engine.ts          graph, CrossoverEq, meters, output device
│   │   ├── effects.ts         filter/echo/reverb/flanger unit
│   │   ├── decode.ts          decoding, downsampling, analysis worker client
│   │   ├── mixer-math.ts / beat-math.ts / wav.ts   pure, unit-tested
│   ├── analysis/              bpm.ts, key.ts, fft.ts, waveform.ts, analysis-worker.ts
│   ├── library/               db.ts (IndexedDB), library.ts, metadata.ts (ID3/FLAC/Ogg/WAV)
│   ├── control/               actions.ts, keyboard.ts, midi.ts
│   └── ui/                    app, deck/mixer/browser/settings views, canvas renderers, styles
├── tests/unit/                Vitest: DSP, analysis, formats, MIDI (50 tests)
├── tests/e2e/run-e2e.mjs      headless-Chrome acceptance tests (20 tests, audio measured)
├── scripts/serve.mjs|.py      zero-dependency localhost servers
├── packaging/deb/             .deb builder (launcher + desktop entry)
├── .github/workflows/         CI + optional GitHub Pages deployment
└── docs/
```

## 6. Principal risks and mitigations

| Risk | Mitigation in this codebase |
|---|---|
| Audio dropouts on low-end Chromebooks | Worklet transport, native nodes for DSP, analysis in a worker, latency setting (interactive/balanced/playback), option to pause background analysis while playing, rAF loop isolated from audio |
| Browser suspends the AudioContext | Start-audio gate on first gesture; status pill shows state and resumes on click |
| Memory: whole tracks in RAM | Configurable max length (default 30 min) with a clear error showing MB required; one analysis at a time; PCM transferred (not copied) to the worklet |
| File permissions lost after restart | Handles persisted in IndexedDB; “Grant access” banner re-requests permission; missing-file detection; relink one file or a whole folder |
| Misleading analysis | Confidence stored and shown (“~”, “uncertain”, “?”), no fake values: “…” while analysing, “n/a” on failure; manual grid tools |
| Clipping | Look-ahead limiter at −1 dBFS + pre-limiter CLIP LED + per-channel clip LEDs |
| `file://` launch | Boot check with an explicit explanation of how to serve over localhost |
| Supply chain / licensing | Zero runtime dependencies; dev tools pinned; GPL-3.0-or-later; no bundled codecs or samples |
| ARM Chromebooks | Pure web app — architecture-independent |

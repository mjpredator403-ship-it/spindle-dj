# Testing

## Automated

| Suite | Command | What it covers |
|---|---|---|
| Unit (50 tests, Node) | `npm test` | Deck kernel (rate, pause, seek micro-fades, loop wrap, end of track), limiter (transparent below ceiling, never over ceiling, release), crossfader curves (equal power), knob tapers, beat/loop/sync/phase math, BPM + beat phase on synthesised audio (6 tempos, house pattern with off-beat hats, noise → low confidence), key (C/A minor/G), waveform summary, FFT, WAV writer/reader, ID3v2/FLAC/WAV metadata parsing, MIDI parsing and dispatch |
| End-to-end (20 tests, headless Chrome) | `npm run test:e2e` | Drives the real built app: imports two generated tracks, loads them through the UI, plays both, **records the master output with the app's own recorder and measures it with Goertzel filters** |

Browser for E2E: set `CHROME_PATH`, or have Chrome/Chromium at a standard path. `playwright-core` is an optional dev dependency.

### Latest results (2026-10-11, clean checkout, Chrome 141 headless, Linux x86-64)

```
Unit:  6 files, 50 passed
E2E:   20/20 passed
  ✓ audio engine starts (AudioWorklet in a secure context)          44.1 kHz
  ✓ import two tracks (metadata from filename + WAV header)
  ✓ BPM + waveform from real analysis           A 127.98 (true 128), B 123.99 (true 124)
  ✓ both decks play simultaneously and independently
  ✓ crossfader                                  full-A leak −58 dB, full-B leak −60 dB,
                                                centre −3.01/−3.00 dB, neutral path error 0.00 dB
  ✓ channel fader A does not affect B           A −12.03 dB, B −0.01 dB
  ✓ EQ low kill                                 100 Hz −32.1 dB, 440 Hz −0.9 dB, deck B −0.00 dB
  ✓ filter (low-pass)                           440 Hz −35.1 dB
  ✓ echo + reverb produce real tails after stop tail RMS: dry 0, echo 0.096, reverb 0.011
  ✓ limiter                                     peak −1.00 dBFS with everything pushed
  ✓ 4-beat loop exact (1.8753 s) and playhead stays inside
  ✓ CUE quantised set + jump-back-and-stop
  ✓ hot cue set/jump
  ✓ SYNC 124→128 BPM                            phase error 0.31 % of a beat
  ✓ corrupt file → understandable error
  ✓ playlists, cues, grid, track info persist across reload
  ✓ session-only files flagged “missing” after restart
  ✓ works offline (service worker)
  ✓ original-author credit shown in the app
  ✓ no uncaught page errors
```

`tests/e2e/last-run.json` is rewritten on every run.

## Not verified by automation (needs real hardware)

These were **not** tested in the build environment and are listed honestly:

* Audible output and real latency on an actual Chromebook (headless Chrome uses a virtual audio sink).
* Real MIDI controllers (parsing and dispatch are unit-tested; hardware is not).
* The File System Access pickers and permission prompts (headless tests import through the session-file path).
* Streaming recording to a chosen file (the in-memory download path is tested end to end).
* Output-device selection (`setSinkId`) with real multiple devices.
* PWA install flow and “Open with” file handling from the ChromeOS Files app.
* Long-session stability (hours) and very large libraries (> 10,000 tracks).

## Manual test plan (run on the target Chromebook)

| # | Steps | Expected |
|---|---|---|
| M1 | Start via `./run.sh`, open `http://localhost:8765/`, click **Start audio** | Pill shows AUDIO running with sample rate and latency |
| M2 | **+ Folder** → pick your Music folder | Tracks appear; “Analysing… N queued” counts down; BPM/Key fill in |
| M3 | Load two tracks with different tempos (drag to decks); play both | Both audible; waveforms scroll; platters turn |
| M4 | Move the crossfader slowly from A to B | Smooth blend, no level dip or jump in the middle |
| M5 | Turn each EQ knob fully left on deck A | That band disappears from A only |
| M6 | Press **SYNC** on B | B's BPM equals A's; kicks line up; phase needle centres |
| M7 | Pause B, set CUE, press PLAY, press CUE | Returns to the cue point and stops |
| M8 | Hot cues 1–4: set, jump, shift-click delete | Markers appear in both waveforms; jumps are instant |
| M9 | 4-beat loop, then ÷2 / ×2 / EXIT | Seamless loop on the beat; sizes change; exits cleanly |
| M10 | Echo/reverb/flanger on deck A with AMT and PARAM | Audible effect; echo follows tempo |
| M11 | Push gains/EQs/master to max | LIM LED lights, no distortion beyond limiting, no crackle |
| M12 | REC → choose a file → mix 2 min → STOP | WAV file plays back the mix exactly as heard |
| M13 | Create a playlist, drag tracks to it, reload page | Playlist, cues and BPMs still there; “Grant access” if asked |
| M14 | Rename a music file in the Files app, reload | Track shows *missing*; **Relink missing…** finds it |
| M15 | Enable MIDI, learn play/cue/crossfader/jog on a controller | Controls work; mapping survives reload |
| M16 | Interact heavily with the UI (scroll library, open settings) while mixing | No audio dropouts (otherwise raise the latency setting) |
| M17 | Disconnect Wi-Fi, open the installed app | App opens and plays local music |
| M18 | Keyboard only: Tab through controls; shortcuts Z/M/X/N/C/B | All reachable, focus visible, shortcuts work |

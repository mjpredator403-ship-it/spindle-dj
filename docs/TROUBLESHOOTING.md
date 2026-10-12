# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| “Spindle can't start … secure context” | You opened `index.html` from disk or via `penguin.linux.test`. Use `http://localhost:PORT/` (run `./run.sh`) or an `https://` host. |
| “AUDIO PAUSED — click to start” | Browsers start audio only after a user gesture. Click the pill or anywhere on the start screen. |
| Crackles / dropouts | Settings → Audio → Latency → *Balanced* or *Large buffer*, then reload. Turn off background analysis while playing (Settings → Mixing). Close heavy tabs. Avoid Bluetooth output. |
| A track won't load: “could not be decoded” | The browser has no decoder for that file (e.g. some ALAC/WMA files) or the file is damaged. Convert to FLAC/MP3/WAV. |
| “… is N min long; the limit is 30 min” | Tracks are decoded fully into memory. Raise the limit in Settings → Audio if your device has enough RAM (~23 MB per stereo minute). |
| Tracks show **locked** after restart | Chrome needs you to re-confirm file access. Click **Grant access** in the banner. |
| Tracks show **missing** | File moved/renamed/deleted, or it was added in a browser without the File System Access API (“session”). Right-click → **Relink file…**, or **Relink missing…** to scan a folder. |
| BPM shows “~” or “uncertain” | Low-confidence analysis (ambient, live, tempo-changing music). Use GRID → ½× / 2× / TAP / BEAT HERE. |
| SYNC says the tempo difference is too large | More than ±50 %. Sync uses half/double-time automatically where possible. |
| Wrong key | Key detection is an estimate; trust your ears. |
| MIDI: “no devices” | Plug the controller into ChromeOS (not shared into Linux). Reload after plugging in. Allow the MIDI permission. |
| Preview plays through the speakers | Choose a different **Preview output device** in Settings → Audio (requires a second output device). |
| Recording button does nothing | You cancelled the save dialog. Without the File System Access API, the recording downloads when you press STOP. |
| Port 8765 is busy | `PORT=8800 ./run.sh`, or `SPINDLE_PORT=8800 spindle-dj` for the package. |
| Reset everything | Settings → Library & data → **Reset library & settings** (does not touch your files). |

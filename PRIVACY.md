# Privacy policy — Spindle DJ

**Short version: Spindle DJ collects nothing and sends nothing.**

* **No accounts, no telemetry, no analytics, no crash reporting, no ads.**
* **No network access after loading.** Once the app's own files are loaded (from `localhost` or your chosen web host), Spindle makes no network requests. The Content-Security-Policy in `index.html` restricts connections to the app's own origin, and the code contains no remote endpoints.
* **Your music stays on your device.** Spindle reads only the files and folders you pick (or drag in). It never uploads, copies or modifies them.
* **What is stored locally**, in your browser's IndexedDB for this site on this device only: track metadata (title, artist, album, duration, format), analysis results (BPM, beat grid, key, waveform summary), cue points, playlists, settings, MIDI mappings, and the browser's file *handles* (references that let Spindle reopen a file you previously chose — not copies of the audio).
* **Recordings** are written only to the location you choose, or downloaded through the browser.
* **Permissions** (file access, MIDI, output-device selection) are requested by the browser and can be revoked at any time in Chrome's site settings.
* **Deleting your data:** Settings → Library & data → Reset, or clear site data for the Spindle address in Chrome.

If a future version adds any optional online feature, it will be off by default, explained here, and require your explicit consent.

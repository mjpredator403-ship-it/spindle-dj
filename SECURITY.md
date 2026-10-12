# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's **private vulnerability reporting** for this repository (Security tab → *Report a vulnerability*), or contact the maintainers privately. Include steps to reproduce, affected version and browser.

We aim to acknowledge reports within 7 days and to ship a fix or mitigation within 30 days for confirmed issues.

## Scope and design

* Spindle is a static client-side web app with **no server-side component** and **no runtime third-party dependencies**.
* A Content-Security-Policy restricts scripts, workers and connections to the app's own origin.
* File access is limited to user-chosen files/folders via the browser's permission model; Spindle requests read-only access.
* Metadata parsers (ID3, FLAC, Ogg, WAV) operate on untrusted file bytes with bounds checks and are wrapped so malformed tags cannot break the app; audio decoding is done by the browser.
* The local servers (`scripts/serve.mjs`, `scripts/serve.py`) bind to `127.0.0.1` only, serve a single directory, and reject path traversal.

## Supported versions

Only the latest release receives fixes.

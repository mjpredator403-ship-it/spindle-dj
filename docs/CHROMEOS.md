# Spindle DJ on a Chromebook

Tested target: ChromeOS 150 (x86-64). ARM Chromebooks work the same way (the app is architecture-independent).

**How it fits together:** Spindle runs inside ChromeOS's normal Chrome browser. The Linux container only hosts a tiny web server on `http://localhost:8765`. ChromeOS automatically tunnels Linux ports ≥ 1024 to Chrome's `localhost`, and `localhost` counts as a secure context, so audio worklets, MIDI and file access all work. Audio, MIDI and file access go through ChromeOS directly, not through the Linux VM.

## 1. Turn on Linux (one time)

1. Open **Settings → About ChromeOS → Developers → Linux development environment → Set up**.
2. Accept the defaults (10 GB is plenty) and wait for the **Terminal** to open.

> On some school or work Chromebooks your administrator may have disabled Linux. Then use the *hosted* option in section 6.

## 2. Install and run

**Option A — release zip (no Node.js needed).** Download `spindle-dj-0.1.0.zip`, drag it into **Linux files** in the Files app, then in Terminal:

```bash
sudo apt-get update && sudo apt-get install -y unzip python3
unzip spindle-dj-0.1.0.zip
cd spindle-dj
./run.sh
```

**Option B — Debian package (adds a launcher icon).**

```bash
sudo apt install ./spindle-dj_0.1.0_all.deb
spindle-dj
```

`spindle-dj` starts the server in the background and opens Chrome at the right address. You can also start it from the Launcher → Linux apps → **Spindle DJ**.

Then open **http://localhost:8765/** in Chrome (if it did not open automatically) and click **Start audio**.

> Use `localhost`, not `penguin.linux.test`. The latter is not a secure context, so the audio engine would refuse to start.

## 3. Install as an app (optional, recommended)

In Chrome, open the ⋮ menu → **Cast, save and share → Install page as app** (wording varies by version; you may also see an install icon in the address bar). You get:

* a Spindle window without browser toolbars (more room for the decks),
* a launcher icon,
* offline use. The server only needs to be running the first time; after that, the installed app loads from its offline cache.
* **Open with → Spindle DJ** for audio files in the Files app.

## 4. Give Spindle your music

* Click **+ Folder** and choose your music folder (for example **My files → Music**, a USB drive or SD card, or a Google Drive folder). Chrome asks *“Let site view files?”* → **View files**. Spindle only reads; it never modifies or uploads files.
* Or click **+ Files**, or drag files from the Files app onto the library or straight onto a deck.
* After a restart Chrome may ask you to re-confirm access; click **Grant access** in the yellow banner. On recent Chrome you can choose **Allow on every visit**.
* Music does **not** need to be in Linux files. Keeping it in **My files** is fine, because Spindle reads it through Chrome, not through Linux.

## 5. Audio check and troubleshooting

* The top-left pill shows **AUDIO 48.0 kHz · NN ms** when the engine is running. If it says **AUDIO PAUSED**, click it (browsers start audio only after a click).
* **Settings → Audio** shows sample rate and latency, lets you choose the output device and the preview (headphones) device, and set the buffer size:
  * *Low latency* is the default. If you hear crackles, choose *Balanced* or *Large buffer* and reload.
  * Also try **Settings → Mixing → Analyse library in the background while playing → off**.
* No sound at all:
  1. Check the ChromeOS volume and output in Quick Settings (bottom-right). Bluetooth speakers add noticeable delay; prefer wired or USB.
  2. Reload the page. If another tab has the same app open, close it.
  3. Make sure you are on `http://localhost:8765/`, not a `file://` path.
* **Headphone pre-listen:** plug in USB or 3.5 mm headphones *and* use another output for the master (for example HDMI or USB speakers). Then set **Preview output device** to the headphones. ChromeOS routes most devices as a single “active” output, so this needs two separately listed devices.

## 6. No Linux? Host it instead

The production build is static files. Any HTTPS static host works (GitHub Pages: push the repo and enable the included `deploy-pages` workflow). Open the `https://…` address in Chrome and install it as an app. No server is needed after that.

## 7. MIDI controllers

Plug a class-compliant USB DJ controller into the Chromebook (**do not** share it with Linux in Settings). Open **Settings → MIDI → Enable MIDI**. Chrome asks for permission; allow it. Then click **Learn** next to an action and move the control. Export your mapping to keep a backup.

## 8. Developing on the Chromebook

Vite 8 needs **Node.js ≥ 20.19**. Check with `node -v`; Debian's package may be older. Install with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
cd spindle-dj && npm ci && npm run dev     # http://localhost:5173/
```

The browser tests (`npm run test:e2e`) need a Chrome inside Linux; set `CHROME_PATH` to it, or run them on a regular Linux PC or in CI.

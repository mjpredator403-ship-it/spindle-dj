# Spindle DJ: User Guide

*Spindle DJ was created by David Blackwood. This guide is for people who want to mix music; developers should read the [README](../README.md) and [CONTRIBUTING](../CONTRIBUTING.md).*

## 1. Install or open Spindle

Choose **one** of these options.

| Your computer | Easiest way |
|---|---|
| **Any computer with Chrome or Edge** (Windows, Mac, Chromebook, Linux) | Open the project's web address (see the README's “Use it now” link). Click **Install** in the address bar, or Chrome menu → *Cast, save and share → Install page as app*. Works offline after the first visit. |
| **Chromebook, offline/local copy** | Download `spindle-dj-<version>.zip` from the **Releases** page, put it in *Linux files*, then in Terminal run `unzip spindle-dj-*.zip && cd spindle-dj && ./run.sh`. Open **http://localhost:8765/** in Chrome. Details: [CHROMEOS.md](CHROMEOS.md). |
| **Debian / Ubuntu / Linux Mint** | Download the `.deb` from **Releases**, run `sudo apt install ./spindle-dj_*_all.deb`, then start **Spindle DJ** from your app menu. |
| **Windows, local copy (WSL)** | Download the zip from Releases. In Ubuntu (WSL) run `sudo apt install -y unzip python3`, then `cd ~ && unzip /mnt/c/Users/YOURNAME/Downloads/spindle-dj-*.zip && cd spindle-dj && ./run.sh`. Open **http://localhost:8765/** in Chrome or Edge. (A one-click Windows installer is planned.) |

The first time, click **Start audio**. Browsers only allow sound after a click.

> Use Chrome or Microsoft Edge. Firefox and Safari lack some features Spindle needs (MIDI, folder access).

## 2. Add your music

* **+ Folder** adds a whole folder of music, including subfolders.
* **+ Files** adds individual songs.
* You can also **drag** audio files from your file manager onto the library or straight onto a deck.

Supported formats: MP3, WAV, FLAC, OGG, Opus, M4A/AAC (whatever your browser can play). Spindle only *reads* your files. It never uploads, changes or deletes them.

After you add music, Spindle analyses each track in the background (“Analysing… N queued”) to find its **BPM** (tempo), **beat grid** and **key**. A `~` in front of a BPM means the analysis is unsure.

## 3. The screen

```
┌ top bar: audio status · REC · MIDI · layout (BOTH / DECKS / LIBRARY) · ? · ⚙ ┐
│ scrolling waveforms: deck A (blue), deck B (orange)                          │
│ ┌ DECK A ───────────┐ ┌ MIXER ┐ ┌ DECK B ───────────┐                        │
│ │ title, BPM, key   │ │ GAIN  │ │                   │                        │
│ │ overview waveform │ │ HI    │ │                   │                        │
│ │ jog │ hot cues    │ │ MID   │ │ hot cues │ jog    │                        │
│ │     │ loops / FX  │ │ LOW   │ │ loops/FX │        │                        │
│ │ CUE  PLAY  ■ SYNC │ │faders │ │ CUE PLAY ■ SYNC   │                        │
│ └───────────────────┘ └ X-fader┘ └───────────────────┘                       │
│ library: search · playlists · tracks · preview player                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

On small screens, use **DECKS** (bigger controls) or **LIBRARY** (bigger track list) at the top.

## 4. Your first mix in 8 steps

1. **Load** a track on deck A: drag it onto the deck, or click the **A** button in its row (**B** for deck B). Double-clicking a row loads it on whichever deck is stopped.
2. Press **PLAY** on deck A and set the **crossfader** (bottom of the mixer) fully left.
3. Load the next track on deck B. Press **SYNC** on deck B. Its tempo now matches deck A, and its beats line up when it plays.
4. Press **PLAY** on deck B. Listen with the crossfader still left. If you have headphones on a second output, use the library's **preview** player instead (see section 8).
5. Turn deck B's **LOW** EQ knob fully left (“kill”) so the two basslines don't clash.
6. Slowly move the **crossfader** to the middle.
7. Swap the bass: turn deck A's **LOW** down while bringing deck B's **LOW** back to the middle.
8. Move the crossfader fully right. Deck B is now playing alone; load the next track on deck A.

**Watch the meters.** If the **CLIP** light flashes, turn something down. The **LIM** light means Spindle is protecting your speakers from distortion.

## 5. Deck controls

| Control | What it does |
|---|---|
| **PLAY** | Play/pause. |
| **CUE** | Stopped: sets the cue point here. Hold it on the cue point to preview. Playing: jumps back to the cue point and stops. |
| **■** | Stop and go back to the start. |
| **SYNC** | Match tempo and beats to the other deck. Click again to release. |
| **1–8 (hot cues)** | Click an empty pad to save the current spot; click a set pad to jump there. Shift-click or right-click deletes it. |
| **½ 1 2 4 8 16** | Loop that many beats, starting on the beat. Click again to exit. |
| **IN / OUT / EXIT** | Make a loop by hand; EXIT leaves it (RELOOP re-enters). **÷2 / ×2** halve or double the loop. |
| **Pitch fader** | Speeds the track up or down (up = slower, like DJ hardware). **±8%** changes the range. **− / +** nudge (hold); **0** resets. |
| **Jog wheel** | Drag around it: while playing, it nudges the beat; while stopped, it scrubs. |
| **Overview waveform** | Click or drag to jump anywhere. |
| **FILTER** | Left = muffled (low-pass), right = thin (high-pass), middle = off. |
| **FX** | Choose Echo, Reverb or Flanger, press **FX** to turn it on, **AMT** = how much, **PARAM** = echo time / reverb tone / flanger speed. |
| **GRID** | Fix a wrong BPM: **½× / 2×** (half/double), **◀ ▶** shift beats, **BEAT HERE** (put a beat at the playhead), **TAP** along with the beat. |
| **LOAD / ⏏** | Load the selected library track / eject. |

Speed changes also change pitch, like a record. Keeping the key steady while changing speed (“key lock”) is planned for a future version.

## 6. Mixer

* **GAIN**: matches loud and quiet tracks. **HI / MID / LOW**: tone; fully left removes that range completely. Double-click any knob to reset it.
* **Channel faders**: volume of each deck. The meters beside them show the level.
* **Crossfader**: blends A and B. The small **⌒ / ⊓** button switches between a smooth blend and a sharp cut (for scratching).
* **MASTER**: overall volume. The phase bar shows whether the beats of A and B are aligned (green = locked).

## 7. Library, playlists and the queue

* **Search** filters as you type; click column headers to sort; the filter menu shows tracks still being analysed.
* **Playlists**: click **+** next to *Playlists*, then drag tracks onto the playlist name, or right-click a track → *Add to …*.
* **Queue**: right-click → *Add to Queue* to line up what's next.
* **Missing files**: if you move or rename music, those tracks show *missing*. Right-click → **Relink file…**, or **Relink missing…** to search a whole folder.
* After restarting the computer, the browser may ask you to allow access again. Click **Grant access** in the yellow banner.

## 8. Recording and headphones

* **● REC** (or the **R** key) records exactly what comes out of the master. In Chrome you choose where to save the WAV file, and it is written as you play. Press **■ STOP** to finish.
* **Headphone preview**: in ⚙ **Settings → Audio**, set *Preview output device* to your headphones (you need a second audio device, such as USB headphones). Right-click a track → **Preview** to hear it without touching the decks.

## 9. Keyboard and DJ controllers

Default keys: deck A **Z** play, **X** cue, **C** sync; deck B **M** play, **N** cue, **B** sync; **←/→** crossfader; **R** record; **/** search. Press **?** for the full list; change them in ⚙ **Settings → Keyboard**.

**MIDI controller:** plug it in, go to ⚙ **Settings → MIDI → Enable MIDI**, click **Learn** next to an action and move the knob or press the button. Use **Export mapping** to back up your setup or share it with others.

## 10. If something goes wrong

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md). The most common fixes:

* **No sound:** click the **AUDIO** pill at the top left; check your system volume and output device.
* **Crackling:** ⚙ Settings → Audio → choose *Balanced* or *Large buffer*, then reload.
* **“Can't start … secure context”:** open it from `http://localhost:…` or the https web address, not by double-clicking `index.html`.

## Privacy

Spindle has no accounts, ads or tracking, and makes no internet connections after it loads. Your music never leaves your computer. See [PRIVACY.md](../PRIVACY.md).

---
Spindle DJ, created by David Blackwood. Free software under the GNU GPL v3.0 or later.

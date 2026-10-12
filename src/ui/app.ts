// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Application shell: top bar, scrolling waveforms, decks, mixer, library,
// background analysis, recording, drag & drop, keyboard + MIDI wiring.

import { Engine } from '../audio/engine';
import { MixRecorder } from '../audio/recorder';
import { analyzeMono, decodeFile, toAnalysisMono } from '../audio/decode';
import { applyAnalysis, Deck } from '../deck';
import { Library, type Track } from '../library/library';
import { isSupportedName } from '../library/metadata';
import { Settings } from '../settings';
import { buildActions } from '../control/actions';
import { installKeyboard } from '../control/keyboard';
import { MidiController } from '../control/midi';
import { BrowserView, TRACK_MIME } from './browser-view';
import { DeckView } from './deck-view';
import { MixerView } from './mixer-view';
import { SettingsView } from './settings-view';
import { drawScrolling, DECK_COLORS } from './waveform-view';
import { fmtTime, h, setText, toast, toggleClass, safeCapture } from './dom';
import { CREDIT_LINE } from '../credits';

export class App {
  readonly decks: [Deck, Deck];
  readonly recorder: MixRecorder;
  readonly browser: BrowserView;
  private deckViews: DeckView[];
  private mixer: MixerView;
  private knobs = new Map<string, (v: number) => void>();
  private waves: HTMLCanvasElement[];
  private statusPill = h('button', { class: 'pill', title: 'Audio engine status — click to resume audio' });
  private recBtn: HTMLButtonElement;
  private recTime = h('span', { class: 'rec-time' });
  private midiPill = h('button', { class: 'pill', title: 'MIDI controller status' });
  private analysisPill = h('span', { class: 'pill quiet', title: 'Background analysis' });
  private settingsView: SettingsView;
  private midi: MidiController;
  private analysing = false;
  root: HTMLElement;

  constructor(readonly engine: Engine, readonly lib: Library, readonly settings: Settings) {
    this.decks = [new Deck(0, engine.decks[0], lib, settings), new Deck(1, engine.decks[1], lib, settings)];
    for (const d of this.decks) {
      d.onMessage = (m, k) => toast(m, k);
      d.onTempoChange = () => this.decks[1 - d.index].follow(d);
    }
    engine.setCrossfader(0.5, settings.get('xfadeCurve'));

    this.recorder = new MixRecorder(engine, {
      onState: () => this.renderRec(),
      onError: (m) => toast(m, 'error', 8000),
      onDone: (r) => {
        if (r.blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(r.blob);
          a.download = r.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        }
        toast(`Recording saved: ${r.name} (${fmtTime(r.seconds, false)}, ${(r.bytes / 1e6).toFixed(1)} MB)${r.peak >= 0.999 ? ' — note: it reached full scale.' : ''}`, 'info', 8000);
      },
    });

    const registerKnob = (id: string, set: (v: number) => void) => this.knobs.set(id, set);
    const deckHost = {
      other: (d: Deck) => this.decks[1 - d.index],
      onDropTrack: (d: Deck, e: DragEvent) => void this.handleDeckDrop(d, e),
      pickAndLoad: (d: Deck) => {
        const t = this.browser.selectedTrack();
        if (t) this.loadToDeck(d, t);
        else toast('Select a track in the library first (or drag one onto the deck).', 'warn');
      },
      registerKnob,
    };
    this.deckViews = this.decks.map((d) => new DeckView(d, deckHost));
    this.mixer = new MixerView(engine, this.decks, settings, registerKnob);
    this.browser = new BrowserView(lib, {
      decks: this.decks,
      loadToDeck: (d, t) => this.loadToDeck(d, t),
      analyzeNow: (t) => {
        t.analysisStatus = 'pending';
        void lib.save(t).then(() => this.kickAnalysis());
      },
      importFiles: () => void this.importFiles(),
      importFolder: () => void this.importFolder(),
    }, settings);

    const actions = buildActions({
      decks: this.decks,
      engine,
      settings,
      ui: {
        setKnob: (id, v) => this.knobs.get(id)?.(v),
        toggleRecord: () => void this.toggleRecord(),
        focusSearch: () => this.browser.focusSearch(),
      },
    });
    installKeyboard(actions, settings);
    this.midi = new MidiController(actions, settings);
    this.midi.onChange = () => this.renderMidi();
    this.settingsView = new SettingsView({ engine, settings, actions, midi: this.midi, applyPreviewDevice: () => void this.browser.applyPreviewDevice() });

    // ---- layout
    this.waves = this.decks.map((d) => {
      const c = h('canvas', { class: 'wave', 'aria-label': `Deck ${d.name} scrolling waveform` }) as HTMLCanvasElement;
      c.style.setProperty('--deck', DECK_COLORS[d.index]);
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const z = Math.max(2, Math.min(30, settings.get('waveZoom') + Math.sign(e.deltaY)));
        settings.set('waveZoom', z);
      }, { passive: false });
      let dragX: number | null = null;
      c.addEventListener('pointerdown', (e) => {
        dragX = e.clientX;
        safeCapture(c, e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        if (dragX === null || d.playing || !d.loaded) return;
        const dx = e.clientX - dragX;
        dragX = e.clientX;
        d.seek(d.position() - (dx / c.clientWidth) * settings.get('waveZoom'));
      });
      c.addEventListener('pointerup', () => (dragX = null));
      return c;
    });

    this.recBtn = h('button', { class: 'rec', title: 'Record the master output to a WAV file (R)', onclick: () => void this.toggleRecord() }, '● REC') as HTMLButtonElement;
    const recPause = h('button', { class: 'sm', title: 'Pause/resume recording', onclick: () => (this.recorder.state === 'paused' ? this.recorder.resume() : this.recorder.pause()) }, '❚❚');
    const layoutBtns = (['full', 'decks', 'library'] as const).map((l) =>
      h('button', { class: 'sm lay', 'data-l': l, title: l === 'full' ? 'Decks + library' : l === 'decks' ? 'Performance view (decks only)' : 'Library focus', onclick: () => this.setLayout(l) }, l === 'full' ? 'BOTH' : l === 'decks' ? 'DECKS' : 'LIBRARY'),
    );
    this.statusPill.addEventListener('click', () => void engine.resume());
    this.midiPill.addEventListener('click', () => this.settingsView.open('midi'));

    const top = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'logo', 'aria-label': 'Spindle DJ', title: `Spindle DJ — ${CREDIT_LINE}` }, h('span', { class: 'logo-mark' }), 'SPINDLE'),
      this.statusPill,
      this.analysisPill,
      h('div', { class: 'spacer' }),
      h('div', { class: 'rec-group' }, this.recBtn, recPause, this.recTime),
      this.midiPill,
      h('div', { class: 'layouts', role: 'group', 'aria-label': 'Layout' }, ...layoutBtns),
      h('button', { class: 'sm', title: 'Keyboard shortcuts & help', onclick: () => this.showHelp() }, '?'),
      h('button', { class: 'sm', title: 'Settings', 'aria-label': 'Settings', onclick: () => this.settingsView.open() }, '⚙'),
    );
    this.root = h(
      'div',
      { class: 'app' },
      top,
      h('div', { class: 'waves' }, ...this.waves),
      h('main', { class: 'stage' }, this.deckViews[0].el, this.mixer.el, this.deckViews[1].el),
      this.browser.el,
    );
    this.setLayout(settings.get('layout'));

    // global drop = import
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      void this.importDropped(e.dataTransfer).then((ts) => ts.length && toast(`Imported ${ts.length} track(s).`));
    });

    engine.onStateChange = () => this.renderStatus();
    lib.onChange(() => this.kickAnalysis());
    for (const d of this.decks) d.on(() => this.kickAnalysis());
    this.renderStatus();
    this.renderRec();
    this.renderMidi();
    setInterval(() => this.renderAnalysisPill(), 1000);
    this.loop();
  }

  private renderAnalysisPill() {
    let left = 0,
      running = false;
    for (const t of this.lib.tracks.values()) {
      if (t.analysisStatus === 'analyzing') running = true;
      else if (t.analysisStatus === 'pending' && this.lib.status.get(t.id) !== 'missing' && !this.decks.some((d) => d.track === t)) left++;
    }
    const paused = left > 0 && !this.analysing && this.decks.some((d) => d.playing) && !this.settings.get('analyzeWhilePlaying');
    const txt = running || left ? `Analysing… ${left} queued${paused ? ' (paused while playing)' : ''}` : '';
    setText(this.analysisPill, txt);
    this.analysisPill.hidden = !txt;
    if (left && !this.analysing) this.kickAnalysis(); // resume after decks stop
  }

  private setLayout(l: 'full' | 'decks' | 'library') {
    this.settings.set('layout', l);
    this.root.dataset.layout = l;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.lay')) toggleClass(b, 'on', b.dataset.l === l);
  }

  // ------------------------------------------------------------------ loading
  loadToDeck(d: Deck, t: Track) {
    if (d.playing && !confirm(`Deck ${d.name} is playing. Load "${t.title}" anyway?`)) return;
    void d.load(t);
  }

  private async handleDeckDrop(d: Deck, e: DragEvent) {
    const dt = e.dataTransfer;
    if (!dt) return;
    const ids = dt.getData(TRACK_MIME);
    if (ids) {
      const t = this.lib.tracks.get(ids.split(',')[0]);
      if (t) this.loadToDeck(d, t);
      return;
    }
    const tracks = await this.importDropped(dt);
    if (tracks[0]) this.loadToDeck(d, tracks[0]);
  }

  /** Import files dropped from the OS. Uses persistent handles when Chrome provides them. */
  private async importDropped(dt: DataTransfer): Promise<Track[]> {
    const out: Track[] = [];
    const items = [...dt.items].filter((i) => i.kind === 'file');
    const withHandles = items.length && 'getAsFileSystemHandle' in DataTransferItem.prototype;
    if (withHandles) {
      const handles = await Promise.all(items.map((i) => (i as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle()));
      for (const hd of handles) {
        if (hd?.kind === 'file' && isSupportedName(hd.name)) {
          const fh = hd as FileSystemFileHandle;
          const t = await this.lib.addFile(await fh.getFile(), fh);
          if (t) out.push(t);
        }
      }
    } else {
      for (const f of [...dt.files]) {
        const t = await this.lib.addFile(f);
        if (t) out.push(t);
      }
    }
    if (!out.length && items.length) toast('No supported audio files in that drop (MP3, WAV, FLAC, OGG, OPUS, M4A, AAC, AIFF).', 'warn');
    this.lib.notify();
    return out;
  }

  private async importFiles() {
    try {
      const n = await this.lib.importFiles();
      if (n) toast(`Imported ${n} track(s). Analysing in the background…`);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  }
  private async importFolder() {
    try {
      const n = await this.lib.importFolder((k) => setText(this.analysisPill, `Scanning… ${k}`));
      toast(n ? `Imported ${n} track(s) from the folder.` : 'No supported audio files were found in that folder.');
    } catch (e) {
      toast(`Folder import failed: ${(e as Error).message}`, 'error');
    }
  }

  // --------------------------------------------------------- background analysis
  kickAnalysis() {
    if (this.analysing) return;
    void this.analysisLoop();
  }
  private async analysisLoop() {
    this.analysing = true;
    try {
      for (;;) {
        const busy = this.decks.some((d) => d.playing) && !this.settings.get('analyzeWhilePlaying');
        const loading = this.decks.some((d) => d.loading);
        const next = [...this.lib.tracks.values()].find((t) => t.analysisStatus === 'pending' && this.lib.status.get(t.id) !== 'missing' && this.lib.status.get(t.id) !== 'needs-permission' && !this.decks.some((d) => d.track === t));
        if (!next || busy || loading) break;
        next.analysisStatus = 'analyzing';
        this.lib.notify();
        try {
          const f = await this.lib.getFile(next);
          const buf = await decodeFile(this.engine.ctx, f, this.settings.get('maxTrackMinutes'));
          next.durationSec = buf.duration;
          const mono = await toAnalysisMono(buf);
          const r = await analyzeMono(next.id, mono);
          await applyAnalysis(this.lib, next, r);
        } catch (e) {
          next.analysisStatus = 'failed';
          next.analysisError = (e as Error).message;
          await this.lib.save(next);
        }
        for (const d of this.decks) if (d.track === next) await d.refreshWave();
        await new Promise((r) => setTimeout(r, 30)); // yield
      }
    } finally {
      this.analysing = false;
    }
  }

  // ------------------------------------------------------------------ recording
  private async toggleRecord() {
    if (this.recorder.state === 'idle') {
      await this.engine.resume();
      await this.recorder.start();
    } else if (this.recorder.state === 'recording' || this.recorder.state === 'paused') await this.recorder.stop();
  }
  private renderRec() {
    const s = this.recorder.state;
    toggleClass(this.recBtn, 'on', s === 'recording');
    toggleClass(this.recBtn, 'paused', s === 'paused');
    setText(this.recBtn, s === 'idle' ? '● REC' : s === 'finalizing' ? 'SAVING…' : '■ STOP');
    this.recBtn.disabled = s === 'finalizing';
    (this.recBtn.nextElementSibling as HTMLButtonElement).disabled = s === 'idle' || s === 'finalizing';
  }

  private renderStatus() {
    const st = this.engine.status();
    const ok = st.state === 'running';
    setText(this.statusPill, ok ? `● AUDIO ${(st.sampleRate / 1000).toFixed(1)} kHz · ${Math.round(st.baseLatencyMs + st.outputLatencyMs)} ms` : st.state === 'suspended' ? '● AUDIO PAUSED — click to start' : `● AUDIO ${st.state.toUpperCase()}`);
    toggleClass(this.statusPill, 'ok', ok);
    toggleClass(this.statusPill, 'warn', !ok);
  }
  private renderMidi() {
    const s = this.midi.status;
    setText(this.midiPill, s === 'ready' ? `MIDI: ${this.midi.inputs.length || 'no'} device${this.midi.inputs.length === 1 ? '' : 's'}` : s === 'unsupported' ? 'MIDI: n/a' : s === 'denied' ? 'MIDI: blocked' : 'MIDI: off');
    toggleClass(this.midiPill, 'ok', s === 'ready' && this.midi.inputs.length > 0);
  }

  private showHelp() {
    const km = this.settings.get('keymap');
    const rows = Object.entries(km).map(([code, id]) => h('tr', {}, h('td', {}, h('kbd', {}, code.replace(/^Key|^Digit/, ''))), h('td', {}, id)));
    const d = h(
      'dialog',
      { class: 'settings help' },
      h('div', { class: 'set-head' }, h('h2', {}, 'Quick help'), h('button', { class: 'sm', onclick: () => d.close() }, '✕')),
      h(
        'div',
        { class: 'set-body' },
        h('p', {}, '1. Add music with “+ Files” / “+ Folder” or drag files from the Files app. 2. Load tracks onto deck A and B (drag, double-click, or the A/B buttons). 3. Press PLAY, use SYNC to match tempo and phase, and blend with the crossfader.'),
        h('p', { class: 'muted' }, 'CUE: while stopped, sets the cue point (hold on the cue point to preview). While playing, jumps back and stops. Hot cues: click to set, click again to jump, shift/right-click to delete.'),
        h('table', { class: 'keys' }, ...rows),
        h('p', { class: 'muted' }, 'Change shortcuts in Settings → Keyboard.'),
        h('p', { class: 'muted' }, `Spindle DJ — ${CREDIT_LINE}. Free software (GPL-3.0-or-later).`),
      ),
    ) as HTMLDialogElement;
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  // --------------------------------------------------------------- frame loop
  private loop = () => {
    requestAnimationFrame(this.loop);
    try {
      this.frame();
    } catch (e) {
      // never let a drawing error kill the UI loop (audio runs independently)
      console.error(e);
    }
  };

  private frame() {
    const zoom = this.settings.get('waveZoom');
    if (this.root.dataset.layout !== 'library') {
      this.decks.forEach((d, i) => drawScrolling(this.waves[i], d, zoom));
      for (const v of this.deckViews) v.frame();
    }
    this.mixer.frame();
    if (this.recorder.state !== 'idle') setText(this.recTime, fmtTime(this.recorder.seconds, false));
    else setText(this.recTime, '');
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import type { Deck } from '../deck';
import { PITCH_RANGES } from '../deck';
import { beatIndexAt } from '../audio/beat-math';
import { EFFECT_LABELS, EFFECT_TYPES, type EffectType } from '../audio/effects';
import { fader, fmtTime, h, Knob, setText, toggleClass, safeCapture } from './dom';
import { Platter } from './platter';
import { drawOverview, DECK_COLORS, HOT_COLORS } from './waveform-view';

export interface DeckViewHost {
  other(deck: Deck): Deck;
  onDropTrack(deck: Deck, e: DragEvent): void;
  pickAndLoad(deck: Deck): void;
  registerKnob(id: string, set: (v: number) => void): void;
}

export class DeckView {
  readonly el: HTMLElement;
  private title = h('div', { class: 'd-title' });
  private artist = h('div', { class: 'd-artist' });
  private bpm = h('div', { class: 'd-bpm', title: 'Effective BPM (track BPM × pitch)' });
  private bpmSub = h('div', { class: 'd-bpm-sub' });
  private key = h('div', { class: 'd-key' });
  private elapsed = h('span', { class: 'd-time' });
  private remain = h('span', { class: 'd-time remain' });
  private beats: HTMLElement[] = [];
  private overview = h('canvas', { class: 'overview', 'aria-label': 'Track overview — click or drag to seek' }) as HTMLCanvasElement;
  private platter: Platter;
  private pitchFader: HTMLInputElement;
  private pitchVal = h('div', { class: 'pitch-val' });
  private rangeBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private cueBtn: HTMLButtonElement;
  private syncBtn: HTMLButtonElement;
  private hotBtns: HTMLButtonElement[] = [];
  private loopBtns = new Map<number, HTMLButtonElement>();
  private loopInBtn: HTMLButtonElement;
  private loopOutBtn: HTMLButtonElement;
  private loopExitBtn: HTMLButtonElement;
  private fxBtn: HTMLButtonElement;
  private fxParamKnob: Knob;
  private status = h('div', { class: 'd-status', role: 'status' });
  private taps: number[] = [];

  constructor(private deck: Deck, host: DeckViewHost) {
    const p = deck.index === 0 ? 'a' : 'b';
    const color = DECK_COLORS[deck.index];
    for (let i = 0; i < 4; i++) this.beats.push(h('i', { class: 'beat' }));

    // ---- overview seek
    let seeking = false;
    const seekTo = (e: PointerEvent) => {
      if (!deck.loaded) return;
      const r = this.overview.getBoundingClientRect();
      deck.seek(((e.clientX - r.left) / r.width) * deck.duration);
    };
    this.overview.addEventListener('pointerdown', (e) => {
      seeking = true;
      safeCapture(this.overview, e.pointerId);
      seekTo(e);
    });
    this.overview.addEventListener('pointermove', (e) => seeking && seekTo(e));
    this.overview.addEventListener('pointerup', () => (seeking = false));

    this.platter = new Platter(deck);

    // ---- pitch
    this.pitchFader = fader({
      label: `Deck ${deck.name} pitch`,
      value: 0.5,
      vertical: true,
      className: 'pitch',
      def: 0.5,
      step: 0.0005,
      onInput: (v) => deck.setPitch((0.5 - v) * 2 * deck.pitchRange), // up = slower (DJ convention: + at the bottom)
    });
    host.registerKnob(`${p}.pitch`, (v) => (this.pitchFader.value = String(1 - v)));
    this.rangeBtn = h('button', { class: 'sm', title: 'Pitch range', onclick: () => this.cycleRange() }) as HTMLButtonElement;
    const nudge = (dir: number, label: string) => {
      const b = h('button', { class: 'sm', 'aria-label': `Nudge ${dir < 0 ? 'slower' : 'faster'} (hold)`, title: `Nudge ${dir < 0 ? 'slower' : 'faster'} — hold` }, label) as HTMLButtonElement;
      b.addEventListener('pointerdown', () => deck.setBend(0.04 * dir));
      const up = () => deck.setBend(0);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    const pitchCol = h(
      'div',
      { class: 'pitch-col' },
      this.rangeBtn,
      this.pitchFader,
      this.pitchVal,
      h(
        'div',
        { class: 'pitch-btns' },
        nudge(-1, '−'),
        h('button', { class: 'sm', title: 'Reset pitch to 0', 'aria-label': 'Reset pitch', onclick: () => { deck.setPitch(0); this.pitchFader.value = '0.5'; } }, '0'),
        nudge(1, '+'),
      ),
    );

    // ---- hot cues
    const hot = h('div', { class: 'hotcues', role: 'group', 'aria-label': 'Hot cues' });
    for (let i = 0; i < 8; i++) {
      const b = h(
        'button',
        {
          class: 'hot',
          title: `Hot cue ${i + 1}: click to set / jump. Shift-click or right-click to delete.`,
          'aria-label': `Hot cue ${i + 1}`,
        },
        String(i + 1),
      ) as HTMLButtonElement;
      b.style.setProperty('--hc', HOT_COLORS[i]);
      b.addEventListener('click', (e) => (e.shiftKey ? deck.deleteHotCue(i) : deck.hotCue(i)));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        deck.deleteHotCue(i);
      });
      this.hotBtns.push(b);
      hot.append(b);
    }

    // ---- loops
    const loops = h('div', { class: 'loops', role: 'group', 'aria-label': 'Loops' });
    for (const s of [0.5, 1, 2, 4, 8, 16]) {
      const b = h('button', { class: 'loop', title: `${s}-beat loop (quantised to the beat grid)`, onclick: () => deck.beatLoop(s) }, s === 0.5 ? '½' : String(s)) as HTMLButtonElement;
      this.loopBtns.set(s, b);
      loops.append(b);
    }
    this.loopInBtn = h('button', { class: 'loop', title: 'Loop in', onclick: () => deck.loopIn() }, 'IN') as HTMLButtonElement;
    this.loopOutBtn = h('button', { class: 'loop', title: 'Loop out (activates the loop)', onclick: () => deck.loopOut() }, 'OUT') as HTMLButtonElement;
    this.loopExitBtn = h('button', { class: 'loop', title: 'Exit loop / Reloop', onclick: () => (deck.loop?.on ? deck.exitLoop() : deck.reloop()) }, 'EXIT') as HTMLButtonElement;
    loops.append(
      this.loopInBtn,
      this.loopOutBtn,
      this.loopExitBtn,
      h('button', { class: 'loop', title: 'Halve loop', onclick: () => deck.resizeLoop(0.5) }, '÷2'),
      h('button', { class: 'loop', title: 'Double loop', onclick: () => deck.resizeLoop(2) }, '×2'),
    );

    // ---- FX
    const filter = new Knob({
      label: 'FILTER',
      value: 0.5,
      def: 0.5,
      bipolar: true,
      size: 30,
      color,
      title: 'Filter: left = low-pass, right = high-pass, centre = off. Double-click to reset.',
      format: (v) => (Math.abs(v - 0.5) < 0.015 ? 'off' : v < 0.5 ? 'LP' : 'HP'),
      onInput: (v) => deck.ch.setFilter(v * 2 - 1),
    });
    host.registerKnob(`${p}.filter`, (v) => filter.set(v));
    const fxSel = h('select', { class: 'fx-sel', 'aria-label': `Deck ${deck.name} effect` }, ...EFFECT_TYPES.map((t) => h('option', { value: t }, EFFECT_LABELS[t]))) as HTMLSelectElement;
    fxSel.addEventListener('change', () => {
      deck.ch.fx.setType(fxSel.value as EffectType);
      this.fxParamKnob.set(deck.ch.fx.param);
    });
    this.fxBtn = h('button', { class: 'fx-on', title: 'Effect on/off', onclick: () => { deck.ch.fx.setEnabled(!deck.ch.fx.enabled); deck.emit(); } }, 'FX') as HTMLButtonElement;
    const amt = new Knob({ label: 'AMT', value: 0.5, def: 0.5, size: 30, color, title: 'Effect amount (wet level)', onInput: (v) => deck.ch.fx.setAmount(v) });
    host.registerKnob(`${p}.fxAmount`, (v) => amt.set(v));
    this.fxParamKnob = new Knob({
      label: 'PARAM',
      value: 0.5,
      def: 0.5,
      size: 30,
      color,
      title: 'Effect parameter: echo time (beat-synced when BPM is known), reverb tone, flanger rate',
      format: () => deck.ch.fx.paramLabel(),
      onInput: (v) => deck.ch.fx.setParam(v),
    });
    host.registerKnob(`${p}.fxParam`, (v) => this.fxParamKnob.set(v));
    const fx = h('div', { class: 'fx' }, filter.el, h('div', { class: 'fx-unit' }, fxSel, this.fxBtn), amt.el, this.fxParamKnob.el);

    // ---- transport
    this.cueBtn = h('button', { class: 'transport cue', title: 'CUE — while playing: return to cue & stop. While stopped: set cue (hold on the cue point to preview).', 'aria-label': `Deck ${deck.name} cue` }, 'CUE') as HTMLButtonElement;
    this.cueBtn.addEventListener('pointerdown', (e) => {
      safeCapture(this.cueBtn, e.pointerId);
      deck.cueDown();
    });
    this.cueBtn.addEventListener('pointerup', () => deck.cueUp());
    this.cueBtn.addEventListener('pointercancel', () => deck.cueUp());
    this.cueBtn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        deck.cueDown();
      }
    });
    this.cueBtn.addEventListener('keyup', (e) => (e.key === 'Enter' || e.key === ' ') && deck.cueUp());
    this.playBtn = h('button', { class: 'transport play', 'aria-label': `Deck ${deck.name} play/pause`, onclick: () => (deck.playFromPreview() ? undefined : deck.togglePlay()) }, '▶') as HTMLButtonElement;
    const stopBtn = h('button', { class: 'transport', title: 'Stop and return to start', 'aria-label': `Deck ${deck.name} stop`, onclick: () => deck.stop() }, '■');
    this.syncBtn = h('button', { class: 'transport sync', title: 'SYNC — match tempo and beat phase to the other deck (click again to release)', onclick: () => (deck.synced ? deck.unsync() : deck.sync(host.other(deck))) }, 'SYNC') as HTMLButtonElement;

    // ---- grid tools
    const tap = h('button', { class: 'sm', title: 'Tap tempo — tap on every beat', onclick: () => this.tap() }, 'TAP');
    const grid = h(
      'details',
      { class: 'grid-tools' },
      h('summary', { title: 'Beat-grid correction' }, 'GRID'),
      h(
        'div',
        { class: 'row tight' },
        h('button', { class: 'sm', title: 'Halve BPM', onclick: () => deck.gridHalve() }, '½×'),
        h('button', { class: 'sm', title: 'Double BPM', onclick: () => deck.gridDouble() }, '2×'),
        h('button', { class: 'sm', title: 'Shift grid 10 ms earlier', onclick: () => deck.gridShift(-10) }, '◀'),
        h('button', { class: 'sm', title: 'Shift grid 10 ms later', onclick: () => deck.gridShift(10) }, '▶'),
        h('button', { class: 'sm', title: 'Set a beat at the playhead', onclick: () => deck.gridBeatHere() }, 'BEAT HERE'),
        tap,
      ),
    );

    const loadBtn = h('button', { class: 'sm', title: 'Load the selected library track (or drag a track onto the deck)', onclick: () => host.pickAndLoad(deck) }, 'LOAD');
    const ejectBtn = h('button', { class: 'sm', title: 'Eject', onclick: () => deck.eject() }, '⏏');

    const head = h(
      'div',
      { class: 'd-head' },
      h('div', { class: 'd-badge', text: deck.name }),
      h('div', { class: 'd-meta' }, this.title, this.artist),
      h('div', { class: 'd-tempo' }, this.bpm, this.bpmSub, this.key),
    );
    const timeRow = h(
      'div',
      { class: 'd-timerow' },
      this.elapsed,
      h('div', { class: 'beats', 'aria-hidden': 'true' }, ...this.beats),
      this.remain,
      grid,
      loadBtn,
      ejectBtn,
    );
    const body = h(
      'div',
      { class: 'd-body' },
      h('div', { class: 'd-left' }, this.platter.el),
      h('div', { class: 'd-center' }, hot, loops, fx),
      pitchCol,
    );
    const transport = h('div', { class: 'd-transport' }, this.cueBtn, this.playBtn, stopBtn, this.syncBtn);
    this.el = h('section', { class: `deck deck-${p}`, 'aria-label': `Deck ${deck.name}` }, head, timeRow, this.overview, body, transport, this.status);
    this.el.style.setProperty('--deck', color);

    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('drop');
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.el.classList.remove('drop');
      host.onDropTrack(deck, e);
    });

    deck.on(() => this.update());
    this.update();
  }

  private cycleRange() {
    const i = PITCH_RANGES.indexOf(this.deck.pitchRange);
    this.deck.setPitchRange(PITCH_RANGES[(i + 1) % PITCH_RANGES.length]);
    this.syncPitchFader();
  }
  private syncPitchFader() {
    this.pitchFader.value = String(0.5 - this.deck.pitch / (2 * this.deck.pitchRange));
  }

  private tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 3000);
    this.taps.push(now);
    if (this.taps.length >= 4) {
      const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      const bpm = 60000 / iv / (1 + this.deck.pitch / 100);
      this.deck.setBpm(Math.round(bpm * 10) / 10);
    }
  }

  /** Structural/state update (on deck events). */
  update() {
    const d = this.deck;
    const t = d.track;
    setText(this.title, t ? t.title : d.loading ? d.loadingMsg : 'No track loaded');
    setText(this.artist, t ? [t.artist, t.album].filter(Boolean).join(' — ') || t.fileName : 'Drag a track here, or select one in the library and press LOAD');
    setText(this.rangeBtn, `±${d.pitchRange}%`);
    this.syncPitchFader();
    const g = d.grid;
    if (!t) {
      setText(this.bpm, '—');
      setText(this.bpmSub, '');
      setText(this.key, '');
    } else if (!g) {
      setText(this.bpm, t.analysisStatus === 'failed' ? 'n/a' : '…');
      setText(this.bpmSub, t.analysisStatus === 'failed' ? 'analysis failed' : t.analysisStatus === 'done' ? 'no beat found' : 'analysing');
      setText(this.key, t.keyShort ? `${t.keyShort} · ${t.keyCamelot}` : '');
    } else {
      const unsure = (t.bpmConfidence ?? 1) < 0.35 && !t.gridEdited;
      setText(this.bpmSub, `${unsure ? '~' : ''}${g.bpm.toFixed(2)} track${t.gridEdited ? ' (edited)' : unsure ? ' (uncertain)' : ''}`);
      setText(this.key, t.keyShort ? `${t.keyShort} · ${t.keyCamelot}${(t.keyConfidence ?? 0) < 0.3 ? '?' : ''}` : '');
      this.key.title = t.keyName ? `Estimated key: ${t.keyName} (Camelot ${t.keyCamelot}), confidence ${Math.round((t.keyConfidence ?? 0) * 100)}%` : '';
    }
    toggleClass(this.playBtn, 'on', d.playing);
    setText(this.playBtn, d.playing ? '❚❚' : '▶');
    toggleClass(this.syncBtn, 'on', d.synced);
    const enabled = d.loaded;
    for (const b of [this.playBtn, this.cueBtn, this.syncBtn, ...this.hotBtns, this.loopInBtn, this.loopOutBtn]) b.disabled = !enabled;
    this.loopExitBtn.disabled = !enabled || !d.loop;
    setText(this.loopExitBtn, d.loop?.on ? 'EXIT' : 'RELOOP');
    for (const [s, b] of this.loopBtns) {
      b.disabled = !enabled || !g;
      toggleClass(b, 'on', !!d.loop?.on && d.loop.beats === s);
    }
    toggleClass(this.loopInBtn, 'armed', d.loopInPoint !== null && !d.loop?.on);
    this.hotBtns.forEach((b, i) => toggleClass(b, 'set', !!t && t.hotCues[i] !== null && t.hotCues[i] !== undefined));
    toggleClass(this.fxBtn, 'on', d.ch.fx.enabled);
    setText(this.status, d.error ?? '');
    toggleClass(this.status, 'err', !!d.error);
    this.fxParamKnob.set(d.ch.fx.param);
  }

  /** Per-frame update (positions, beat lights, canvases). */
  frame() {
    const d = this.deck;
    const pos = d.position();
    setText(this.elapsed, fmtTime(pos));
    setText(this.remain, d.loaded ? `-${fmtTime(Math.max(0, d.duration - pos))}` : '-0:00.0');
    const bpm = d.bpm;
    setText(this.bpm, bpm ? bpm.toFixed(1) : d.track ? (d.track.analysisStatus === 'failed' ? 'n/a' : '…') : '—');
    setText(this.pitchVal, `${d.pitch >= 0 ? '+' : ''}${d.pitch.toFixed(2)}%`);
    const g = d.grid;
    let lit = -1;
    if (g && d.loaded) {
      const bi = beatIndexAt(g, pos);
      lit = ((Math.floor(bi) % 4) + 4) % 4;
    }
    this.beats.forEach((b, i) => toggleClass(b, 'on', i === lit));
    drawOverview(this.overview, d);
    this.platter.draw();
  }
}

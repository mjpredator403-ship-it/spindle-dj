// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Deck controller: DJ logic (cue, hot cues, loops, sync, grid editing) on top of
// a DeckChannel (audio) and a library Track (persistent data).

import type { DeckChannel } from './audio/engine';
import { analyzeMono, decodeFile, extractChannels, toAnalysisMono } from './audio/decode';
import { beatLoop, nearestBeat, phaseAlignedTime, syncRate, nudgeGrid, gridFromBeatAt, type BeatGrid } from './audio/beat-math';
import type { Library, Track, WaveCache } from './library/library';
import type { Settings } from './settings';
import type { AnalysisResult } from './analysis/analysis-worker';

export const PITCH_RANGES = [8, 16, 50];
export const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

export interface LoopState {
  start: number;
  end: number;
  on: boolean;
  beats: number | null;
}

export class Deck {
  track: Track | null = null;
  wave: WaveCache | null = null;
  duration = 0;
  loading = false;
  loadingMsg = '';
  error: string | null = null;
  pitch = 0; // percent
  pitchRange = 8;
  bend = 0; // temporary fractional bend (nudge / jog)
  synced = false;
  loop: LoopState | null = null;
  loopInPoint: number | null = null;
  private cuePreview = false;
  private loadToken = 0;
  private listeners = new Set<() => void>();
  onTempoChange: (() => void) | null = null;
  onMessage: ((msg: string, kind?: 'info' | 'warn' | 'error') => void) | null = null;

  constructor(
    readonly index: 0 | 1,
    readonly ch: DeckChannel,
    private lib: Library,
    private settings: Settings,
  ) {
    this.pitchRange = settings.get('pitchRange');
    ch.onEnded = () => this.emit();
  }

  get name() {
    return this.index === 0 ? 'A' : 'B';
  }

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const l of this.listeners) l();
  }
  private say(msg: string, kind: 'info' | 'warn' | 'error' = 'info') {
    this.onMessage?.(`Deck ${this.name}: ${msg}`, kind);
  }

  get grid(): BeatGrid | null {
    const t = this.track;
    if (!t || !t.bpm || t.firstBeat === undefined) return null;
    return { bpm: t.bpm, firstBeat: t.firstBeat };
  }
  get loaded() {
    return !!this.track && this.ch.lengthFrames > 0;
  }
  get playing() {
    return this.ch.playing;
  }
  get rate() {
    return (1 + this.pitch / 100) * (1 + this.bend);
  }
  /** Effective BPM including pitch, or null when not analysed. */
  get bpm(): number | null {
    const g = this.grid;
    return g ? g.bpm * (1 + this.pitch / 100) : null;
  }
  position(): number {
    return this.ch.positionSeconds();
  }

  // ------------------------------------------------------------------ loading
  async load(track: Track): Promise<void> {
    const token = ++this.loadToken;
    if (this.playing) this.ch.pause();
    this.loading = true;
    this.loadingMsg = 'Reading file…';
    this.error = null;
    this.emit();
    try {
      const file = await this.lib.getFile(track);
      if (token !== this.loadToken) return;
      this.loadingMsg = 'Decoding…';
      this.emit();
      const buf = await decodeFile(this.ch.node.context, file, this.settings.get('maxTrackMinutes'));
      if (token !== this.loadToken) return;
      const channels = extractChannels(buf);
      this.ch.unload();
      this.ch.load(channels);
      this.track = track;
      this.duration = buf.duration;
      this.loop = null;
      this.loopInPoint = null;
      this.synced = false;
      this.bend = 0;
      this.ch.setRate(this.rate);
      track.durationSec = buf.duration;
      track.playCount = (track.playCount ?? 0) + 1;
      track.lastPlayed = Date.now();
      // restore cue position
      if (track.cue !== undefined && track.cue < buf.duration) this.ch.seekSeconds(track.cue);
      this.wave = track.analysisStatus === 'done' ? ((await this.lib.getWave(track.id)) ?? null) : null;
      this.loading = false;
      this.emit();
      await this.lib.save(track);
      if (!this.wave) await this.analyzeFrom(buf, track, token);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.error = (e as Error).message;
      this.say(this.error, 'error');
      this.emit();
    }
  }

  private async analyzeFrom(buf: AudioBuffer, track: Track, token: number) {
    track.analysisStatus = 'analyzing';
    this.loadingMsg = 'Analysing…';
    this.emit();
    const mono = await toAnalysisMono(buf);
    const r = await analyzeMono(track.id, mono);
    await applyAnalysis(this.lib, track, r);
    if (token === this.loadToken && this.track === track) {
      this.wave = (await this.lib.getWave(track.id)) ?? null;
      this.emit();
    }
  }

  /** Called by the background analyser when it finishes the currently loaded track. */
  async refreshWave() {
    if (this.track) {
      this.wave = (await this.lib.getWave(this.track.id)) ?? null;
      this.emit();
    }
  }

  eject() {
    if (this.playing) return this.say('stop playback before ejecting.', 'warn');
    this.loadToken++;
    this.ch.unload();
    this.track = null;
    this.wave = null;
    this.duration = 0;
    this.loop = null;
    this.synced = false;
    this.error = null;
    this.emit();
  }

  // ---------------------------------------------------------------- transport
  play() {
    if (!this.loaded) return;
    this.ch.play();
    this.emit();
  }
  pause() {
    this.ch.pause();
    this.emit();
  }
  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }
  /** Stop and return to the start (or the cue point if one is set). */
  stop() {
    this.ch.pause();
    this.seek(0);
    this.emit();
  }

  seek(sec: number) {
    if (!this.loaded) return;
    const t = Math.max(0, Math.min(this.duration - 0.001, sec));
    if (this.loop?.on && (t < this.loop.start || t >= this.loop.end)) this.exitLoop();
    this.ch.seekSeconds(t);
    this.emit();
  }

  private q(t: number): number {
    const g = this.grid;
    return this.settings.get('quantize') && g ? Math.max(0, nearestBeat(g, t)) : t;
  }

  /** CDJ-style CUE (press). */
  cueDown() {
    if (!this.loaded || !this.track) return;
    const pos = this.position();
    const cue = this.track.cue ?? 0;
    if (this.playing) {
      this.ch.pause();
      this.seek(cue);
    } else if (Math.abs(pos - cue) < 0.02) {
      this.cuePreview = true; // hold to preview from the cue point
      this.ch.play();
    } else {
      this.track.cue = this.q(pos);
      this.seek(this.track.cue);
      void this.lib.save(this.track);
    }
    this.emit();
  }
  cueUp() {
    if (this.cuePreview && this.track) {
      this.cuePreview = false;
      this.ch.pause();
      this.seek(this.track.cue ?? 0);
      this.emit();
    }
  }
  /** Cue play: if previewing from cue, keep playing when PLAY is pressed. */
  playFromPreview() {
    if (this.cuePreview) {
      this.cuePreview = false;
      this.emit();
      return true;
    }
    return false;
  }

  hotCue(i: number) {
    if (!this.loaded || !this.track) return;
    const v = this.track.hotCues[i];
    if (v === null || v === undefined) {
      this.track.hotCues[i] = this.q(this.position());
      void this.lib.save(this.track);
    } else {
      this.seek(v);
      if (!this.playing) this.ch.play();
    }
    this.emit();
  }
  deleteHotCue(i: number) {
    if (!this.track) return;
    this.track.hotCues[i] = null;
    void this.lib.save(this.track);
    this.emit();
  }

  // ------------------------------------------------------------------- tempo
  setPitch(percent: number) {
    const p = Math.max(-this.pitchRange, Math.min(this.pitchRange, percent));
    this.pitch = Math.round(p * 100) / 100;
    this.ch.setRate(this.rate);
    this.refreshFxBeat();
    this.emit();
    this.onTempoChange?.();
  }
  setPitchRange(r: number) {
    this.pitchRange = r;
    if (Math.abs(this.pitch) > r) this.setPitch(this.pitch);
    this.emit();
  }
  /** Temporary speed bend (nudge buttons / jog wheel while playing). */
  setBend(b: number) {
    this.bend = Math.max(-0.5, Math.min(0.5, b));
    this.ch.setRate(this.rate);
  }

  sync(leader: Deck) {
    const lg = leader.grid;
    const g = this.grid;
    if (!lg || !g || !leader.loaded || !this.loaded) {
      this.say(lg && g ? 'load a track on both decks to sync.' : 'sync needs BPM analysis on both decks.', 'warn');
      return;
    }
    const r = syncRate(lg.bpm, 1 + leader.pitch / 100, g.bpm);
    let pct = (r - 1) * 100;
    if (Math.abs(pct) > this.pitchRange) {
      const fit = [8, 16, 50].find((x) => Math.abs(pct) <= x);
      if (!fit) {
        this.say(`tempo difference too large to sync (${pct.toFixed(1)}%).`, 'warn');
        return;
      }
      this.pitchRange = fit;
      this.say(`pitch range widened to ±${fit}% to sync.`);
    }
    this.setPitch(pct);
    this.synced = true;
    if (leader.playing || this.playing) {
      const t = phaseAlignedTime(lg, leader.position(), g, this.position());
      if (t >= 0 && t < this.duration) this.ch.seekSeconds(t);
    }
    this.emit();
  }
  unsync() {
    this.synced = false;
    this.emit();
  }
  /** Tempo-follow when the leader's pitch changes (sync lock). */
  follow(leader: Deck) {
    if (!this.synced || !leader.grid || !this.grid) return;
    const r = syncRate(leader.grid.bpm, 1 + leader.pitch / 100, this.grid.bpm);
    const pct = (r - 1) * 100;
    if (Math.abs(pct) <= this.pitchRange) {
      this.pitch = Math.round(pct * 100) / 100;
      this.ch.setRate(this.rate);
      this.refreshFxBeat();
      this.emit();
    }
  }

  refreshFxBeat() {
    const b = this.bpm;
    this.ch.fx.setBeat(b ? 60 / b : null);
  }

  // ------------------------------------------------------------------- loops
  beatLoop(beats: number) {
    if (!this.loaded) return;
    const g = this.grid;
    if (!g) return this.say('beat loops need BPM analysis (use Loop In/Out for manual loops).', 'warn');
    if (this.loop?.on && this.loop.beats === beats) return this.exitLoop();
    const anchor = this.loop?.on ? this.loop.start : this.position();
    const l = beatLoop(g, anchor, beats, this.duration, this.settings.get('quantize'));
    if (!l) return this.say('loop does not fit in the track.', 'warn');
    this.setLoop(l.start, l.end, beats);
  }
  loopIn() {
    if (!this.loaded) return;
    this.loopInPoint = this.q(this.position());
    if (this.loop?.on) this.exitLoop();
    this.emit();
  }
  loopOut() {
    if (!this.loaded) return;
    const start = this.loopInPoint ?? this.loop?.start;
    if (start === undefined || start === null) return this.say('set Loop In first.', 'warn');
    const end = this.q(this.position());
    if (end - start < 0.01) return this.say('loop out must be after loop in.', 'warn');
    const g = this.grid;
    const beats = g ? Math.round(((end - start) * g.bpm) / 60 * 1000) / 1000 : null;
    this.setLoop(start, end, beats);
  }
  setLoop(start: number, end: number, beats: number | null) {
    this.loop = { start, end, on: true, beats };
    this.ch.setLoop(true, start, end);
    // If the playhead is outside, jump to the loop start (keeps behaviour predictable when paused).
    const p = this.position();
    if (p < start || p >= end) this.ch.seekSeconds(start);
    this.emit();
  }
  exitLoop() {
    if (!this.loop) return;
    this.loop.on = false;
    this.ch.setLoop(false, this.loop.start, this.loop.end);
    this.emit();
  }
  reloop() {
    if (!this.loop) return;
    this.setLoop(this.loop.start, this.loop.end, this.loop.beats);
    this.ch.seekSeconds(this.loop.start);
  }
  resizeLoop(factor: number) {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) * factor;
    if (len < 0.01) return;
    const end = Math.min(this.duration, this.loop.start + len);
    this.setLoop(this.loop.start, end, this.loop.beats ? this.loop.beats * factor : null);
  }

  // ------------------------------------------------------- beat-grid editing
  private saveGrid(g: BeatGrid) {
    if (!this.track) return;
    this.track.bpm = Math.round(g.bpm * 1000) / 1000;
    this.track.firstBeat = g.firstBeat;
    this.track.gridEdited = true;
    void this.lib.save(this.track);
    this.refreshFxBeat();
    this.emit();
    this.onTempoChange?.();
  }
  gridHalve() {
    const g = this.grid;
    if (g) this.saveGrid({ bpm: g.bpm / 2, firstBeat: g.firstBeat });
  }
  gridDouble() {
    const g = this.grid;
    if (g) this.saveGrid({ bpm: g.bpm * 2, firstBeat: g.firstBeat });
  }
  gridShift(ms: number) {
    const g = this.grid;
    if (g) this.saveGrid(nudgeGrid(g, ms));
  }
  gridBeatHere() {
    const g = this.grid;
    if (g) this.saveGrid(gridFromBeatAt(g, this.position()));
  }
  /** Manually set BPM (e.g. tap tempo) keeping the current downbeat. */
  setBpm(bpm: number) {
    if (!this.track || !(bpm > 30 && bpm < 300)) return;
    const g = this.grid ?? { bpm, firstBeat: 0 };
    this.saveGrid({ bpm, firstBeat: g.firstBeat });
  }
}


/** Persist an analysis result onto a track + waveform cache. */
export async function applyAnalysis(lib: Library, track: Track, r: AnalysisResult): Promise<void> {
  if (!r.ok) {
    track.analysisStatus = 'failed';
    track.analysisError = r.error;
    await lib.save(track);
    return;
  }
  if (!track.gridEdited) {
    track.bpm = r.bpm;
    track.firstBeat = r.firstBeat;
    track.bpmConfidence = r.bpmConfidence;
  }
  track.keyName = r.key?.name;
  track.keyShort = r.key?.short;
  track.keyCamelot = r.key?.camelot;
  track.keyConfidence = r.key?.confidence;
  track.durationSec = r.durationSec ?? track.durationSec;
  track.analysisStatus = 'done';
  track.analysisError = undefined;
  await lib.putWave({ id: track.id, peaks: r.peaks!, lowRatio: r.lowRatio!, peaksPerSec: r.peaksPerSec!, durationSec: r.durationSec! });
  await lib.save(track);
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Audio graph: two deck channels → crossfader → master → limiter → output.
//
//  [deck worklet] → trim → 3-band EQ → HPF → LPF → FX → fader → xfade ─┐
//                                                                 (channel meter)    │
//  [deck worklet] → … same for deck B …                                              ├→ master gain
//                                                                                    │   │ (pre-limiter meter / clip)
//                                     look-ahead limiter worklet (−1 dBFS ceiling) → master meter → destination
//                                                                                   └→ recorder worklet

import deckWorkletUrl from './deck-worklet.ts?worker&url';
import recorderWorkletUrl from './recorder-worklet.ts?worker&url';
import limiterWorkletUrl from './limiter-worklet.ts?worker&url';
import { FxUnit } from './effects';
import { crossfadeGains, dbToGain, eqKnobToDb, faderGain, filterKnobToCutoffs, trimKnobToDb, type XfadeCurve } from './mixer-math';

export type LatencyHint = 'interactive' | 'balanced' | 'playback';

export interface PosReport {
  frame: number;
  playing: boolean;
  loopOn: boolean;
  time: number;
}

export class Meter {
  private buf: Float32Array<ArrayBuffer>;
  peakHold = 0;
  private holdUntil = 0;
  clipUntil = 0;
  constructor(readonly node: AnalyserNode) {
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0;
    this.buf = new Float32Array(node.fftSize);
  }
  /** Returns instantaneous peak (linear). Updates hold + clip flags. */
  read(now: number): number {
    this.node.getFloatTimeDomainData(this.buf);
    let p = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs(this.buf[i]);
      if (v > p) p = v;
    }
    if (p >= this.peakHold || now > this.holdUntil) {
      this.peakHold = p;
      this.holdUntil = now + 1.2;
    }
    if (p >= 0.999) this.clipUntil = now + 1.5;
    return p;
  }
  get clipping() {
    return performance.now() / 1000 < this.clipUntil;
  }
}

export class DeckChannel {
  readonly node: AudioWorkletNode;
  readonly trim: GainNode;
  readonly eq: CrossoverEq;
  readonly hpf: BiquadFilterNode;
  readonly lpf: BiquadFilterNode;
  readonly fx: FxUnit;
  readonly fader: GainNode;
  readonly xfade: GainNode;
  readonly meter: Meter;

  sampleRate: number;
  lengthFrames = 0;
  last: PosReport = { frame: 0, playing: false, loopOn: false, time: 0 };
  rate = 1;
  onEnded: (() => void) | null = null;
  onReport: ((r: PosReport) => void) | null = null;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.sampleRate = ctx.sampleRate;
    this.node = new AudioWorkletNode(ctx, 'spindle-deck', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.trim = ctx.createGain();
    this.eq = new CrossoverEq(ctx);
    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 10;
    this.hpf.Q.value = 0.9;
    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = 'lowpass';
    this.lpf.frequency.value = Math.min(20000, ctx.sampleRate * 0.45);
    this.lpf.Q.value = 0.9;
    this.fx = new FxUnit(ctx);
    this.fader = ctx.createGain();
    this.xfade = ctx.createGain();
    const an = ctx.createAnalyser();
    this.meter = new Meter(an);

    this.node.connect(this.trim);
    this.trim.connect(this.eq.input);
    this.eq.output.connect(this.hpf);
    this.hpf.connect(this.lpf);
    this.lpf.connect(this.fx.input);
    this.fx.output.connect(this.fader);
    this.fader.connect(an); // post-fader channel meter
    this.fader.connect(this.xfade);
    this.xfade.connect(out);

    this.node.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'pos') {
        this.last = m as PosReport;
        this.onReport?.(this.last);
      } else if (m.type === 'ended') {
        this.onEnded?.();
      }
    };
  }

  private post(msg: unknown, transfer?: Transferable[]) {
    this.node.port.postMessage(msg, transfer ?? []);
  }

  load(channels: Float32Array[]) {
    this.lengthFrames = channels[0]?.length ?? 0;
    this.last = { frame: 0, playing: false, loopOn: false, time: this.ctx.currentTime };
    this.post({ type: 'load', channels }, channels.map((c) => c.buffer as ArrayBuffer));
  }
  unload() {
    this.lengthFrames = 0;
    this.last = { frame: 0, playing: false, loopOn: false, time: this.ctx.currentTime };
    this.post({ type: 'unload' });
  }
  play() {
    this.post({ type: 'play' });
    this.last = { ...this.last, playing: true, time: this.ctx.currentTime };
  }
  pause() {
    this.post({ type: 'pause' });
    this.last = { ...this.last, frame: this.positionFrames(), playing: false, time: this.ctx.currentTime };
  }
  seekSeconds(sec: number) {
    const f = Math.max(0, Math.min(this.lengthFrames - 1, sec * this.sampleRate));
    this.post({ type: 'seek', frame: f });
    this.last = { ...this.last, frame: f, time: this.ctx.currentTime };
  }
  setRate(r: number) {
    // Update the extrapolation base first so the displayed position doesn't jump.
    this.last = { ...this.last, frame: this.positionFrames(), time: this.ctx.currentTime };
    this.rate = r;
    this.post({ type: 'rate', rate: r });
  }
  setLoop(on: boolean, startSec: number, endSec: number) {
    this.post({ type: 'loop', on, start: startSec * this.sampleRate, end: endSec * this.sampleRate });
  }

  /** Extrapolated playhead (frames) between worklet reports. */
  positionFrames(): number {
    const l = this.last;
    if (!l.playing) return l.frame;
    const dt = Math.max(0, Math.min(0.1, this.ctx.currentTime - l.time));
    return Math.min(this.lengthFrames, l.frame + dt * this.sampleRate * this.rate);
  }
  positionSeconds(): number {
    return this.positionFrames() / this.sampleRate;
  }
  get playing() {
    return this.last.playing;
  }

  // ---- mixer controls (all ramped to avoid zipper noise)
  setTrim(v: number) {
    this.trim.gain.setTargetAtTime(dbToGain(trimKnobToDb(v)), this.ctx.currentTime, 0.01);
  }
  setEq(band: 'low' | 'mid' | 'high', v: number) {
    const g = v <= 0.002 ? 0 : dbToGain(eqKnobToDb(v)); // full left = true kill
    this.eq[band].gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }
  setFilter(f: number) {
    const c = filterKnobToCutoffs(f, this.ctx.sampleRate / 2);
    const t = this.ctx.currentTime;
    this.lpf.frequency.setTargetAtTime(c.lp, t, 0.015);
    this.hpf.frequency.setTargetAtTime(c.hp, t, 0.015);
  }
  setFader(v: number) {
    this.fader.gain.setTargetAtTime(faderGain(v), this.ctx.currentTime, 0.01);
  }
  setXfadeGain(g: number) {
    this.xfade.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }
}

/**
 * DJ-style 3-band isolator EQ: 4th-order Linkwitz–Riley crossovers at 250 Hz and
 * 2.5 kHz, each band with its own gain. The low band is passed through the
 * matching 2nd-order all-pass so that, at 0 dB, the bands sum to a flat
 * magnitude response (verified analytically: < 0.001 dB deviation). Turning a
 * band fully down removes it ("kill") without touching the neighbours much.
 */
export class CrossoverEq {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly low: GainNode;
  readonly mid: GainNode;
  readonly high: GainNode;
  static readonly F_LOW = 250;
  static readonly F_HIGH = 2500;

  constructor(ctx: BaseAudioContext) {
    // Web Audio low/high-pass Q is in dB: Butterworth (1/√2) = −3.0103 dB.
    const BW_DB = -3.0103;
    const bq = (type: BiquadFilterType, f: number, q: number) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const chain = (...nodes: AudioNode[]) => {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
      return nodes;
    };
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.low = ctx.createGain();
    this.mid = ctx.createGain();
    this.high = ctx.createGain();
    const fL = CrossoverEq.F_LOW,
      fH = CrossoverEq.F_HIGH;
    // low: LR4 low-pass @fL, then all-pass @fH (phase-match the upper split)
    chain(this.input, bq('lowpass', fL, BW_DB), bq('lowpass', fL, BW_DB), bq('allpass', fH, Math.SQRT1_2), this.low, this.output);
    // rest: LR4 high-pass @fL, then split @fH
    const rest = chain(this.input, bq('highpass', fL, BW_DB), bq('highpass', fL, BW_DB))[2];
    chain(rest, bq('lowpass', fH, BW_DB), bq('lowpass', fH, BW_DB), this.mid, this.output);
    chain(rest, bq('highpass', fH, BW_DB), bq('highpass', fH, BW_DB), this.high, this.output);
  }
}

export interface EngineStatus {
  state: AudioContextState | 'unavailable';
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  error?: string;
}

export class Engine {
  readonly ctx: AudioContext;
  readonly decks: [DeckChannel, DeckChannel];
  readonly master: GainNode;
  readonly limiter: AudioWorkletNode;
  private limiterGain = 1;
  readonly preMeter: Meter; // master before limiter (clip indicator)
  readonly masterMeter: Meter; // what leaves the app
  readonly recordTap: GainNode;
  xfadePos = 0.5;
  xfadeCurve: XfadeCurve = 'smooth';
  onStateChange: (() => void) | null = null;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const pre = ctx.createAnalyser();
    this.preMeter = new Meter(pre);
    // Not DynamicsCompressorNode: it applies automatic make-up gain, which
    // changes the level of a mix that is nowhere near clipping.
    this.limiter = new AudioWorkletNode(ctx, 'spindle-limiter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.limiter.port.onmessage = (e: MessageEvent<number>) => (this.limiterGain = e.data);
    const post = ctx.createAnalyser();
    this.masterMeter = new Meter(post);
    this.recordTap = ctx.createGain();

    this.master.connect(pre);
    this.master.connect(this.limiter);
    this.limiter.connect(post);
    this.limiter.connect(ctx.destination);
    this.limiter.connect(this.recordTap);

    this.decks = [new DeckChannel(ctx, this.master), new DeckChannel(ctx, this.master)];
    this.setCrossfader(0.5);
    ctx.onstatechange = () => this.onStateChange?.();
  }

  static async create(latencyHint: LatencyHint = 'interactive'): Promise<Engine> {
    if (typeof AudioContext === 'undefined') throw new Error('This browser has no Web Audio support.');
    const ctx = new AudioContext({ latencyHint });
    if (!ctx.audioWorklet) {
      throw new Error('AudioWorklet is unavailable. Open the app over https:// or http://localhost (a secure context), not file://.');
    }
    await ctx.audioWorklet.addModule(deckWorkletUrl);
    await ctx.audioWorklet.addModule(recorderWorkletUrl);
    await ctx.audioWorklet.addModule(limiterWorkletUrl);
    return new Engine(ctx);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  status(): EngineStatus {
    return {
      state: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: (this.ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000,
    };
  }

  setCrossfader(x: number, curve: XfadeCurve = this.xfadeCurve) {
    this.xfadePos = x;
    this.xfadeCurve = curve;
    const [a, b] = crossfadeGains(x, curve);
    this.decks[0].setXfadeGain(a);
    this.decks[1].setXfadeGain(b);
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(faderGain(v), this.ctx.currentTime, 0.01);
  }

  /** Gain reduction currently applied by the limiter, in dB (≥ 0). */
  limiterReductionDb(): number {
    return this.limiterGain >= 1 ? 0 : -20 * Math.log10(this.limiterGain);
  }

  /** Route output to a specific device (Chrome 110+). */
  async setOutputDevice(deviceId: string): Promise<void> {
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!c.setSinkId) throw new Error('Choosing an output device is not supported in this browser.');
    await c.setSinkId(deviceId);
  }

  static outputSelectionSupported(): boolean {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  createRecorderNode(): AudioWorkletNode {
    const node = new AudioWorkletNode(this.ctx, 'spindle-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.recordTap.connect(node);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(this.ctx.destination); // keeps the node pulled; outputs silence
    return node;
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Per-deck effect unit. Every effect is real Web Audio processing on the deck
// signal (no cosmetic controls). Topology:
//
//   in ──► dry ───────────────────────────────┐
//    ├──► echo  (delay + filtered feedback) ──► wet ─┤
//    ├──► reverb (convolver, generated IR) ──► wet ─┼─► out
//    └──► flanger (LFO-modulated delay)    ──► wet ─┘
//
// Only the selected effect's wet gain is opened, ramped to avoid clicks.

export type EffectType = 'echo' | 'reverb' | 'flanger';
export const EFFECT_TYPES: EffectType[] = ['echo', 'reverb', 'flanger'];
export const EFFECT_LABELS: Record<EffectType, string> = { echo: 'Echo', reverb: 'Reverb', flanger: 'Flanger' };
export const ECHO_BEATS = [0.25, 0.5, 0.75, 1];

export class FxUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  private wet: Record<EffectType, GainNode>;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  private flDelay: DelayNode;
  private flLfo: OscillatorNode;
  private flDepth: GainNode;
  private flFb: GainNode;
  private revTone: BiquadFilterNode;
  type: EffectType = 'echo';
  enabled = false;
  amount = 0.5; // wet level 0..1
  param = 0.5; // effect-specific 0..1
  private beatSec: number | null = null;

  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output); // dry path (unity)

    const mkWet = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.output);
      return g;
    };
    this.wet = { echo: mkWet(), reverb: mkWet(), flanger: mkWet() };

    // Echo
    this.echoDelay = ctx.createDelay(4);
    this.echoFb = ctx.createGain();
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 5000;
    this.input.connect(this.echoDelay);
    this.echoDelay.connect(echoTone);
    echoTone.connect(this.echoFb);
    this.echoFb.connect(this.echoDelay);
    echoTone.connect(this.wet.echo);

    // Reverb (procedurally generated stereo impulse response)
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.2);
    this.revTone = ctx.createBiquadFilter();
    this.revTone.type = 'lowpass';
    this.input.connect(conv);
    conv.connect(this.revTone);
    this.revTone.connect(this.wet.reverb);

    // Flanger
    this.flDelay = ctx.createDelay(0.05);
    this.flDelay.delayTime.value = 0.004;
    this.flLfo = ctx.createOscillator();
    this.flLfo.type = 'sine';
    this.flDepth = ctx.createGain();
    this.flDepth.gain.value = 0.0025;
    this.flLfo.connect(this.flDepth);
    this.flDepth.connect(this.flDelay.delayTime);
    this.flLfo.start();
    this.flFb = ctx.createGain();
    this.flFb.gain.value = 0.5;
    this.input.connect(this.flDelay);
    this.flDelay.connect(this.flFb);
    this.flFb.connect(this.flDelay);
    this.flDelay.connect(this.wet.flanger);

    this.applyParams();
  }

  setType(t: EffectType) {
    this.type = t;
    this.applyWet();
    this.applyParams();
  }
  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyWet();
  }
  setAmount(v: number) {
    this.amount = v;
    this.applyWet();
  }
  setParam(v: number) {
    this.param = v;
    this.applyParams();
  }
  /** Track tempo in seconds per beat (effective, incl. pitch) or null if unknown. */
  setBeat(sec: number | null) {
    this.beatSec = sec;
    this.applyParams();
  }

  /** Human-readable value of the param knob for the current effect. */
  paramLabel(): string {
    if (this.type === 'echo') {
      if (this.beatSec) return `${fmtBeats(this.echoBeats())} beat`;
      return `${Math.round(this.echoTimeSec() * 1000)} ms`;
    }
    if (this.type === 'reverb') return `tone ${Math.round(this.param * 100)}%`;
    return `${this.flangerRate().toFixed(2)} Hz`;
  }
  paramName(): string {
    return this.type === 'echo' ? 'Time' : this.type === 'reverb' ? 'Tone' : 'Rate';
  }

  private echoBeats(): number {
    return ECHO_BEATS[Math.min(ECHO_BEATS.length - 1, Math.floor(this.param * ECHO_BEATS.length))];
  }
  private echoTimeSec(): number {
    if (this.beatSec) return Math.min(3.9, this.beatSec * this.echoBeats());
    return 0.08 + this.param * 0.72;
  }
  private flangerRate(): number {
    return 0.05 + this.param * this.param * 2;
  }

  private applyWet() {
    const t = this.ctx.currentTime;
    for (const k of Object.keys(this.wet) as EffectType[]) {
      const target = this.enabled && k === this.type ? this.amount : 0;
      this.wet[k].gain.setTargetAtTime(target, t, 0.02);
    }
  }

  private applyParams() {
    const t = this.ctx.currentTime;
    this.echoDelay.delayTime.setTargetAtTime(this.echoTimeSec(), t, 0.03);
    this.echoFb.gain.setTargetAtTime(0.45, t, 0.03);
    this.flLfo.frequency.setTargetAtTime(this.flangerRate(), t, 0.05);
    this.revTone.frequency.setTargetAtTime(1200 + this.param * this.param * 16000, t, 0.03);
  }
}

function fmtBeats(b: number): string {
  return b === 0.25 ? '¼' : b === 0.5 ? '½' : b === 0.75 ? '¾' : String(b);
}

/** Exponentially decaying stereo noise IR — original, generated at runtime. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, decay) * 0.5;
  }
  return buf;
}

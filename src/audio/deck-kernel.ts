// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Pure, allocation-free deck playback kernel. Runs inside the AudioWorklet
// (deck-worklet.ts) and is unit-tested directly in Node.
//
// Positions are in frames at the AudioContext sample rate (decodeAudioData
// already resampled the track to that rate). Playback rate changes pitch and
// tempo together (vinyl-style). Pitch-preserving time-stretch is NOT done here.

export const FADE_FRAMES = 64; // ~1.3 ms @ 48 kHz — click-free start/stop/seek

export class DeckKernel {
  private left: Float32Array = new Float32Array(0);
  private right: Float32Array = new Float32Array(0);
  length = 0;
  pos = 0; // fractional frame position
  rate = 1;
  playing = false; // transport intent
  ended = false;

  loopOn = false;
  loopStart = 0;
  loopEnd = 0;

  // micro-fade state
  private gain = 0;
  private wantAudible = false;
  private pendingSeek: number | null = null;

  get loaded(): boolean {
    return this.length > 0;
  }

  load(channels: Float32Array[]): void {
    this.left = channels[0] ?? new Float32Array(0);
    this.right = channels[1] ?? this.left; // mono → duplicate
    this.length = this.left.length;
    this.pos = 0;
    this.playing = false;
    this.ended = false;
    this.loopOn = false;
    this.gain = 0;
    this.wantAudible = false;
    this.pendingSeek = null;
  }

  unload(): void {
    this.load([]);
  }

  play(): void {
    if (!this.loaded) return;
    if (this.pos >= this.length - 1) this.pos = 0;
    this.playing = true;
    this.ended = false;
    this.wantAudible = true;
  }

  pause(): void {
    this.playing = false;
    this.wantAudible = false;
  }

  /** Seek to a frame. While audible, fades out, jumps, fades back in. */
  seek(frame: number): void {
    const f = Math.max(0, Math.min(this.length > 0 ? this.length - 1 : 0, frame));
    if (this.gain > 0) {
      this.pendingSeek = f;
    } else {
      this.pos = f;
      this.pendingSeek = null;
    }
    this.ended = false;
  }

  setRate(r: number): void {
    // Clamp to a sane range; negative rates are not supported by this kernel.
    this.rate = Math.max(0, Math.min(4, r));
  }

  setLoop(on: boolean, start = this.loopStart, end = this.loopEnd): void {
    const s = Math.max(0, Math.min(start, this.length));
    const e = Math.max(0, Math.min(end, this.length));
    if (on && e - s < 32) {
      this.loopOn = false;
      return;
    }
    this.loopStart = s;
    this.loopEnd = e;
    this.loopOn = on;
    // If we're already past the loop end when it is engaged, wrap into it.
    if (on && this.pos >= e) this.pos = s + ((this.pos - s) % (e - s));
  }

  /** Render n frames into outL/outR (overwrites). No allocation. */
  render(outL: Float32Array, outR: Float32Array, n: number): void {
    const L = this.left;
    const R = this.right;
    const len = this.length;
    const step = 1 / FADE_FRAMES;
    for (let i = 0; i < n; i++) {
      // fade logic
      const target = this.pendingSeek !== null ? 0 : this.wantAudible ? 1 : 0;
      if (this.gain < target) this.gain = Math.min(target, this.gain + step);
      else if (this.gain > target) this.gain = Math.max(target, this.gain - step);
      if (this.pendingSeek !== null && this.gain === 0) {
        this.pos = this.pendingSeek;
        this.pendingSeek = null;
      }

      if (this.gain === 0 || len < 2) {
        outL[i] = 0;
        outR[i] = 0;
        // Even while silent-fading-in we advance nothing; position only moves when audible.
        continue;
      }

      const p = this.pos;
      const i0 = p | 0;
      const frac = p - i0;
      const i1 = i0 + 1 < len ? i0 + 1 : i0;
      const g = this.gain;
      outL[i] = (L[i0] + (L[i1] - L[i0]) * frac) * g;
      outR[i] = (R[i0] + (R[i1] - R[i0]) * frac) * g;

      // Advance only while transport is playing (during a pause fade-out we keep moving,
      // so the tail is natural rather than a frozen sample).
      let np = p + this.rate;
      if (this.loopOn && np >= this.loopEnd) {
        const span = this.loopEnd - this.loopStart;
        np = this.loopStart + ((np - this.loopEnd) % span);
      }
      if (np >= len - 1) {
        np = len - 1;
        this.playing = false;
        this.wantAudible = false;
        this.ended = true;
      }
      this.pos = np;
    }
  }
}

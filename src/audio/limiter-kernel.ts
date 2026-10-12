// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Look-ahead brick-wall peak limiter (stereo-linked). Original implementation.
//
//  * Unity gain (bit-transparent apart from the look-ahead delay) while peaks
//    stay below the threshold — unlike DynamicsCompressorNode, which adds
//    automatic make-up gain.
//  * Gain reduction is computed from the minimum required gain over the next
//    `lookahead` frames (sliding-window minimum, O(1) amortised) and reached
//    with a linear attack within that window, so peaks never pass the ceiling.
//  * Exponential release. A final hard clamp guards against float edge cases.
//  * No allocation in render().

export class LimiterKernel {
  readonly lookahead: number;
  private ceiling: number;
  private relCoef: number;
  private dl: Float32Array; // delay line L
  private dr: Float32Array; // delay line R
  private w = 0; // write index in delay ring
  // sliding-window minimum over required gains (monotonic deque in a ring)
  private qVal: Float32Array;
  private qIdx: Float64Array;
  private qHead = 0;
  private qTail = 0;
  private n = 0; // frames processed
  env = 1;
  minEnvInBlock = 1;

  constructor(sampleRate: number, ceilingDb = -1, lookaheadMs = 2, releaseMs = 120) {
    this.lookahead = Math.max(1, Math.round((sampleRate * lookaheadMs) / 1000));
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.relCoef = 1 - Math.exp(-1 / ((sampleRate * releaseMs) / 1000));
    this.dl = new Float32Array(this.lookahead + 1);
    this.dr = new Float32Array(this.lookahead + 1);
    const cap = this.lookahead + 2;
    this.qVal = new Float32Array(cap);
    this.qIdx = new Float64Array(cap);
  }

  get latencyFrames(): number {
    return this.lookahead;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    const L = this.lookahead;
    const size = L + 1;
    const cap = this.qVal.length;
    const thr = this.ceiling;
    const attackStep = 1 / L;
    let minEnv = 1;
    for (let i = 0; i < frames; i++) {
      const xl = inL[i];
      const xr = inR[i];
      const al = xl < 0 ? -xl : xl;
      const ar = xr < 0 ? -xr : xr;
      const peak = al > ar ? al : ar;
      const req = peak > thr ? thr / peak : 1;

      // push req into monotonic deque (keep increasing values from head)
      while (this.qTail !== this.qHead) {
        const last = (this.qTail - 1 + cap) % cap;
        if (this.qVal[last] >= req) this.qTail = last;
        else break;
      }
      this.qVal[this.qTail] = req;
      this.qIdx[this.qTail] = this.n;
      this.qTail = (this.qTail + 1) % cap;
      // drop entries older than the window (window = last L+1 inputs)
      while (this.qIdx[this.qHead] <= this.n - size) this.qHead = (this.qHead + 1) % cap;
      const target = this.qVal[this.qHead];

      // gain envelope
      if (target < this.env) {
        this.env = this.env - attackStep < target ? target : this.env - attackStep;
      } else {
        this.env += (target - this.env) * this.relCoef;
      }
      if (this.env < minEnv) minEnv = this.env;

      // delay line: write current, read the sample from L frames ago
      this.dl[this.w] = xl;
      this.dr[this.w] = xr;
      let r = this.w + 1;
      if (r === size) r = 0;
      let yl = this.dl[r] * this.env;
      let yr = this.dr[r] * this.env;
      if (yl > thr) yl = thr;
      else if (yl < -thr) yl = -thr;
      if (yr > thr) yr = thr;
      else if (yr < -thr) yr = -thr;
      outL[i] = yl;
      outR[i] = yr;
      this.w = r;
      this.n++;
    }
    this.minEnvInBlock = minEnv;
  }
}

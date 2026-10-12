// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import { LimiterKernel } from './limiter-kernel';

class LimiterProcessor extends AudioWorkletProcessor {
  private k = new LimiterKernel(sampleRate, -1, 2, 120);
  private silent = new Float32Array(128);
  private blocks = 0;
  private worst = 1;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    if (this.silent.length < n) this.silent = new Float32Array(n);
    const L = inp && inp[0] ? inp[0] : this.silent;
    const R = inp && inp[1] ? inp[1] : L;
    this.k.process(L, R, out[0], out[1] ?? out[0], n);
    if (this.k.minEnvInBlock < this.worst) this.worst = this.k.minEnvInBlock;
    if (++this.blocks >= 8) {
      this.port.postMessage(this.worst); // min gain over ~20 ms
      this.blocks = 0;
      this.worst = 1;
    }
    return true;
  }
}

registerProcessor('spindle-limiter', LimiterProcessor);

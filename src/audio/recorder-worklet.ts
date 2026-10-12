// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Captures the master bus and ships interleaved 16-bit PCM chunks to the main
// thread, which streams them to disk (bounded memory) or to an in-memory Blob.

const CHUNK = 8192; // frames per message (~170 ms @ 48 kHz)

class RecorderProcessor extends AudioWorkletProcessor {
  private active = false;
  private buf = new Int16Array(CHUNK * 2);
  private n = 0;
  private peak = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type: 'start' | 'pause' | 'resume' | 'stop' }>) => {
      const t = e.data.type;
      if (t === 'start' || t === 'resume') this.active = true;
      else if (t === 'pause') {
        this.active = false;
      } else if (t === 'stop') {
        this.active = false;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  private flush() {
    if (this.n === 0) return;
    const chunk = this.buf.slice(0, this.n * 2);
    this.port.postMessage({ type: 'chunk', pcm: chunk, peak: this.peak }, [chunk.buffer]);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inp = inputs[0];
    // pass-through silence on the output (keeps the node pulled by the graph)
    for (const ch of outputs[0] ?? []) ch.fill(0);
    if (!this.active || !inp || inp.length === 0) return true;
    const L = inp[0];
    const R = inp[1] ?? inp[0];
    for (let i = 0; i < L.length; i++) {
      const l = L[i] > 1 ? 1 : L[i] < -1 ? -1 : L[i];
      const r = R[i] > 1 ? 1 : R[i] < -1 ? -1 : R[i];
      const al = l < 0 ? -l : l;
      if (al > this.peak) this.peak = al;
      this.buf[this.n * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
      this.buf[this.n * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      if (++this.n === CHUNK) this.flush();
    }
    return true;
  }
}

registerProcessor('spindle-recorder', RecorderProcessor);

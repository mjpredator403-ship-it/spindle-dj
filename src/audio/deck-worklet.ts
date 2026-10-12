// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// AudioWorkletProcessor for one deck. All sample-accurate transport (play,
// pause, seek, rate, loop) happens here on the audio rendering thread; the main
// thread only sends commands and receives position reports.

import { DeckKernel } from './deck-kernel';

type Cmd =
  | { type: 'load'; channels: Float32Array[] }
  | { type: 'unload' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; frame: number }
  | { type: 'rate'; rate: number }
  | { type: 'loop'; on: boolean; start: number; end: number };

const REPORT_EVERY = 6; // blocks (~16 ms at 48 kHz)

class DeckProcessor extends AudioWorkletProcessor {
  private k = new DeckKernel();
  private blocks = 0;
  private wasEnded = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Cmd>) => {
      const m = e.data;
      switch (m.type) {
        case 'load':
          this.k.load(m.channels);
          this.wasEnded = false;
          this.report();
          break;
        case 'unload':
          this.k.unload();
          this.report();
          break;
        case 'play':
          this.k.play();
          this.wasEnded = false;
          break;
        case 'pause':
          this.k.pause();
          break;
        case 'seek':
          this.k.seek(m.frame);
          this.report();
          break;
        case 'rate':
          this.k.setRate(m.rate);
          break;
        case 'loop':
          this.k.setLoop(m.on, m.start, m.end);
          this.report();
          break;
      }
    };
  }

  private report() {
    this.port.postMessage({
      type: 'pos',
      frame: this.k.pos,
      playing: this.k.playing,
      loopOn: this.k.loopOn,
      time: currentTime,
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    this.k.render(L, R, L.length);
    if (++this.blocks >= REPORT_EVERY) {
      this.blocks = 0;
      this.report();
    }
    if (this.k.ended && !this.wasEnded) {
      this.wasEnded = true;
      this.report();
      this.port.postMessage({ type: 'ended' });
    }
    return true;
  }
}

registerProcessor('spindle-deck', DeckProcessor);

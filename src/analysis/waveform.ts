// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Waveform summary computed once per track (cached in IndexedDB) so playback
// never re-decodes for drawing.

export const PEAKS_PER_SEC = 100;

export interface WaveformData {
  peaksPerSec: number;
  peaks: Uint8Array; // max |x| per bucket, 0..255
  lowRatio: Uint8Array; // share of bass energy per bucket, 0..255 (drives colour)
}

export function computeWaveform(x: Float32Array, sampleRate: number, peaksPerSec = PEAKS_PER_SEC): WaveformData {
  const bucket = Math.max(1, Math.round(sampleRate / peaksPerSec));
  const count = Math.ceil(x.length / bucket);
  const peaks = new Uint8Array(count);
  const lowRatio = new Uint8Array(count);
  const a = Math.exp((-2 * Math.PI * 200) / sampleRate); // one-pole LP at 200 Hz
  let lp = 0;
  const raw = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let mx = 0,
      eLow = 0,
      eAll = 0;
    const end = Math.min(x.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      const v = x[i];
      lp = a * lp + (1 - a) * v;
      const av = v < 0 ? -v : v;
      if (av > mx) mx = av;
      eLow += lp * lp;
      eAll += v * v;
    }
    raw[b] = mx;
    lowRatio[b] = eAll > 0 ? Math.min(255, Math.round((eLow / eAll) * 255)) : 0;
  }
  // Absolute scale (not normalised) so quiet tracks look quiet; clamp at 1.0.
  for (let b = 0; b < count; b++) peaks[b] = Math.min(255, Math.round(Math.min(1, raw[b]) * 255));
  return { peaksPerSec, peaks, lowRatio };
}

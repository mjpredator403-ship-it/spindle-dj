// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Musical key estimation: averaged chromagram correlated against the
// Krumhansl–Kessler major/minor key profiles (published research values).
// This is an estimate; accuracy on real mixes is moderate and the UI marks it
// as such with a confidence value.

import { FFT } from './fft';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Camelot wheel codes for major (B) and minor (A) keys, indexed by tonic pitch class.
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

export interface KeyResult {
  tonic: number; // 0..11
  mode: 'major' | 'minor';
  name: string; // e.g. "A minor"
  short: string; // e.g. "Am"
  camelot: string; // e.g. "8A"
  confidence: number; // 0..1
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma,
      y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function chromagram(x: Float32Array, sampleRate: number, size = 4096): number[] {
  const fft = new FFT(size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  // bin → pitch class map, 55 Hz .. 2 kHz
  const pc = new Int8Array(size / 2).fill(-1);
  for (let k = 1; k < size / 2; k++) {
    const f = (k * sampleRate) / size;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    pc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const chroma = new Array(12).fill(0);
  const hop = size; // non-overlapping is enough for a global average
  // cap work: analyse at most ~240 frames spread across the track
  const frames = Math.floor((x.length - size) / hop);
  const stride = Math.max(1, Math.floor(frames / 240));
  for (let f = 0; f < frames; f += stride) {
    const o = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = x[o + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    const frame = new Array(12).fill(0);
    let tot = 0;
    for (let k = 1; k < size / 2; k++) {
      const p = pc[k];
      if (p < 0) continue;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      frame[p] += mag;
      tot += mag;
    }
    if (tot > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / tot;
  }
  return chroma;
}

export function estimateKey(x: Float32Array, sampleRate: number): KeyResult | null {
  if (x.length < sampleRate * 4) return null;
  const chroma = chromagram(x, sampleRate);
  if (chroma.every((v) => v === 0)) return null;
  const scores: { tonic: number; mode: 'major' | 'minor'; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (prof: number[]) => prof.map((_, i) => prof[(i - t + 12) % 12]);
    scores.push({ tonic: t, mode: 'major', r: pearson(chroma, rot(MAJOR)) });
    scores.push({ tonic: t, mode: 'minor', r: pearson(chroma, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const top = scores[0];
  const second = scores[1];
  const confidence = Math.max(0, Math.min(1, (top.r - second.r) * 5 + Math.max(0, top.r - 0.5)));
  const name = `${PITCH_NAMES[top.tonic]} ${top.mode}`;
  const short = PITCH_NAMES[top.tonic] + (top.mode === 'minor' ? 'm' : '');
  const camelot = top.mode === 'major' ? CAMELOT_MAJOR[top.tonic] : CAMELOT_MINOR[top.tonic];
  return { tonic: top.tonic, mode: top.mode, name, short, camelot, confidence };
}

import { describe, expect, it } from 'vitest';
import { estimateTempo, ANALYSIS_RATE } from '../../src/analysis/bpm';
import { estimateKey } from '../../src/analysis/key';
import { computeWaveform } from '../../src/analysis/waveform';
import { FFT } from '../../src/analysis/fft';
import { chord, clickTrack, housePattern, noise, sine } from './synth';

const SR = ANALYSIS_RATE;

function phaseErr(first: number, truth: number, bpm: number) {
  const p = 60 / bpm;
  let d = Math.abs(first - (((truth % p) + p) % p));
  return Math.min(d, p - d);
}

describe('tempo estimation on real (synthesised) audio', () => {
  for (const [bpm, off] of [
    [128, 0.3],
    [95.5, 0.11],
    [174, 0.05],
    [120, 0.0],
    [140.25, 0.42],
    [87, 0.2],
  ] as const) {
    it(`detects ${bpm} BPM and its beat phase`, () => {
      const x = clickTrack(bpm, 60, SR, off);
      const r = estimateTempo(x, SR)!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.bpm - bpm)).toBeLessThan(0.1);
      expect(phaseErr(r.firstBeat, off, bpm)).toBeLessThan(0.015); // < 15 ms
      expect(r.confidence).toBeGreaterThan(0.5);
    });
  }

  for (const bpm of [124, 100, 170]) {
    it(`house pattern with off-beat hats + snare at ${bpm} BPM is not octave-doubled`, () => {
      const r = estimateTempo(housePattern(bpm, 60, SR, 0.25), SR)!;
      expect(Math.abs(r.bpm - bpm)).toBeLessThan(0.1);
      expect(phaseErr(r.firstBeat, 0.25, bpm)).toBeLessThan(0.015);
    });
  }

  it('returns low confidence (not fake certainty) for noise', () => {
    const r = estimateTempo(noise(30, SR), SR);
    if (r) expect(r.confidence).toBeLessThan(0.35);
  });

  it('refuses tracks that are too short to analyse', () => {
    expect(estimateTempo(clickTrack(120, 2, SR), SR)).toBeNull();
  });
});

describe('key estimation', () => {
  it('C major triad → C major', () => {
    const k = estimateKey(chord([60, 64, 67, 48], 12, SR), SR)!;
    expect(k.name).toBe('C major');
    expect(k.camelot).toBe('8B');
  });
  it('A minor triad → A minor', () => {
    const k = estimateKey(chord([57, 60, 64, 45], 12, SR), SR)!;
    expect(k.name).toBe('A minor');
    expect(k.camelot).toBe('8A');
  });
  it('G major triad → G major', () => {
    const k = estimateKey(chord([55, 59, 62, 43], 12, SR), SR)!;
    expect(k.short).toBe('G');
  });
});

describe('waveform summary', () => {
  it('peaks track amplitude and bass ratio separates low and high content', () => {
    const lo = computeWaveform(sine(60, 2, SR, 0.5), SR);
    const hi = computeWaveform(sine(3000, 2, SR, 0.25), SR);
    expect(Math.abs(lo.peaks.length - 200)).toBeLessThanOrEqual(1);
    const mid = 100;
    expect(lo.peaks[mid]).toBeGreaterThan(120);
    expect(lo.peaks[mid]).toBeLessThan(135);
    expect(hi.peaks[mid]).toBeGreaterThan(55);
    expect(hi.peaks[mid]).toBeLessThan(70);
    expect(lo.lowRatio[mid]).toBeGreaterThan(200);
    expect(hi.lowRatio[mid]).toBeLessThan(10);
  });
});

describe('FFT', () => {
  it('finds a bin-centred tone', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    new FFT(n).transform(re, im);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    expect(mag(37)).toBeCloseTo(n / 2, 0);
    expect(mag(36)).toBeLessThan(1e-2);
  });
});

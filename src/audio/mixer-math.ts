// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Pure mixer math shared by the engine and the tests.

export type XfadeCurve = 'smooth' | 'sharp';

/** Crossfader position x ∈ [0,1] (0 = full A, 1 = full B) → [gainA, gainB]. */
export function crossfadeGains(x: number, curve: XfadeCurve = 'smooth'): [number, number] {
  const p = clamp01(x);
  if (curve === 'sharp') {
    // Scratch / cut curve: both full except in the last 6% at each edge.
    const edge = 0.06;
    const a = p <= 1 - edge ? 1 : (1 - p) / edge;
    const b = p >= edge ? 1 : p / edge;
    return [a, b];
  }
  // Equal-power: a² + b² = 1 → constant perceived loudness for uncorrelated tracks.
  return [Math.cos((p * Math.PI) / 2), Math.sin((p * Math.PI) / 2)];
}

/** Channel fader position v ∈ [0,1] → linear gain (audio-taper, ≈ −40 dB at 10%). */
export function faderGain(v: number): number {
  const p = clamp01(v);
  return p * p;
}

/**
 * EQ knob position v ∈ [0,1] → dB. 0 = kill (−40 dB), 0.5 = flat, 1 = +6 dB.
 */
export function eqKnobToDb(v: number): number {
  const p = clamp01(v);
  if (p >= 0.5) return ((p - 0.5) / 0.5) * 6;
  // lower half: steep curve toward a kill
  const t = (0.5 - p) / 0.5; // 0..1
  return -40 * Math.pow(t, 1.6);
}

/** Trim/gain knob v ∈ [0,1] → dB in [−12, +12]. */
export function trimKnobToDb(v: number): number {
  return (clamp01(v) - 0.5) * 24;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return g <= 1e-9 ? -Infinity : 20 * Math.log10(g);
}

/**
 * Bipolar filter knob f ∈ [−1,1] → { lp, hp } cutoff frequencies in Hz.
 * Negative = low-pass sweep, positive = high-pass sweep, ≈0 = bypass.
 */
export function filterKnobToCutoffs(f: number, nyquist = 22050): { lp: number; hp: number; active: boolean } {
  const v = Math.max(-1, Math.min(1, f));
  const open = Math.min(20000, nyquist * 0.95);
  if (Math.abs(v) < 0.03) return { lp: open, hp: 10, active: false };
  if (v < 0) {
    const t = (-v - 0.03) / 0.97;
    return { lp: open * Math.pow(60 / open, t), hp: 10, active: true };
  }
  const t = (v - 0.03) / 0.97;
  return { lp: open, hp: 20 * Math.pow(9000 / 20, t), active: true };
}

/** Pitch-fader percentage + range → playback rate. */
export function pitchToRate(percent: number): number {
  return 1 + percent / 100;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

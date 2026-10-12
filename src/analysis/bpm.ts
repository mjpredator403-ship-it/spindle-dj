// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Tempo + beat-grid estimation from real audio (mono, low sample rate).
//
// Method (original implementation):
//  1. Onset-strength envelope: half-wave-rectified log-energy flux on short
//     hops, computed on a band-limited signal (emphasises kick/snare).
//  2. Coarse tempo: autocorrelation of the envelope over 60–200 BPM lags,
//     weighted toward a 120 BPM prior, folded into a preferred 78–180 range.
//  3. Fine tempo + phase: comb search over ±3 BPM in 0.01 BPM steps,
//     interpolating the envelope at every predicted beat over the whole
//     track and maximising summed onset strength. This gives sub-0.1-BPM
//     accuracy on steady tracks, far beyond the autocorrelation lag grid.
//  4. Confidence: how much the best comb beats the off-beat comb.
//
// Results are estimates. The UI shows confidence and lets the user halve/
// double and shift the grid manually.

export interface TempoResult {
  bpm: number;
  firstBeat: number; // seconds, in [0, period)
  confidence: number; // 0..1
}

export const ANALYSIS_RATE = 11025;
const HOP = 128; // ~11.6 ms at 11025 Hz
const WIN = 512;

export function onsetEnvelope(x: Float32Array, sampleRate: number): { env: Float32Array; fps: number } {
  // Simple 1st-order band-pass emphasis (≈ 40 Hz–4 kHz) to reduce DC/hiss.
  const n = x.length;
  const y = new Float32Array(n);
  const aHp = Math.exp((-2 * Math.PI * 40) / sampleRate);
  const aLp = Math.exp((-2 * Math.PI * 4000) / sampleRate);
  let hpPrevX = 0,
    hpPrevY = 0,
    lp = 0;
  for (let i = 0; i < n; i++) {
    const hp = aHp * (hpPrevY + x[i] - hpPrevX);
    hpPrevX = x[i];
    hpPrevY = hp;
    lp = aLp * lp + (1 - aLp) * hp;
    y[i] = lp;
  }
  const frames = Math.max(0, Math.floor((n - WIN) / HOP) + 1);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * HOP;
    for (let i = 0; i < WIN; i++) {
      const v = y[o + i];
      e += v * v;
    }
    energy[f] = Math.log(1e-9 + e / WIN);
  }
  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    env[f] = d > 0 ? d : 0;
  }
  // remove slow trend (local mean over ~0.5 s) and normalise
  const w = Math.round((0.5 * sampleRate) / HOP);
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += env[f];
    if (f >= w) acc -= env[f - w];
    const mean = acc / Math.min(f + 1, w);
    const v = env[f] - mean;
    out[f] = v > 0 ? v : 0;
  }
  let max = 0;
  for (let f = 0; f < frames; f++) if (out[f] > max) max = out[f];
  if (max > 0) for (let f = 0; f < frames; f++) out[f] /= max;
  return { env: out, fps: sampleRate / HOP };
}

function interp(env: Float32Array, idx: number): number {
  const i0 = Math.floor(idx);
  if (i0 < 0 || i0 + 1 >= env.length) return 0;
  const fr = idx - i0;
  return env[i0] * (1 - fr) + env[i0 + 1] * fr;
}

/** Sum of onset strength on a beat comb; returns best phase for this bpm. */
function combScore(env: Float32Array, fps: number, bpm: number, phaseSteps: number): { score: number; phase: number; offScore: number } {
  const periodF = (60 / bpm) * fps;
  let best = -1,
    bestPh = 0;
  const scores = new Float32Array(phaseSteps);
  for (let s = 0; s < phaseSteps; s++) {
    const ph = (s / phaseSteps) * periodF;
    let sum = 0,
      cnt = 0;
    for (let p = ph; p < env.length - 1; p += periodF) {
      // small max-window to tolerate ±1 frame jitter
      const v = Math.max(interp(env, p - 0.5), interp(env, p), interp(env, p + 0.5));
      sum += v;
      cnt++;
    }
    const sc = cnt ? sum / cnt : 0;
    scores[s] = sc;
    if (sc > best) {
      best = sc;
      bestPh = ph;
    }
  }
  // score at the opposite phase (half a beat away)
  const bestIdx = Math.round((bestPh / periodF) * phaseSteps) % phaseSteps;
  const offScore = scores[(bestIdx + Math.floor(phaseSteps / 2)) % phaseSteps];
  return { score: best, phase: bestPh / fps, offScore };
}

export function estimateTempo(x: Float32Array, sampleRate = ANALYSIS_RATE): TempoResult | null {
  if (x.length < sampleRate * 4) return null; // need ≥ 4 s
  const { env, fps } = onsetEnvelope(x, sampleRate);
  if (env.length < 64) return null;

  // --- coarse: autocorrelation over 60..200 BPM
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  const ac = new Float32Array(maxLag + 2);
  const N = env.length;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (N - lag);
  }
  // candidate peaks with tempo prior (log-gaussian around 120 BPM)
  const cands: { bpm: number; w: number }[] = [];
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0) {
      // parabolic refine
      const a = ac[lag - 1],
        b = ac[lag],
        c = ac[lag + 1];
      const den = a - 2 * b + c;
      const d = den !== 0 ? (0.5 * (a - c)) / den : 0;
      const bpm = (60 * fps) / (lag + d);
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      cands.push({ bpm, w: b * prior });
    }
  }
  if (!cands.length) return null;
  cands.sort((p, q) => q.w - p.w);

  // --- fine comb search around the top few candidates
  const phaseSteps = 48;
  let best = { bpm: 0, score: -1, phase: 0, offScore: 0 };
  for (const c of cands.slice(0, 4)) {
    let center = c.bpm;
    while (center < 78) center *= 2;
    while (center > 180) center /= 2;
    // coarse sweep 0.05, then fine 0.005
    let local = { bpm: center, score: -1, phase: 0, offScore: 0 };
    for (let b = center - 3; b <= center + 3; b += 0.05) {
      const r = combScore(env, fps, b, phaseSteps);
      if (r.score > local.score) local = { bpm: b, ...r };
    }
    const c2 = local.bpm;
    for (let b = c2 - 0.06; b <= c2 + 0.06; b += 0.005) {
      const r = combScore(env, fps, b, phaseSteps);
      if (r.score > local.score) local = { bpm: b, ...r };
    }
    if (local.score > best.score) best = local;
  }
  if (best.score <= 0) return null;

  // Octave check: if the half-beat positions are almost as strong as the beats,
  // the true tempo is double (e.g. a 174 BPM track found at 87).
  if (best.offScore / best.score > 0.7 && best.bpm * 2 <= 190) {
    const d = combScore(env, fps, best.bpm * 2, phaseSteps);
    best = { bpm: best.bpm * 2, ...d };
  }

  // refine phase finely at the chosen tempo
  const fine = combScore(env, fps, best.bpm, 240);
  const period = 60 / best.bpm;
  // Flux at frame f peaks when the onset first enters the analysis window,
  // i.e. ≈ WIN − HOP/2 samples after the frame start (measured on test audio).
  const latency = (WIN - HOP / 2) / sampleRate;
  let firstBeat = fine.phase + latency;
  firstBeat = ((firstBeat % period) + period) % period;
  // Confidence combines (a) beat vs off-beat contrast and (b) how much stronger
  // the beat positions are than the average onset strength. Noise scores low on (b).
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  const contrast = fine.score > 0 ? (fine.score - fine.offScore) / fine.score : 0;
  const salience = mean > 0 ? fine.score / mean : 0;
  const confidence = Math.max(0, Math.min(1, contrast)) * Math.max(0, Math.min(1, (salience - 1.5) / 4));
  return { bpm: Math.round(best.bpm * 100) / 100, firstBeat, confidence };
}

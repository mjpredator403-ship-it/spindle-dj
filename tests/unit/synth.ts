// Test-signal generators with known ground truth.

/** Kick-like click track: decaying 60 Hz sine burst + noise click on every beat. */
export function clickTrack(bpm: number, seconds: number, sr: number, offset = 0, seed = 1): Float32Array {
  const x = new Float32Array(Math.floor(seconds * sr));
  const period = 60 / bpm;
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let t = offset; t < seconds; t += period) {
    const start = Math.round(t * sr);
    for (let i = 0; i < 0.12 * sr && start + i < x.length; i++) {
      const tt = i / sr;
      x[start + i] += 0.8 * Math.sin(2 * Math.PI * 60 * tt) * Math.exp(-tt * 30) + 0.2 * rnd() * Math.exp(-tt * 300);
    }
  }
  // light background noise so it's not a trivially silent signal
  for (let i = 0; i < x.length; i++) x[i] += 0.01 * rnd();
  return x;
}

export function noise(seconds: number, sr: number, seed = 7): Float32Array {
  const x = new Float32Array(Math.floor(seconds * sr));
  let s = seed;
  for (let i = 0; i < x.length; i++) x[i] = (((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1) * 0.3;
  return x;
}

/** Sustained chord made of harmonic tones (MIDI note numbers). */
export function chord(midiNotes: number[], seconds: number, sr: number): Float32Array {
  const x = new Float32Array(Math.floor(seconds * sr));
  for (const m of midiNotes) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    for (let h = 1; h <= 3; h++) {
      const amp = 0.2 / h;
      for (let i = 0; i < x.length; i++) x[i] += amp * Math.sin((2 * Math.PI * f * h * i) / sr);
    }
  }
  return x;
}

export function sine(freq: number, seconds: number, sr: number, amp = 0.5): Float32Array {
  const x = new Float32Array(Math.floor(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

/** Goertzel magnitude of a single frequency (normalised to sine amplitude). */
export function toneLevel(x: Float32Array, freq: number, sr: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / x.length;
}

/** House-style bar: kick on every beat, snare on 2 & 4, open hat on every off-beat, bass line. */
export function housePattern(bpm: number, seconds: number, sr: number, offset = 0): Float32Array {
  const x = clickTrack(bpm, seconds, sr, offset, 3);
  const p = 60 / bpm;
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  let beat = 0;
  for (let t = offset; t < seconds; t += p, beat++) {
    const hat = Math.round((t + p / 2) * sr);
    for (let i = 0; i < 0.05 * sr && hat + i < x.length; i++) x[hat + i] += 0.25 * rnd() * Math.exp((-i / sr) * 80);
    if (beat % 2 === 1) {
      const sn = Math.round(t * sr);
      for (let i = 0; i < 0.15 * sr && sn + i < x.length; i++) x[sn + i] += 0.35 * rnd() * Math.exp((-i / sr) * 25);
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += 0.1 * Math.sin((2 * Math.PI * 55 * i) / sr);
  return x;
}

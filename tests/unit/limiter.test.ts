import { describe, expect, it } from 'vitest';
import { LimiterKernel } from '../../src/audio/limiter-kernel';

function run(k: LimiterKernel, x: Float32Array) {
  const yl = new Float32Array(x.length);
  const yr = new Float32Array(x.length);
  for (let o = 0; o < x.length; o += 128) {
    const n = Math.min(128, x.length - o);
    k.process(x.subarray(o, o + n), x.subarray(o, o + n), yl.subarray(o, o + n), yr.subarray(o, o + n), n);
  }
  return yl;
}

const SR = 48000;
const ceil = Math.pow(10, -1 / 20);

describe('LimiterKernel', () => {
  it('is transparent below the ceiling (unity gain, just delayed — no make-up gain)', () => {
    const k = new LimiterKernel(SR);
    const x = new Float32Array(SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const y = run(k, x);
    const d = k.latencyFrames;
    let maxErr = 0;
    for (let i = d; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i - d]));
    expect(maxErr).toBe(0);
  });

  it('never lets a peak through the ceiling, even a sudden full-scale transient', () => {
    const k = new LimiterKernel(SR);
    const x = new Float32Array(SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 100 * i) / SR);
    for (let i = 20000; i < 20050; i++) x[i] = i % 2 ? 2.5 : -2.5; // +8 dBFS burst
    for (let i = 30000; i < 40000; i++) x[i] = 1.6 * Math.sin((2 * Math.PI * 60 * i) / SR);
    const y = run(k, x);
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(ceil + 1e-6);
  });

  it('reduces gain smoothly (look-ahead) rather than hard clipping a loud sine', () => {
    const k = new LimiterKernel(SR);
    const x = new Float32Array(SR);
    for (let i = 0; i < x.length; i++) x[i] = 1.5 * Math.sin((2 * Math.PI * 200 * i) / SR);
    const y = run(k, x);
    // after settling, the waveform should be a scaled sine: count samples sitting exactly on the ceiling
    let pinned = 0;
    for (let i = SR / 2; i < SR; i++) if (Math.abs(Math.abs(y[i]) - ceil) < 1e-7) pinned++;
    expect(pinned).toBeLessThan(SR * 0.01);
    expect(k.env).toBeLessThan(0.65);
  });

  it('releases back to unity after the loud part', () => {
    const k = new LimiterKernel(SR);
    const x = new Float32Array(SR * 2);
    for (let i = 0; i < SR / 2; i++) x[i] = 1.8 * Math.sin((2 * Math.PI * 200 * i) / SR);
    for (let i = SR / 2; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR);
    run(k, x);
    expect(k.env).toBeGreaterThan(0.999);
  });
});

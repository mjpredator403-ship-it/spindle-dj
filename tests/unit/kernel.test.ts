import { describe, expect, it } from 'vitest';
import { DeckKernel, FADE_FRAMES } from '../../src/audio/deck-kernel';

function ramp(n: number) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = i / n;
  return x;
}

function run(k: DeckKernel, frames: number) {
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let o = 0; o < frames; o += 128) {
    const n = Math.min(128, frames - o);
    k.render(L.subarray(o, o + n), R.subarray(o, o + n), n);
  }
  return { L, R };
}

describe('DeckKernel', () => {
  it('is silent until play, then plays the samples at rate 1 after a short fade', () => {
    const k = new DeckKernel();
    const src = ramp(48000);
    k.load([src, src]);
    expect(run(k, 256).L.every((v) => v === 0)).toBe(true);
    expect(k.pos).toBe(0);
    k.play();
    const { L } = run(k, 1024);
    // after fade, output == source sample
    expect(L[FADE_FRAMES + 10]).toBeCloseTo(src[FADE_FRAMES + 10], 6);
    expect(L[0]).toBe(0); // fade starts at 0 — no click
    expect(k.pos).toBeCloseTo(1024, 6);
  });

  it('rate 2 advances twice as fast (vinyl-style pitch+tempo)', () => {
    const k = new DeckKernel();
    k.load([ramp(48000)]);
    k.setRate(2);
    k.play();
    run(k, 1000);
    expect(k.pos).toBeCloseTo(2000, 6);
  });

  it('pause stops position after a fade-out and resumes from there', () => {
    const k = new DeckKernel();
    k.load([ramp(48000)]);
    k.play();
    run(k, 1000);
    k.pause();
    run(k, 500);
    const stopped = k.pos;
    expect(stopped).toBeGreaterThanOrEqual(1000);
    expect(stopped).toBeLessThanOrEqual(1000 + FADE_FRAMES + 1);
    run(k, 500);
    expect(k.pos).toBe(stopped);
  });

  it('loops wrap exactly and never leave the loop region', () => {
    const k = new DeckKernel();
    k.load([ramp(48000)]);
    k.seek(1000);
    k.setLoop(true, 1000, 1500);
    k.play();
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < 100; i++) {
      run(k, 37);
      min = Math.min(min, k.pos);
      max = Math.max(max, k.pos);
    }
    expect(min).toBeGreaterThanOrEqual(1000);
    expect(max).toBeLessThan(1500);
    k.setLoop(false);
    run(k, 2000);
    expect(k.pos).toBeGreaterThan(1500);
  });

  it('engaging a loop behind the playhead wraps into the loop', () => {
    const k = new DeckKernel();
    k.load([ramp(48000)]);
    k.seek(3000);
    k.setLoop(true, 1000, 1500);
    expect(k.pos).toBeGreaterThanOrEqual(1000);
    expect(k.pos).toBeLessThan(1500);
  });

  it('rejects degenerate loops', () => {
    const k = new DeckKernel();
    k.load([ramp(48000)]);
    k.setLoop(true, 100, 110);
    expect(k.loopOn).toBe(false);
  });

  it('seek while playing fades out, jumps, fades in', () => {
    const k = new DeckKernel();
    const src = ramp(48000);
    k.load([src]);
    k.play();
    run(k, 1000);
    k.seek(20000);
    const { L } = run(k, 1000);
    expect(k.pos).toBeGreaterThan(20000);
    expect(k.pos).toBeLessThan(21000);
    // no sample jumps by more than a smooth amount (no click)
    let maxJump = 0;
    for (let i = 1; i < L.length; i++) maxJump = Math.max(maxJump, Math.abs(L[i] - L[i - 1]));
    expect(maxJump).toBeLessThan(0.02);
  });

  it('stops and flags ended at the end of the track', () => {
    const k = new DeckKernel();
    k.load([ramp(2000)]);
    k.play();
    run(k, 4000);
    expect(k.ended).toBe(true);
    expect(k.playing).toBe(false);
    k.play(); // play after end restarts
    expect(k.pos).toBe(0);
  });
});

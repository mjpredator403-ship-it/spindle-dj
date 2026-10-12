import { describe, expect, it } from 'vitest';
import { crossfadeGains, eqKnobToDb, faderGain, filterKnobToCutoffs, trimKnobToDb } from '../../src/audio/mixer-math';
import { beatLoop, beatPhase, gridFromBeatAt, nudgeGrid, phaseAlignedTime, phaseDifference, syncRate } from '../../src/audio/beat-math';

describe('crossfader', () => {
  it('equal-power: endpoints and constant power', () => {
    expect(crossfadeGains(0)).toEqual([1, 0]);
    const [a1, b1] = crossfadeGains(1);
    expect(a1).toBeCloseTo(0, 10);
    expect(b1).toBeCloseTo(1, 10);
    for (let x = 0; x <= 1; x += 0.05) {
      const [a, b] = crossfadeGains(x);
      expect(a * a + b * b).toBeCloseTo(1, 10);
    }
    const [a, b] = crossfadeGains(0.5);
    expect(a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(b).toBeCloseTo(Math.SQRT1_2, 10);
  });
  it('sharp curve keeps both channels full in the middle and cuts at edges', () => {
    expect(crossfadeGains(0.5, 'sharp')).toEqual([1, 1]);
    expect(crossfadeGains(0, 'sharp')).toEqual([1, 0]);
    expect(crossfadeGains(1, 'sharp')).toEqual([0, 1]);
  });
  it('never exceeds unity (no volume spikes) and clamps input', () => {
    for (const x of [-5, -0.1, 0.3, 0.77, 1.5, NaN]) {
      for (const c of ['smooth', 'sharp'] as const) {
        const [a, b] = crossfadeGains(x, c);
        expect(a).toBeLessThanOrEqual(1);
        expect(b).toBeLessThanOrEqual(1);
        expect(a).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('knob tapers', () => {
  it('EQ: kill / flat / +6', () => {
    expect(eqKnobToDb(0)).toBeCloseTo(-40);
    expect(eqKnobToDb(0.5)).toBe(0);
    expect(eqKnobToDb(1)).toBeCloseTo(6);
  });
  it('trim ±12 dB, fader taper monotonic', () => {
    expect(trimKnobToDb(0)).toBe(-12);
    expect(trimKnobToDb(1)).toBe(12);
    expect(faderGain(1)).toBe(1);
    expect(faderGain(0)).toBe(0);
    expect(faderGain(0.5)).toBeLessThan(0.5);
  });
  it('filter: bypass at centre, LP left, HP right', () => {
    expect(filterKnobToCutoffs(0).active).toBe(false);
    const l = filterKnobToCutoffs(-1);
    expect(l.lp).toBeCloseTo(60, 0);
    const r = filterKnobToCutoffs(1);
    expect(r.hp).toBeCloseTo(9000, 0);
    expect(filterKnobToCutoffs(-0.5).lp).toBeLessThan(filterKnobToCutoffs(-0.2).lp);
  });
});

describe('beat math', () => {
  const g = { bpm: 120, firstBeat: 0.1 };
  it('quantised loops start on a beat and have exact length', () => {
    const l = beatLoop(g, 10.37, 4, 300, true)!;
    expect(l.start).toBeCloseTo(10.1, 9);
    expect(l.end - l.start).toBeCloseTo(2, 9);
  });
  it('loops are kept inside the track', () => {
    const l = beatLoop(g, 299.5, 8, 300, true)!;
    expect(l.end).toBeLessThanOrEqual(300);
    expect(l.end - l.start).toBeCloseTo(4, 9);
    expect(beatLoop(g, 0.5, 16, 3, true)).toBeNull();
  });
  it('unquantised loop starts at the playhead', () => {
    const l = beatLoop(g, 10.37, 1, 300, false)!;
    expect(l.start).toBeCloseTo(10.37, 9);
  });
  it('sync rate matches tempo and prefers half/double', () => {
    expect(syncRate(128, 1, 126)).toBeCloseTo(128 / 126, 9);
    expect(syncRate(128, 1.02, 128)).toBeCloseTo(1.02, 9);
    expect(syncRate(140, 1, 70)).toBeCloseTo(1, 9); // half-time
    expect(syncRate(87, 1, 174)).toBeCloseTo(1, 9); // double-time
  });
  it('phase alignment moves the follower by < half a beat to match phase', () => {
    const leader = { bpm: 128, firstBeat: 0.05 };
    const follower = { bpm: 128, firstBeat: 0.2 };
    const lt = 33.333;
    const ft = 51.9;
    const nt = phaseAlignedTime(leader, lt, follower, ft);
    expect(Math.abs(nt - ft)).toBeLessThanOrEqual(60 / 128 / 2 + 1e-9);
    expect(phaseDifference(leader, lt, follower, nt)).toBeCloseTo(0, 9);
    expect(beatPhase(follower, nt)).toBeCloseTo(beatPhase(leader, lt), 9);
  });
  it('manual grid correction', () => {
    const n = nudgeGrid(g, 10);
    expect(n.firstBeat).toBeCloseTo(0.11, 9);
    const back = nudgeGrid({ bpm: 120, firstBeat: 0.005 }, -10);
    expect(back.firstBeat).toBeCloseTo(0.495, 9);
    expect(gridFromBeatAt(g, 7.3).firstBeat).toBeCloseTo(0.3, 9);
  });
});

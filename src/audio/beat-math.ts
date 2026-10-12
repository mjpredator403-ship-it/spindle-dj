// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Pure beat-grid, loop and sync math (track-time seconds). Unit-tested.

export interface BeatGrid {
  bpm: number; // track-native BPM (rate = 1)
  firstBeat: number; // seconds of a downbeat-aligned beat
}

export function beatPeriod(grid: BeatGrid): number {
  return 60 / grid.bpm;
}

/** Continuous beat index at time t (can be negative before firstBeat). */
export function beatIndexAt(grid: BeatGrid, t: number): number {
  return (t - grid.firstBeat) / beatPeriod(grid);
}

/** Phase within the current beat in [0,1). */
export function beatPhase(grid: BeatGrid, t: number): number {
  const b = beatIndexAt(grid, t);
  return b - Math.floor(b);
}

/** Nearest beat time to t. */
export function nearestBeat(grid: BeatGrid, t: number): number {
  return grid.firstBeat + Math.round(beatIndexAt(grid, t)) * beatPeriod(grid);
}

/** Beat at or before t (used to quantise loop-in). */
export function previousBeat(grid: BeatGrid, t: number): number {
  return grid.firstBeat + Math.floor(beatIndexAt(grid, t) + 1e-6) * beatPeriod(grid);
}

/**
 * Compute a beat loop [start, end] for `beats` beats beginning at the beat
 * at/before `t` (quantised) or at `t` itself (unquantised), clamped to the
 * track. Returns null if the loop cannot fit.
 */
export function beatLoop(
  grid: BeatGrid,
  t: number,
  beats: number,
  duration: number,
  quantize: boolean,
): { start: number; end: number } | null {
  const len = beats * beatPeriod(grid);
  let start = quantize ? previousBeat(grid, t) : t;
  if (start < 0) start = quantize ? grid.firstBeat : 0;
  let end = start + len;
  if (end > duration) {
    // shift back so the loop stays inside the track
    end = quantize ? previousBeat(grid, duration) : duration;
    start = end - len;
    if (start < 0) return null;
  }
  if (end - start <= 0.005) return null;
  return { start, end };
}

/**
 * Tempo-match: playback rate for the follower so its effective BPM equals the
 * leader's. Chooses ×½ / ×2 relationship when that is closer to 1.0.
 */
export function syncRate(leaderBpm: number, leaderRate: number, followerBpm: number): number {
  const target = leaderBpm * leaderRate;
  const candidates = [target, target * 2, target / 2].map((b) => b / followerBpm);
  candidates.sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)));
  return candidates[0];
}

/**
 * Phase-align: new follower time so that its beat phase equals the leader's,
 * moving the follower by less than half a beat.
 */
export function phaseAlignedTime(leader: BeatGrid, leaderT: number, follower: BeatGrid, followerT: number): number {
  const target = beatPhase(leader, leaderT);
  const cur = beatIndexAt(follower, followerT);
  const base = Math.floor(cur);
  let best = base + target;
  for (const cand of [base - 1 + target, base + target, base + 1 + target]) {
    if (Math.abs(cand - cur) < Math.abs(best - cur)) best = cand;
  }
  return follower.firstBeat + best * beatPeriod(follower);
}

/** Signed phase difference follower − leader in beats, in [−0.5, 0.5). */
export function phaseDifference(leader: BeatGrid, leaderT: number, follower: BeatGrid, followerT: number): number {
  let d = beatPhase(follower, followerT) - beatPhase(leader, leaderT);
  if (d >= 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

/** Shift a grid by a number of milliseconds (manual grid correction). */
export function nudgeGrid(grid: BeatGrid, ms: number): BeatGrid {
  const p = beatPeriod(grid);
  let fb = grid.firstBeat + ms / 1000;
  fb = ((fb % p) + p) % p;
  return { bpm: grid.bpm, firstBeat: fb };
}

/** Set the downbeat to time t (manual grid correction "beat here"). */
export function gridFromBeatAt(grid: BeatGrid, t: number): BeatGrid {
  const p = beatPeriod(grid);
  return { bpm: grid.bpm, firstBeat: ((t % p) + p) % p };
}

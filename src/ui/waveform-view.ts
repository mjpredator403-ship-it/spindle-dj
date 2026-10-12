// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Canvas waveform renderers. Data comes from the cached analysis (100 peaks/s),
// so drawing never touches decoded audio.

import type { Deck } from '../deck';
import { beatPeriod } from '../audio/beat-math';

export const DECK_COLORS = ['#3cc8ff', '#ff9a3c'];
const BG = '#0b0d10';

function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const hh = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== hh) {
    c.width = w;
    c.height = hh;
  }
  return c.getContext('2d')!;
}

function waveColor(low: number, base: string): string {
  // bass-heavy buckets warmer/brighter, highs cooler
  return low > 150 ? base : low > 80 ? mix(base, '#ffffff', 0.25) : mix(base, '#9aa7ff', 0.45);
}
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Zoomed, scrolling waveform with centred playhead, beat grid, cues, loop. */
export function drawScrolling(c: HTMLCanvasElement, deck: Deck, zoomSec: number) {
  const ctx = setupCanvas(c);
  const W = c.width,
    H = c.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const color = DECK_COLORS[deck.index];
  const mid = H / 2;
  if (!deck.loaded) {
    ctx.fillStyle = '#3a414c';
    ctx.font = `${Math.round(H * 0.28)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(deck.loading ? deck.loadingMsg : `Deck ${deck.name} — drop or load a track`, W / 2, mid);
    return;
  }
  const pos = deck.position();
  const pxPerSec = W / zoomSec;
  const t0 = pos - zoomSec / 2;
  const toX = (t: number) => (t - t0) * pxPerSec;

  // loop region
  if (deck.loop) {
    ctx.fillStyle = deck.loop.on ? 'rgba(80,220,120,0.18)' : 'rgba(80,220,120,0.07)';
    ctx.fillRect(toX(deck.loop.start), 0, (deck.loop.end - deck.loop.start) * pxPerSec, H);
  }

  const w = deck.wave;
  if (w) {
    const pps = w.peaksPerSec;
    const step = Math.max(1, Math.floor(1 / ((pxPerSec / pps) || 1)));
    for (let x = 0; x < W; x++) {
      const t = t0 + x / pxPerSec;
      const i = Math.floor(t * pps);
      if (i < 0 || i >= w.peaks.length) continue;
      let p = 0,
        lr = 0;
      for (let k = 0; k < step && i + k < w.peaks.length; k++) {
        if (w.peaks[i + k] > p) p = w.peaks[i + k];
        lr = w.lowRatio[i + k];
      }
      const amp = (p / 255) * (mid - 2);
      ctx.fillStyle = t < pos ? mix(waveColor(lr, color), BG, 0.45) : waveColor(lr, color);
      ctx.fillRect(x, mid - amp, 1, amp * 2 || 1);
    }
  } else {
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(0, mid - 1, W, 2);
    ctx.fillStyle = '#7d8794';
    ctx.font = `${Math.round(H * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(deck.loadingMsg || 'Analysing…', W / 2, H * 0.3);
  }

  // beat grid
  const g = deck.grid;
  if (g) {
    const p = beatPeriod(g);
    const firstIdx = Math.ceil((t0 - g.firstBeat) / p);
    for (let b = firstIdx; ; b++) {
      const t = g.firstBeat + b * p;
      const x = toX(t);
      if (x > W) break;
      const bar = ((b % 4) + 4) % 4 === 0;
      ctx.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(Math.round(x), 0, bar ? 2 : 1, bar ? H : H * 0.18);
      if (!bar) ctx.fillRect(Math.round(x), H * 0.82, 1, H * 0.18);
    }
  }

  // cue + hot cues
  const tr = deck.track!;
  const marker = (t: number, col: string, label: string) => {
    const x = toX(t);
    if (x < -10 || x > W + 10) return;
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 7, 0);
    ctx.lineTo(x + 1, 8);
    ctx.fill();
    if (label) {
      ctx.font = `bold ${Math.max(9, Math.round(H * 0.16))}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 4, H - 4);
    }
  };
  if (tr.cue !== undefined) marker(tr.cue, '#ffd84a', 'C');
  tr.hotCues.forEach((v, i) => v !== null && marker(v, HOT_COLORS[i % HOT_COLORS.length], String(i + 1)));
  if (deck.loopInPoint !== null && !deck.loop?.on) marker(deck.loopInPoint, '#50dc78', 'IN');

  // playhead
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(W / 2) - 1, 0, 2, H);
}

export const HOT_COLORS = ['#ff4d6d', '#ffb703', '#8ac926', '#4cc9f0', '#b388ff', '#ff6fd8', '#00e5b0', '#f4a261'];

/** Whole-track overview; returns nothing — caller handles click-to-seek. */
export function drawOverview(c: HTMLCanvasElement, deck: Deck) {
  const ctx = setupCanvas(c);
  const W = c.width,
    H = c.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  if (!deck.loaded) return;
  const color = DECK_COLORS[deck.index];
  const dur = deck.duration;
  const pos = deck.position();
  const w = deck.wave;
  const mid = H / 2;
  if (w) {
    const n = w.peaks.length;
    for (let x = 0; x < W; x++) {
      const a = Math.floor((x / W) * n);
      const b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
      let p = 0;
      for (let i = a; i < b && i < n; i++) if (w.peaks[i] > p) p = w.peaks[i];
      const amp = (p / 255) * (mid - 1);
      ctx.fillStyle = (x / W) * dur < pos ? mix(color, BG, 0.55) : color;
      ctx.fillRect(x, mid - amp, 1, amp * 2 || 1);
    }
  } else {
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(0, mid - 1, W, 2);
  }
  if (deck.loop) {
    ctx.fillStyle = 'rgba(80,220,120,0.35)';
    ctx.fillRect((deck.loop.start / dur) * W, 0, Math.max(2, ((deck.loop.end - deck.loop.start) / dur) * W), H);
  }
  const tr = deck.track!;
  if (tr.cue !== undefined) {
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect((tr.cue / dur) * W, 0, 2, H);
  }
  tr.hotCues.forEach((v, i) => {
    if (v === null) return;
    ctx.fillStyle = HOT_COLORS[i % HOT_COLORS.length];
    ctx.fillRect((v / dur) * W, 0, 2, H * 0.4);
  });
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.round((pos / dur) * W) - 1, 0, 2, H);
  // end-of-track warning (last 30 s)
  if (dur - pos < 30 && deck.playing) {
    ctx.strokeStyle = (Math.floor(performance.now() / 400) % 2) ? '#ff4d6d' : 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }
}

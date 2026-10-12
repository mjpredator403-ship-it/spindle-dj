// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Jog wheel / platter. Rotation follows real playback position (33⅓ rpm × rate).
// Drag while playing = pitch bend (nudge); drag while paused = scrub/seek.

import type { Deck } from '../deck';
import { DECK_COLORS } from './waveform-view';
import { safeCapture } from './dom';

const SEC_PER_REV = 1.8; // 33⅓ rpm

export class Platter {
  readonly el: HTMLCanvasElement;
  private dragging = false;
  private lastAngle = 0;
  private lastT = 0;
  private bendTimer = 0;

  constructor(private deck: Deck) {
    this.el = document.createElement('canvas');
    this.el.className = 'platter';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', `Deck ${deck.name} jog wheel: drag to nudge while playing, or scrub while paused`);
    this.el.title = 'Jog wheel — drag around: nudge tempo while playing, scrub while paused';
    this.el.addEventListener('pointerdown', (e) => {
      if (!deck.loaded) return;
      this.dragging = true;
      this.lastAngle = this.angle(e);
      this.lastT = performance.now();
      safeCapture(this.el, e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const a = this.angle(e);
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.lastAngle = a;
      const now = performance.now();
      const dt = Math.max(1, now - this.lastT) / 1000;
      this.lastT = now;
      const revs = d / (2 * Math.PI);
      if (deck.playing) {
        // angular speed relative to nominal → bend, gently limited
        const nominal = deck.rate / SEC_PER_REV; // rev/s
        const bend = Math.max(-0.3, Math.min(0.3, (revs / dt / Math.max(0.05, nominal)) * 0.15));
        deck.setBend(bend);
        clearTimeout(this.bendTimer);
        this.bendTimer = window.setTimeout(() => deck.setBend(0), 80);
      } else {
        deck.seek(deck.position() + revs * SEC_PER_REV);
      }
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      deck.setBend(0);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private angle(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  draw() {
    const c = this.el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.round(Math.min(c.clientWidth, c.clientHeight) * dpr);
    if (s < 24) return; // not laid out / hidden
    if (c.width !== s || c.height !== s) {
      c.width = s;
      c.height = s;
    }
    const ctx = c.getContext('2d')!;
    const r = s / 2;
    ctx.clearRect(0, 0, s, s);
    const color = DECK_COLORS[this.deck.index];
    // outer ring
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#14181d';
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.02);
    ctx.strokeStyle = this.deck.playing ? color : '#2c333c';
    ctx.stroke();
    // grooves
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let k = 0.45; k < 0.92; k += 0.06) {
      ctx.beginPath();
      ctx.arc(r, r, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // label
    ctx.beginPath();
    ctx.arc(r, r, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#1d232b';
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(r * 0.28)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.deck.name, r, r);
    // position marker
    const ang = ((this.deck.position() / SEC_PER_REV) % 1) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#f2f4f7';
    ctx.lineWidth = Math.max(2, s * 0.025);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r + Math.cos(ang) * r * 0.42, r + Math.sin(ang) * r * 0.42);
    ctx.lineTo(r + Math.cos(ang) * r * 0.9, r + Math.sin(ang) * r * 0.9);
    ctx.stroke();
    // loop ring
    if (this.deck.loop?.on) {
      ctx.strokeStyle = '#50dc78';
      ctx.lineWidth = Math.max(2, s * 0.02);
      ctx.beginPath();
      ctx.arc(r, r, r - 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

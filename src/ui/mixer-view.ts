// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import type { Deck } from '../deck';
import type { Engine, Meter } from '../audio/engine';
import type { Settings } from '../settings';
import { eqKnobToDb, gainToDb, trimKnobToDb } from '../audio/mixer-math';
import { phaseDifference } from '../audio/beat-math';
import { fader, h, Knob, setText, toggleClass } from './dom';
import { DECK_COLORS } from './waveform-view';

class MeterView {
  readonly el: HTMLElement;
  private bar = h('div', { class: 'm-bar' });
  private hold = h('div', { class: 'm-hold' });
  private clip = h('div', { class: 'm-clip', title: 'Clip indicator (signal reached 0 dBFS)' });
  constructor(private meter: Meter, label: string) {
    this.el = h('div', { class: 'meter', role: 'meter', 'aria-label': label, title: label }, this.clip, h('div', { class: 'm-track' }, this.bar, this.hold));
  }
  frame(now: number) {
    const p = this.meter.read(now);
    const pct = (v: number) => {
      const db = gainToDb(v);
      return Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
    };
    this.bar.style.height = `${pct(p)}%`;
    this.hold.style.bottom = `${pct(this.meter.peakHold)}%`;
    toggleClass(this.clip, 'on', now < this.meter.clipUntil);
  }
}

export class MixerView {
  readonly el: HTMLElement;
  private meters: MeterView[] = [];
  private limLed = h('div', { class: 'led lim', title: 'Limiter active (protecting the output from clipping)' }, 'LIM');
  private clipLed = h('div', { class: 'led clip', title: 'Master would clip without the limiter — turn something down' }, 'CLIP');
  private phase = h('div', { class: 'phase-needle' });
  private phaseBox: HTMLElement;
  private xf: HTMLInputElement;
  private curveBtn: HTMLButtonElement;

  constructor(private engine: Engine, private decks: [Deck, Deck], private settings: Settings, registerKnob: (id: string, set: (v: number) => void) => void) {
    const channel = (d: Deck) => {
      const p = d.index === 0 ? 'a' : 'b';
      const color = DECK_COLORS[d.index];
      const dbFmt = (f: (v: number) => number) => (v: number) => {
        const db = f(v);
        return db <= -39 ? 'kill' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
      };
      const mk = (id: string, label: string, fmt: (v: number) => string, fn: (v: number) => void) => {
        const k = new Knob({ label, value: 0.5, def: 0.5, size: 32, color, format: fmt, onInput: fn, bipolar: true });
        registerKnob(`${p}.${id}`, (v) => k.set(v));
        return k.el;
      };
      const vol = fader({ label: `Deck ${d.name} volume`, value: 1, vertical: true, className: 'chfader', def: 1, onInput: (v) => d.ch.setFader(v) });
      registerKnob(`${p}.volume`, (v) => (vol.value = String(v)));
      const meter = new MeterView(d.ch.meter, `Deck ${d.name} level`);
      this.meters.push(meter);
      return h(
        'div',
        { class: `ch ch-${p}` },
        h('div', { class: 'ch-label', style: `color:${color}` }, d.name),
        mk('trim', 'GAIN', dbFmt(trimKnobToDb), (v) => d.ch.setTrim(v)),
        mk('eqHigh', 'HI', dbFmt(eqKnobToDb), (v) => d.ch.setEq('high', v)),
        mk('eqMid', 'MID', dbFmt(eqKnobToDb), (v) => d.ch.setEq('mid', v)),
        mk('eqLow', 'LOW', dbFmt(eqKnobToDb), (v) => d.ch.setEq('low', v)),
        h('div', { class: 'ch-fader-row' }, vol, meter.el),
      );
    };
    const chA = channel(decks[0]);
    const chB = channel(decks[1]);

    const master = new Knob({
      label: 'MASTER',
      value: 0.85,
      def: 0.85,
      size: 36,
      color: '#e8eaee',
      format: (v) => {
        const db = gainToDb(v * v);
        return Number.isFinite(db) ? `${db.toFixed(1)}` : '-∞';
      },
      onInput: (v) => engine.setMasterVolume(v),
    });
    engine.setMasterVolume(0.85);
    registerKnob('master', (v) => master.set(v));
    const mm = new MeterView(engine.masterMeter, 'Master output level');
    this.meters.push(mm);

    this.phaseBox = h('div', { class: 'phase', title: 'Beat phase: deck B relative to deck A (centre = aligned)', 'aria-hidden': 'true' }, h('div', { class: 'phase-mid' }), this.phase);

    this.xf = fader({
      label: 'Crossfader',
      value: 0.5,
      className: 'xfader',
      def: 0.5,
      onInput: (v) => engine.setCrossfader(v, settings.get('xfadeCurve')),
    });
    registerKnob('xf', (v) => (this.xf.value = String(v)));
    this.curveBtn = h('button', { class: 'sm', title: 'Crossfader curve: smooth (equal-power, for blending) or sharp (cut, for scratching)', onclick: () => this.toggleCurve() }) as HTMLButtonElement;
    this.renderCurve();

    this.el = h(
      'section',
      { class: 'mixer', 'aria-label': 'Mixer' },
      h(
        'div',
        { class: 'mixer-top' },
        chA,
        h('div', { class: 'master' }, master.el, h('div', { class: 'leds' }, this.clipLed, this.limLed), mm.el, this.phaseBox),
        chB,
      ),
      h('div', { class: 'xf-row' }, h('span', { class: 'xf-l', style: `color:${DECK_COLORS[0]}` }, 'A'), this.xf, h('span', { class: 'xf-r', style: `color:${DECK_COLORS[1]}` }, 'B'), this.curveBtn),
    );
  }

  private toggleCurve() {
    const c = this.settings.get('xfadeCurve') === 'smooth' ? 'sharp' : 'smooth';
    this.settings.set('xfadeCurve', c);
    this.engine.setCrossfader(this.engine.xfadePos, c);
    this.renderCurve();
  }
  private renderCurve() {
    const smooth = this.settings.get('xfadeCurve') === 'smooth';
    setText(this.curveBtn, smooth ? '⌒' : '⊓');
    this.curveBtn.setAttribute('aria-label', `Crossfader curve: ${smooth ? 'smooth' : 'sharp'}`);
  }

  frame() {
    const now = performance.now() / 1000;
    for (const m of this.meters) m.frame(now);
    const red = this.engine.limiterReductionDb();
    toggleClass(this.limLed, 'on', red > 0.5);
    this.engine.preMeter.read(now);
    toggleClass(this.clipLed, 'on', now < this.engine.preMeter.clipUntil);
    const [a, b] = this.decks;
    if (a.grid && b.grid && a.loaded && b.loaded) {
      const d = phaseDifference(a.grid, a.position(), b.grid, b.position());
      this.phase.style.left = `${50 + d * 100}%`;
      this.phaseBox.classList.remove('off');
      toggleClass(this.phase, 'locked', Math.abs(d) < 0.03);
    } else this.phaseBox.classList.add('off');
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Central action registry shared by keyboard shortcuts and MIDI mapping.
// kind:
//   button  — press/release (value 1 / 0)
//   value   — absolute 0..1 (faders, knobs)
//   relative— signed delta (jog wheels, encoders)

import type { Deck } from '../deck';
import type { Engine } from '../audio/engine';
import type { Settings } from '../settings';
import { LOOP_SIZES } from '../deck';

export type ActionKind = 'button' | 'value' | 'relative';

export interface Action {
  id: string;
  label: string;
  kind: ActionKind;
  run(v: number): void;
}

export interface ActionHost {
  decks: [Deck, Deck];
  engine: Engine;
  settings: Settings;
  ui: {
    setKnob(id: string, v: number): void; // keeps on-screen controls in sync
    toggleRecord(): void;
    focusSearch(): void;
  };
}

export function buildActions(h: ActionHost): Map<string, Action> {
  const m = new Map<string, Action>();
  const add = (a: Action) => m.set(a.id, a);
  for (const d of h.decks) {
    const p = d.index === 0 ? 'a' : 'b';
    const other = h.decks[1 - d.index];
    const D = `Deck ${d.name}`;
    const press = (fn: () => void) => (v: number) => {
      if (v > 0) fn();
    };
    add({ id: `${p}.play`, label: `${D} play/pause`, kind: 'button', run: press(() => (d.playFromPreview() ? undefined : d.togglePlay())) });
    add({ id: `${p}.cue`, label: `${D} cue`, kind: 'button', run: (v) => (v > 0 ? d.cueDown() : d.cueUp()) });
    add({ id: `${p}.stop`, label: `${D} stop / to start`, kind: 'button', run: press(() => d.stop()) });
    add({ id: `${p}.sync`, label: `${D} sync`, kind: 'button', run: press(() => (d.synced ? d.unsync() : d.sync(other))) });
    for (let i = 0; i < 8; i++)
      add({ id: `${p}.hot${i + 1}`, label: `${D} hot cue ${i + 1}`, kind: 'button', run: press(() => d.hotCue(i)) });
    for (const s of LOOP_SIZES) {
      const lid = s >= 1 ? String(s) : s === 0.5 ? 'half' : 'quarter';
      add({ id: `${p}.loop${lid}`, label: `${D} ${s}-beat loop`, kind: 'button', run: press(() => d.beatLoop(s)) });
    }
    add({ id: `${p}.loopIn`, label: `${D} loop in`, kind: 'button', run: press(() => d.loopIn()) });
    add({ id: `${p}.loopOut`, label: `${D} loop out`, kind: 'button', run: press(() => d.loopOut()) });
    add({ id: `${p}.loopExit`, label: `${D} loop exit / reloop`, kind: 'button', run: press(() => (d.loop?.on ? d.exitLoop() : d.reloop())) });
    add({ id: `${p}.nudgeDown`, label: `${D} nudge slower (hold)`, kind: 'button', run: (v) => d.setBend(v > 0 ? -0.04 : 0) });
    add({ id: `${p}.nudgeUp`, label: `${D} nudge faster (hold)`, kind: 'button', run: (v) => d.setBend(v > 0 ? 0.04 : 0) });
    add({
      id: `${p}.pitch`,
      label: `${D} pitch fader`,
      kind: 'value',
      run: (v) => {
        d.setPitch((v * 2 - 1) * d.pitchRange);
        h.ui.setKnob(`${p}.pitch`, v);
      },
    });
    add({
      id: `${p}.jog`,
      label: `${D} jog wheel`,
      kind: 'relative',
      run: (delta) => {
        if (d.playing) {
          d.setBend(delta * 0.01);
          clearTimeout((d as unknown as { _jogT?: number })._jogT);
          (d as unknown as { _jogT?: number })._jogT = window.setTimeout(() => d.setBend(0), 60);
        } else d.seek(d.position() + delta * 0.01);
      },
    });
    const knob = (id: string, label: string, fn: (v: number) => void) =>
      add({
        id: `${p}.${id}`,
        label: `${D} ${label}`,
        kind: 'value',
        run: (v) => {
          fn(v);
          h.ui.setKnob(`${p}.${id}`, v);
        },
      });
    knob('volume', 'channel fader', (v) => d.ch.setFader(v));
    knob('trim', 'gain/trim', (v) => d.ch.setTrim(v));
    knob('eqHigh', 'EQ high', (v) => d.ch.setEq('high', v));
    knob('eqMid', 'EQ mid', (v) => d.ch.setEq('mid', v));
    knob('eqLow', 'EQ low', (v) => d.ch.setEq('low', v));
    knob('filter', 'filter', (v) => d.ch.setFilter(v * 2 - 1));
    knob('fxAmount', 'FX amount', (v) => d.ch.fx.setAmount(v));
    knob('fxParam', 'FX parameter', (v) => d.ch.fx.setParam(v));
    add({ id: `${p}.fxOn`, label: `${D} FX on/off`, kind: 'button', run: press(() => { d.ch.fx.setEnabled(!d.ch.fx.enabled); d.emit(); }) });
  }
  add({
    id: 'xf.value',
    label: 'Crossfader',
    kind: 'value',
    run: (v) => {
      h.engine.setCrossfader(v, h.settings.get('xfadeCurve'));
      h.ui.setKnob('xf', v);
    },
  });
  const xfStep = (dx: number) => (v: number) => {
    if (v <= 0) return;
    const x = dx === 0 ? 0.5 : Math.max(0, Math.min(1, h.engine.xfadePos + dx));
    h.engine.setCrossfader(x, h.settings.get('xfadeCurve'));
    h.ui.setKnob('xf', x);
  };
  add({ id: 'xf.left', label: 'Crossfader step left', kind: 'button', run: xfStep(-0.1) });
  add({ id: 'xf.right', label: 'Crossfader step right', kind: 'button', run: xfStep(0.1) });
  add({ id: 'xf.center', label: 'Crossfader centre', kind: 'button', run: xfStep(0) });
  add({
    id: 'master.volume',
    label: 'Master volume',
    kind: 'value',
    run: (v) => {
      h.engine.setMasterVolume(v);
      h.ui.setKnob('master', v);
    },
  });
  add({ id: 'rec.toggle', label: 'Record start/stop', kind: 'button', run: (v) => v > 0 && h.ui.toggleRecord() });
  add({ id: 'ui.search', label: 'Focus library search', kind: 'button', run: (v) => v > 0 && h.ui.focusSearch() });
  return m;
}

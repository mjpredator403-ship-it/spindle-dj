// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import * as db from './library/db';
import type { LatencyHint } from './audio/engine';
import type { XfadeCurve } from './audio/mixer-math';

export interface MidiBinding {
  /** "cc:<ch>:<num>" or "note:<ch>:<num>" */
  key: string;
  action: string;
  /** cc mode: absolute 0–127 or relative (jog encoders, two's complement around 64) */
  mode: 'abs' | 'rel' | 'button';
}

export interface SettingsData {
  latencyHint: LatencyHint;
  outputDeviceId: string;
  previewDeviceId: string;
  maxTrackMinutes: number;
  quantize: boolean;
  xfadeCurve: XfadeCurve;
  pitchRange: number;
  analyzeWhilePlaying: boolean;
  layout: 'full' | 'decks' | 'library';
  keymap: Record<string, string>; // KeyboardEvent.code → action id
  midi: MidiBinding[];
  waveZoom: number; // seconds visible in the scrolling waveform
}

export const DEFAULT_KEYMAP: Record<string, string> = {
  KeyZ: 'a.play',
  KeyX: 'a.cue',
  KeyC: 'a.sync',
  KeyV: 'a.loop4',
  KeyA: 'a.nudgeDown',
  KeyS: 'a.nudgeUp',
  Digit1: 'a.hot1',
  Digit2: 'a.hot2',
  Digit3: 'a.hot3',
  Digit4: 'a.hot4',
  KeyM: 'b.play',
  KeyN: 'b.cue',
  KeyB: 'b.sync',
  Comma: 'b.loop4',
  KeyK: 'b.nudgeDown',
  KeyL: 'b.nudgeUp',
  Digit7: 'b.hot1',
  Digit8: 'b.hot2',
  Digit9: 'b.hot3',
  Digit0: 'b.hot4',
  ArrowLeft: 'xf.left',
  ArrowRight: 'xf.right',
  ArrowDown: 'xf.center',
  KeyR: 'rec.toggle',
  Slash: 'ui.search',
};

export const DEFAULTS: SettingsData = {
  latencyHint: 'interactive',
  outputDeviceId: '',
  previewDeviceId: '',
  maxTrackMinutes: 30,
  quantize: true,
  xfadeCurve: 'smooth',
  pitchRange: 8,
  analyzeWhilePlaying: true,
  layout: 'full',
  keymap: DEFAULT_KEYMAP,
  midi: [],
  waveZoom: 8,
};

export class Settings {
  private data: SettingsData = structuredClone(DEFAULTS);
  private listeners = new Set<(k: keyof SettingsData) => void>();

  async load() {
    try {
      const saved = await db.get<Partial<SettingsData>>('settings', 'app');
      if (saved) this.data = { ...structuredClone(DEFAULTS), ...saved };
    } catch {
      /* first run or storage unavailable */
    }
  }
  get<K extends keyof SettingsData>(k: K): SettingsData[K] {
    return this.data[k];
  }
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]) {
    this.data[k] = v;
    void db.put('settings', this.data, 'app').catch(() => undefined);
    for (const l of this.listeners) l(k);
  }
  on(fn: (k: keyof SettingsData) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

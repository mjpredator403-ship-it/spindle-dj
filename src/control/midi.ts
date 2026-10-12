// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Web MIDI controller support with "MIDI learn". No SysEx is requested, so the
// browser asks for (at most) a simple permission. Works with class-compliant
// USB DJ controllers in Chrome on ChromeOS, Linux, Windows and macOS.

import type { Action } from './actions';
import type { MidiBinding, Settings } from '../settings';

export type MidiStatus = 'unsupported' | 'denied' | 'ready' | 'idle';

export interface MidiEventInfo {
  key: string;
  value: number; // 0..127
  isNote: boolean;
  noteOn: boolean;
}

export function parseMidi(data: Uint8Array): MidiEventInfo | null {
  if (data.length < 2) return null;
  const st = data[0] & 0xf0;
  const ch = (data[0] & 0x0f) + 1;
  const d1 = data[1];
  const d2 = data.length > 2 ? data[2] : 0;
  if (st === 0xb0) return { key: `cc:${ch}:${d1}`, value: d2, isNote: false, noteOn: false };
  if (st === 0x90) return { key: `note:${ch}:${d1}`, value: d2, isNote: true, noteOn: d2 > 0 };
  if (st === 0x80) return { key: `note:${ch}:${d1}`, value: 0, isNote: true, noteOn: false };
  return null;
}

/** Relative encoder value → signed delta (two's-complement around 0/128, also handles 64-centred). */
export function relDelta(v: number): number {
  if (v === 64) return 0;
  if (v > 64) return v - 128; // 127 → −1
  return v; // 1 → +1
}

export class MidiController {
  status: MidiStatus = 'idle';
  inputs: string[] = [];
  private access: MIDIAccess | null = null;
  private learnCb: ((key: string, isNote: boolean) => void) | null = null;
  onChange: (() => void) | null = null;
  onActivity: ((key: string) => void) | null = null;

  constructor(private actions: Map<string, Action>, private settings: Settings) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async enable(): Promise<void> {
    if (!MidiController.supported()) {
      this.status = 'unsupported';
      this.onChange?.();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.status = 'denied';
      this.onChange?.();
      return;
    }
    this.status = 'ready';
    this.access.onstatechange = () => this.bind();
    this.bind();
  }

  private bind() {
    if (!this.access) return;
    this.inputs = [];
    this.access.inputs.forEach((inp) => {
      this.inputs.push(inp.name ?? 'MIDI input');
      inp.onmidimessage = (e) => this.handle(e.data as Uint8Array);
    });
    this.onChange?.();
  }

  learn(cb: (key: string, isNote: boolean) => void) {
    this.learnCb = cb;
  }
  cancelLearn() {
    this.learnCb = null;
  }

  private handle(data: Uint8Array) {
    const ev = parseMidi(data);
    if (!ev) return;
    this.onActivity?.(ev.key);
    if (this.learnCb) {
      if (ev.isNote && !ev.noteOn) return; // learn on press
      const cb = this.learnCb;
      this.learnCb = null;
      cb(ev.key, ev.isNote);
      return;
    }
    for (const b of this.settings.get('midi')) {
      if (b.key !== ev.key) continue;
      const a = this.actions.get(b.action);
      if (!a) continue;
      dispatch(a, b, ev);
    }
  }
}

export function dispatch(a: Action, b: MidiBinding, ev: MidiEventInfo) {
  if (a.kind === 'button') {
    if (ev.isNote) a.run(ev.noteOn ? 1 : 0);
    else a.run(ev.value >= 64 ? 1 : 0);
  } else if (a.kind === 'value') {
    a.run(ev.value / 127);
  } else {
    a.run(b.mode === 'rel' || !ev.isNote ? relDelta(ev.value) : 0);
  }
}

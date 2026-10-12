import { describe, expect, it } from 'vitest';
import { dispatch, parseMidi, relDelta } from '../../src/control/midi';
import type { Action } from '../../src/control/actions';

describe('MIDI parsing', () => {
  it('parses CC, note on, note off and note-on-velocity-0 as off', () => {
    expect(parseMidi(new Uint8Array([0xb0, 7, 100]))).toEqual({ key: 'cc:1:7', value: 100, isNote: false, noteOn: false });
    expect(parseMidi(new Uint8Array([0x91, 60, 127]))).toEqual({ key: 'note:2:60', value: 127, isNote: true, noteOn: true });
    expect(parseMidi(new Uint8Array([0x81, 60, 0]))?.noteOn).toBe(false);
    expect(parseMidi(new Uint8Array([0x90, 60, 0]))?.noteOn).toBe(false);
    expect(parseMidi(new Uint8Array([0xf8]))).toBeNull(); // clock
  });
  it('decodes relative encoders (two’s complement)', () => {
    expect(relDelta(1)).toBe(1);
    expect(relDelta(5)).toBe(5);
    expect(relDelta(127)).toBe(-1);
    expect(relDelta(120)).toBe(-8);
    expect(relDelta(64)).toBe(0);
  });
});

describe('MIDI dispatch', () => {
  const rec = (kind: Action['kind']) => {
    const calls: number[] = [];
    const a: Action = { id: 'x', label: 'x', kind, run: (v) => calls.push(v) };
    return { a, calls };
  };
  it('buttons: note on/off → 1/0, CC ≥64 → pressed', () => {
    const { a, calls } = rec('button');
    dispatch(a, { key: 'note:1:1', action: 'x', mode: 'button' }, parseMidi(new Uint8Array([0x90, 1, 127]))!);
    dispatch(a, { key: 'note:1:1', action: 'x', mode: 'button' }, parseMidi(new Uint8Array([0x80, 1, 0]))!);
    dispatch(a, { key: 'cc:1:1', action: 'x', mode: 'button' }, parseMidi(new Uint8Array([0xb0, 1, 127]))!);
    expect(calls).toEqual([1, 0, 1]);
  });
  it('absolute CC → 0..1, relative CC → signed delta', () => {
    const v = rec('value');
    dispatch(v.a, { key: 'cc:1:1', action: 'x', mode: 'abs' }, parseMidi(new Uint8Array([0xb0, 1, 127]))!);
    dispatch(v.a, { key: 'cc:1:1', action: 'x', mode: 'abs' }, parseMidi(new Uint8Array([0xb0, 1, 0]))!);
    expect(v.calls).toEqual([1, 0]);
    const r = rec('relative');
    dispatch(r.a, { key: 'cc:1:2', action: 'x', mode: 'rel' }, parseMidi(new Uint8Array([0xb0, 2, 126]))!);
    expect(r.calls).toEqual([-2]);
  });
});

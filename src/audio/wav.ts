// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// RIFF/WAVE helpers for recording. 16-bit PCM, interleaved.

export function wavHeader(sampleRate: number, channels: number, dataBytes: number): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  // RIFF size field is 32-bit: clamp for >4 GiB (WAV format limit, ~6.7 h @48k stereo 16-bit)
  const riff = Math.min(0xffffffff, 36 + dataBytes);
  w(0, 'RIFF');
  v.setUint32(4, riff, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, Math.min(0xffffffff, dataBytes), true);
  return buf;
}

/** Interleave float channels into 16-bit PCM with clipping protection. */
export function floatToPcm16(left: Float32Array, right: Float32Array): Int16Array {
  const n = left.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[2 * i] = toI16(left[i]);
    out[2 * i + 1] = toI16(right[i]);
  }
  return out;
}

function toI16(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff);
}

/** Parse a 16-bit PCM WAV (used by tests to verify recordings). */
export function parseWav16(buf: ArrayBuffer): { sampleRate: number; channels: number; data: Float32Array[] } {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let sampleRate = 0,
    channels = 0,
    bits = 0;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error('only 16-bit supported');
      const frames = Math.floor(Math.min(size, buf.byteLength - o - 8) / (2 * channels));
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < channels; c++) data[c][i] = v.getInt16(o + 8 + (i * channels + c) * 2, true) / 0x8000;
      return { sampleRate, channels, data };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

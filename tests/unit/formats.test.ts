import { describe, expect, it } from 'vitest';
import { floatToPcm16, parseWav16, wavHeader } from '../../src/audio/wav';
import { isSupportedName, metaFromFilename, parseMetadata } from '../../src/library/metadata';

function concat(...parts: (Uint8Array | number[])[]) {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
const ascii = (s: string) => new TextEncoder().encode(s);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ss = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

function id3v23(frames: [string, string][]) {
  const body = concat(...frames.map(([id, text]) => {
    const data = concat([0], ascii(text)); // latin1
    return concat(ascii(id), be32(data.length), [0, 0], data);
  }));
  return concat(ascii('ID3'), [3, 0, 0], ss(body.length), body);
}

describe('WAV writer/reader', () => {
  it('round-trips 16-bit PCM with clipping protection', () => {
    const L = new Float32Array([0, 0.5, -0.5, 1.5, -2]);
    const R = new Float32Array([0.25, -0.25, 1, -1, 0]);
    const pcm = floatToPcm16(L, R);
    const hdr = new Uint8Array(wavHeader(48000, 2, pcm.byteLength));
    const file = concat(hdr, new Uint8Array(pcm.buffer));
    const w = parseWav16(file.buffer);
    expect(w.sampleRate).toBe(48000);
    expect(w.channels).toBe(2);
    expect(w.data[0][1]).toBeCloseTo(0.5, 3);
    expect(w.data[0][3]).toBeCloseTo(1, 3); // clipped, not wrapped
    expect(w.data[0][4]).toBe(-1);
    expect(w.data[1][0]).toBeCloseTo(0.25, 3);
  });
});

describe('metadata', () => {
  it('reads ID3v2.3 title/artist/album/BPM and the MP3 frame header', () => {
    const tag = id3v23([
      ['TIT2', 'Night Drive'],
      ['TPE1', 'Test Artist'],
      ['TALB', 'Album X'],
      ['TBPM', '124'],
    ]);
    // MPEG-1 Layer III, 192 kbps, 44.1 kHz, stereo
    const frame = [0xff, 0xfb, 0xb0, 0x00];
    const m = parseMetadata(concat(tag, frame, new Array(100).fill(0)), 'x.mp3');
    expect(m).toMatchObject({ title: 'Night Drive', artist: 'Test Artist', album: 'Album X', tagBpm: 124, sampleRate: 44100, bitrateKbps: 192, channels: 2, format: 'mp3' });
  });

  it('reads FLAC STREAMINFO and Vorbis comments', () => {
    const si = new Array(34).fill(0);
    // sample rate 96000 (20 bits) | channels-1 (3 bits)=1 | ...
    const sr = 96000;
    si[10] = (sr >> 12) & 255;
    si[11] = (sr >> 4) & 255;
    si[12] = ((sr & 15) << 4) | (1 << 1);
    const vendor = ascii('test');
    const c1 = ascii('TITLE=Flac Song');
    const c2 = ascii('ARTIST=Flac Artist');
    const vc = concat(le32(vendor.length), vendor, le32(2), le32(c1.length), c1, le32(c2.length), c2);
    const file = concat(ascii('fLaC'), [0, 0, 0, 34], si, [0x84, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255], vc);
    const m = parseMetadata(file, 'song.flac');
    expect(m).toMatchObject({ sampleRate: 96000, channels: 2, title: 'Flac Song', artist: 'Flac Artist' });
  });

  it('reads WAV fmt + LIST/INFO', () => {
    const fmt = concat(ascii('fmt '), le32(16), [1, 0, 2, 0], le32(44100), le32(44100 * 4), [4, 0, 16, 0]);
    const inam = ascii('Wav Title\0');
    const info = concat(ascii('INFO'), ascii('INAM'), le32(inam.length), inam);
    const list = concat(ascii('LIST'), le32(info.length), info);
    const data = concat(ascii('data'), le32(4), [0, 0, 0, 0]);
    const body = concat(ascii('WAVE'), fmt, list, data);
    const file = concat(ascii('RIFF'), le32(body.length), body);
    const m = parseMetadata(file, 'a.wav');
    expect(m).toMatchObject({ sampleRate: 44100, channels: 2, title: 'Wav Title' });
  });

  it('survives garbage input', () => {
    const m = parseMetadata(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0xff, 0x7f, 0x7f, 0x7f, 0x7f, 1, 2]), 'broken.mp3');
    expect(m.format).toBe('mp3');
  });

  it('filename fallback and supported formats', () => {
    expect(metaFromFilename('DJ Someone - Big Tune.mp3')).toEqual({ artist: 'DJ Someone', title: 'Big Tune' });
    expect(metaFromFilename('just_a_name.flac')).toEqual({ title: 'just a name' });
    expect(isSupportedName('a.FLAC')).toBe(true);
    expect(isSupportedName('a.txt')).toBe(false);
  });
});

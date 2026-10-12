// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Lightweight, dependency-free tag + stream-info reader. Reads only the first
// part of a file (the caller passes ≤ 512 KiB). Supports:
//   ID3v2.2/2.3/2.4 text frames (MP3, also WAV 'id3 ' chunk), ID3v1 not needed
//   FLAC STREAMINFO + VORBIS_COMMENT
//   Ogg Vorbis/Opus identification + comment headers (first pages only)
//   WAV fmt chunk + LIST/INFO
//   MP3 first frame header (sample rate, bitrate, channels)
// Anything not found stays undefined — callers fall back to the filename.

export interface TrackMeta {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  tagBpm?: number;
  sampleRate?: number;
  channels?: number;
  bitrateKbps?: number;
  format: string;
}

const td = (label: string) => new TextDecoder(label);

function str4(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

export function formatFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export const SUPPORTED_EXTENSIONS = ['mp3', 'wav', 'wave', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'webm', 'aif', 'aiff'];

export function isSupportedName(name: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(formatFromName(name));
}

/** "Artist - Title.mp3" → {artist, title}; otherwise title = basename. */
export function metaFromFilename(name: string): { title: string; artist?: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base };
}

export function parseMetadata(bytes: Uint8Array, fileName: string): TrackMeta {
  const meta: TrackMeta = { format: formatFromName(fileName) };
  try {
    if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const end = parseId3(bytes, 0, meta);
      parseMp3Frame(bytes, end, meta);
    } else if (str4(bytes, 0) === 'fLaC') {
      parseFlac(bytes, meta);
    } else if (str4(bytes, 0) === 'OggS') {
      parseOgg(bytes, meta);
    } else if (str4(bytes, 0) === 'RIFF' && str4(bytes, 8) === 'WAVE') {
      parseWav(bytes, meta);
    } else if (meta.format === 'mp3') {
      parseMp3Frame(bytes, 0, meta);
    }
  } catch {
    // malformed tags: ignore, keep what we have
  }
  for (const k of ['title', 'artist', 'album', 'genre'] as const) {
    const v = meta[k];
    if (v !== undefined) {
      const t = v.replace(/\u0000/g, '').trim();
      if (t) meta[k] = t;
      else delete meta[k];
    }
  }
  return meta;
}

// ---------------- ID3v2 ----------------
function synchsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function decodeId3Text(data: Uint8Array): string {
  if (!data.length) return '';
  const enc = data[0];
  const body = data.subarray(1);
  let s: string;
  if (enc === 0) s = td('latin1').decode(body);
  else if (enc === 1) s = td('utf-16').decode(body); // with BOM
  else if (enc === 2) s = td('utf-16be').decode(body);
  else s = td('utf-8').decode(body);
  // multiple values are NUL-separated in v2.4; keep the first
  return s.split('\u0000').filter(Boolean)[0] ?? '';
}

export function parseId3(b: Uint8Array, start: number, meta: TrackMeta): number {
  const major = b[start + 3];
  const flags = b[start + 5];
  const size = synchsafe(b, start + 6);
  const end = start + 10 + size + (flags & 0x10 ? 10 : 0);
  let o = start + 10;
  if (flags & 0x40) {
    // extended header
    const ext = major === 4 ? synchsafe(b, o) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) + 4;
    o += ext;
  }
  const limit = Math.min(end, b.length);
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const hdrLen = v22 ? 6 : 10;
  const map: Record<string, keyof TrackMeta> = v22
    ? { TT2: 'title', TP1: 'artist', TAL: 'album', TCO: 'genre', TBP: 'tagBpm' }
    : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TBPM: 'tagBpm' };
  while (o + hdrLen <= limit) {
    const id = String.fromCharCode(...b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    let fsize: number;
    if (v22) fsize = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    else if (major === 4) fsize = synchsafe(b, o + 4);
    else fsize = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    const dataStart = o + hdrLen;
    if (fsize <= 0 || dataStart + fsize > b.length) break;
    const key = map[id];
    if (key) {
      const text = decodeId3Text(b.subarray(dataStart, dataStart + fsize));
      if (key === 'tagBpm') {
        const n = parseFloat(text);
        if (n > 20 && n < 300) meta.tagBpm = n;
      } else if (key === 'genre') {
        meta.genre = text.replace(/^\((\d+)\)$/, '$1');
      } else {
        (meta as unknown as Record<string, string>)[key] = text;
      }
    }
    o = dataStart + fsize;
  }
  return end;
}

// ---------------- MP3 frame header ----------------
const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function parseMp3Frame(b: Uint8Array, from: number, meta: TrackMeta): void {
  const lim = Math.min(b.length - 4, from + 65536);
  for (let o = from; o < lim; o++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[o + 1] >> 3) & 3; // 3=v1, 2=v2, 0=v2.5
    const layer = (b[o + 1] >> 1) & 3; // 1 = layer III
    const brIdx = (b[o + 2] >> 4) & 15;
    const srIdx = (b[o + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || srIdx === 3 || brIdx === 15) continue;
    const rates = MP3_RATES[ver];
    if (!rates) continue;
    meta.sampleRate = rates[srIdx];
    const br = layer === 1 ? (ver === 3 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[brIdx] : 0;
    if (br) meta.bitrateKbps = br;
    meta.channels = ((b[o + 3] >> 6) & 3) === 3 ? 1 : 2;
    return;
  }
}

// ---------------- Vorbis comments (FLAC/Ogg) ----------------
function parseVorbisComments(b: Uint8Array, o: number, end: number, meta: TrackMeta): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u8 = td('utf-8');
  const vendorLen = v.getUint32(o, true);
  o += 4 + vendorLen;
  if (o + 4 > end) return;
  const count = v.getUint32(o, true);
  o += 4;
  for (let i = 0; i < count && o + 4 <= end; i++) {
    const len = v.getUint32(o, true);
    o += 4;
    if (o + len > end) break;
    const s = u8.decode(b.subarray(o, o + len));
    o += len;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase();
    const val = s.slice(eq + 1);
    if (k === 'TITLE' && !meta.title) meta.title = val;
    else if (k === 'ARTIST' && !meta.artist) meta.artist = val;
    else if (k === 'ALBUM' && !meta.album) meta.album = val;
    else if (k === 'GENRE' && !meta.genre) meta.genre = val;
    else if ((k === 'BPM' || k === 'TEMPO') && !meta.tagBpm) {
      const n = parseFloat(val);
      if (n > 20 && n < 300) meta.tagBpm = n;
    }
  }
}

function parseFlac(b: Uint8Array, meta: TrackMeta): void {
  let o = 4;
  while (o + 4 <= b.length) {
    const hdr = b[o];
    const last = (hdr & 0x80) !== 0;
    const type = hdr & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const d = o + 4;
    if (d + len > b.length) break;
    if (type === 0 && len >= 18) {
      meta.sampleRate = (b[d + 10] << 12) | (b[d + 11] << 4) | (b[d + 12] >> 4);
      meta.channels = ((b[d + 12] >> 1) & 7) + 1;
    } else if (type === 4) {
      parseVorbisComments(b, d, d + len, meta);
    }
    if (last) break;
    o = d + len;
  }
}

function parseOgg(b: Uint8Array, meta: TrackMeta): void {
  // Concatenate the first few page payloads (headers are small) and look for packets.
  const chunks: Uint8Array[] = [];
  let o = 0;
  for (let page = 0; page < 6 && o + 27 <= b.length && str4(b, o) === 'OggS'; page++) {
    const segs = b[o + 26];
    let size = 0;
    for (let i = 0; i < segs; i++) size += b[o + 27 + i];
    const start = o + 27 + segs;
    chunks.push(b.subarray(start, Math.min(b.length, start + size)));
    o = start + size;
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    all.set(c, p);
    p += c.length;
  }
  const v = new DataView(all.buffer);
  const find = (sig: number[]) => {
    outer: for (let i = 0; i + sig.length <= all.length; i++) {
      for (let j = 0; j < sig.length; j++) if (all[i + j] !== sig[j]) continue outer;
      return i;
    }
    return -1;
  };
  const vorbisId = find([1, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (vorbisId >= 0) {
    meta.channels = all[vorbisId + 11];
    meta.sampleRate = v.getUint32(vorbisId + 12, true);
    const br = v.getInt32(vorbisId + 20, true);
    if (br > 0) meta.bitrateKbps = Math.round(br / 1000);
    const vc = find([3, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
    if (vc >= 0) parseVorbisComments(all, vc + 7, all.length, meta);
    return;
  }
  const opus = find([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // OpusHead
  if (opus >= 0) {
    meta.channels = all[opus + 9];
    meta.sampleRate = 48000; // Opus always decodes at 48 kHz
    const tags = find([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // OpusTags
    if (tags >= 0) parseVorbisComments(all, tags + 8, all.length, meta);
  }
}

function parseWav(b: Uint8Array, meta: TrackMeta): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  while (o + 8 <= b.length) {
    const id = str4(b, o);
    const size = v.getUint32(o + 4, true);
    const d = o + 8;
    if (id === 'fmt ' && d + 16 <= b.length) {
      meta.channels = v.getUint16(d + 2, true);
      meta.sampleRate = v.getUint32(d + 4, true);
      meta.bitrateKbps = Math.round((v.getUint32(d + 8, true) * 8) / 1000);
    } else if (id === 'LIST' && d + 4 <= b.length && str4(b, d) === 'INFO') {
      let q = d + 4;
      const end = Math.min(b.length, d + size);
      while (q + 8 <= end) {
        const sid = str4(b, q);
        const ssz = v.getUint32(q + 4, true);
        const txt = td('utf-8').decode(b.subarray(q + 8, Math.min(end, q + 8 + ssz)));
        if (sid === 'INAM') meta.title = txt;
        else if (sid === 'IART') meta.artist = txt;
        else if (sid === 'IPRD') meta.album = txt;
        else if (sid === 'IGNR') meta.genre = txt;
        q += 8 + ssz + (ssz & 1);
      }
    } else if ((id === 'id3 ' || id === 'ID3 ') && d + 10 <= b.length) {
      parseId3(b, d, meta);
    } else if (id === 'data') {
      // data usually comes after metadata; skip it (may exceed what we read)
    }
    o = d + size + (size & 1);
  }
}

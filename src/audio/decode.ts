// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Decoding uses the browser's built-in codecs (decodeAudioData). In Chrome on
// ChromeOS/Linux this covers MP3, WAV, FLAC, Ogg Vorbis, Opus, AAC/M4A.
// No codec is bundled with Spindle, so there are no codec licensing concerns.

import AnalysisWorker from '../analysis/analysis-worker.ts?worker';
import type { AnalysisResult } from '../analysis/analysis-worker';
import { ANALYSIS_RATE } from '../analysis/bpm';

export class DecodeError extends Error {}

export async function decodeFile(ctx: BaseAudioContext, file: File, maxMinutes: number): Promise<AudioBuffer> {
  // Rough pre-check from file size (compressed audio ≈ 1 MB/min @128 kbps, WAV ≈ 10 MB/min).
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (e) {
    throw new DecodeError(`Cannot read "${file.name}" — the file may have been moved, deleted, or access was revoked. (${(e as Error).message})`);
  }
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(bytes);
  } catch {
    throw new DecodeError(`"${file.name}" could not be decoded. The format or codec is not supported by this browser, or the file is damaged.`);
  }
  if (buf.duration > maxMinutes * 60) {
    throw new DecodeError(
      `"${file.name}" is ${Math.round(buf.duration / 60)} min long; the limit is ${maxMinutes} min (Settings → Audio) to protect memory. ` +
        `A ${Math.round(buf.duration / 60)} min stereo track needs ≈${Math.round((buf.duration * buf.sampleRate * 2 * 4) / 1e6)} MB of RAM once decoded.`,
    );
  }
  return buf;
}

/** Copy channels into fresh arrays that can be transferred to the worklet. */
export function extractChannels(buf: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
    const a = new Float32Array(buf.length);
    buf.copyFromChannel(a, c);
    out.push(a);
  }
  return out;
}

/** High-quality mono downsample to the analysis rate (browser resampler, off main thread). */
export async function toAnalysisMono(buf: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(buf.duration * ANALYSIS_RATE));
  const off = new OfflineAudioContext(1, frames, ANALYSIS_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination); // stereo → mono "speakers" downmix
  src.start();
  const rendered = await off.startRendering();
  return new Float32Array(rendered.getChannelData(0)); // own copy (transferable)
}

// ---- worker pool (single worker, serial queue — bounded memory)
let worker: Worker | null = null;
const pending = new Map<string, (r: AnalysisResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new AnalysisWorker();
    worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
    worker.onerror = (e) => {
      for (const [id, cb] of pending) cb({ id, ok: false, error: e.message || 'analysis worker crashed' });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export function analyzeMono(id: string, samples: Float32Array): Promise<AnalysisResult> {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ id, samples, sampleRate: ANALYSIS_RATE }, [samples.buffer]);
  });
}

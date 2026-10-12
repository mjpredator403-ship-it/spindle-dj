// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Web Worker: heavy analysis off the UI thread (never on the audio thread).
import { estimateTempo } from './bpm';
import { estimateKey } from './key';
import { computeWaveform } from './waveform';

export interface AnalysisRequest {
  id: string;
  samples: Float32Array; // mono
  sampleRate: number;
}

export interface AnalysisResult {
  id: string;
  ok: boolean;
  error?: string;
  bpm?: number;
  firstBeat?: number;
  bpmConfidence?: number;
  key?: { name: string; short: string; camelot: string; confidence: number };
  peaks?: Uint8Array;
  lowRatio?: Uint8Array;
  peaksPerSec?: number;
  durationSec?: number;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { id, samples, sampleRate } = e.data;
  try {
    const wf = computeWaveform(samples, sampleRate);
    const tempo = estimateTempo(samples, sampleRate);
    const key = estimateKey(samples, sampleRate);
    const res: AnalysisResult = {
      id,
      ok: true,
      peaks: wf.peaks,
      lowRatio: wf.lowRatio,
      peaksPerSec: wf.peaksPerSec,
      durationSec: samples.length / sampleRate,
      bpm: tempo?.bpm,
      firstBeat: tempo?.firstBeat,
      bpmConfidence: tempo?.confidence,
      key: key ? { name: key.name, short: key.short, camelot: key.camelot, confidence: key.confidence } : undefined,
    };
    (self as unknown as Worker).postMessage(res, [wf.peaks.buffer, wf.lowRatio.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) } satisfies AnalysisResult);
  }
};

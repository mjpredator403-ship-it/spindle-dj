// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Master-output recorder → 16-bit WAV.
// Preferred path: stream straight to a user-chosen file via the File System
// Access API (bounded memory, any length up to the 4 GiB WAV limit).
// Fallback: keep chunks in memory and offer a download (capped by maxMinutes).

import type { Engine } from './engine';
import { wavHeader } from './wav';

export type RecState = 'idle' | 'recording' | 'paused' | 'finalizing';

interface Sink {
  write(chunk: Int16Array): Promise<void>;
  finish(totalBytes: number): Promise<{ name: string; blob?: Blob }>;
  abort(): Promise<void>;
}

class FileSink implements Sink {
  private q: Promise<void> = Promise.resolve();
  private failed: unknown = null;
  constructor(private w: FileSystemWritableFileStream, private name: string, private sr: number) {}
  static async open(sr: number, suggested: string): Promise<FileSink> {
    const picker = (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    const h = await picker({ suggestedName: suggested, types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }] });
    const w = await h.createWritable();
    await w.write(wavHeader(sr, 2, 0)); // placeholder, patched at the end
    return new FileSink(w, h.name, sr);
  }
  write(chunk: Int16Array) {
    this.q = this.q.then(() => this.w.write(chunk as unknown as ArrayBuffer)).catch((e) => {
      this.failed = e;
    });
    return this.q;
  }
  async finish(totalBytes: number) {
    await this.q;
    if (this.failed) throw this.failed;
    await this.w.write({ type: 'write', position: 0, data: wavHeader(this.sr, 2, totalBytes) });
    await this.w.close();
    return { name: this.name };
  }
  async abort() {
    try {
      await this.w.abort();
    } catch {
      /* ignore */
    }
  }
}

class MemorySink implements Sink {
  private chunks: BlobPart[] = [];
  constructor(private sr: number, private name: string) {}
  async write(chunk: Int16Array) {
    this.chunks.push(chunk as unknown as BlobPart);
  }
  async finish(totalBytes: number) {
    const blob = new Blob([wavHeader(this.sr, 2, totalBytes), ...this.chunks], { type: 'audio/wav' });
    this.chunks = [];
    return { name: this.name, blob };
  }
  async abort() {
    this.chunks = [];
  }
}

export interface RecorderEvents {
  onState?: (s: RecState) => void;
  onError?: (msg: string) => void;
  onDone?: (r: { name: string; blob?: Blob; seconds: number; bytes: number; peak: number }) => void;
}

export class MixRecorder {
  state: RecState = 'idle';
  bytes = 0;
  peak = 0;
  private node: AudioWorkletNode | null = null;
  private sink: Sink | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(private engine: Engine, private ev: RecorderEvents = {}, public maxMemoryMinutes = 60) {}

  static streamingSupported(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  }

  get seconds(): number {
    return this.bytes / (4 * this.engine.ctx.sampleRate);
  }

  private set(s: RecState) {
    this.state = s;
    this.ev.onState?.(s);
  }

  /** mode 'file' asks for a destination (streaming); 'memory' downloads at the end. */
  async start(mode: 'file' | 'memory' = MixRecorder.streamingSupported() ? 'file' : 'memory'): Promise<void> {
    if (this.state !== 'idle') return;
    const sr = this.engine.ctx.sampleRate;
    const name = `spindle-mix-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.wav`;
    try {
      this.sink = mode === 'file' ? await FileSink.open(sr, name) : new MemorySink(sr, name);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return; // user cancelled the picker
      this.ev.onError?.(`Could not open the recording file: ${(e as Error).message}`);
      return;
    }
    this.bytes = 0;
    this.peak = 0;
    if (!this.node) this.node = this.engine.createRecorderNode();
    this.node.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'chunk') {
        const pcm = m.pcm as Int16Array;
        this.bytes += pcm.byteLength;
        this.peak = Math.max(this.peak, m.peak);
        this.sink?.write(pcm);
        if (mode === 'memory' && this.seconds > this.maxMemoryMinutes * 60) {
          this.ev.onError?.(`In-memory recording limit (${this.maxMemoryMinutes} min) reached — stopping and saving.`);
          void this.stop();
        }
      } else if (m.type === 'stopped') {
        this.stopResolve?.();
      }
    };
    this.node.port.postMessage({ type: 'start' });
    this.set('recording');
  }

  pause() {
    if (this.state !== 'recording') return;
    this.node?.port.postMessage({ type: 'pause' });
    this.set('paused');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.node?.port.postMessage({ type: 'resume' });
    this.set('recording');
  }

  async stop(): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'paused') return;
    this.set('finalizing');
    const stopped = new Promise<void>((r) => (this.stopResolve = r));
    this.node?.port.postMessage({ type: 'stop' });
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 1500))]);
    const sink = this.sink!;
    this.sink = null;
    try {
      const res = await sink.finish(this.bytes);
      this.ev.onDone?.({ ...res, seconds: this.seconds, bytes: this.bytes, peak: this.peak });
    } catch (e) {
      await sink.abort();
      this.ev.onError?.(`Recording could not be saved: ${(e as Error).message}`);
    }
    this.set('idle');
  }
}

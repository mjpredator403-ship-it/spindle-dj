// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Music library: tracks, playlists, queue, user-authorised folders.
//
// File access model (privacy by design):
//  * Spindle only sees files/folders the user explicitly picks.
//  * In Chrome/ChromeOS, picked items are kept as File System Access handles in
//    IndexedDB so they can be re-opened after a restart (the browser may ask the
//    user to re-confirm access once per session).
//  * Browsers without that API fall back to <input type=file>; such tracks are
//    "session only" and must be re-linked after a reload.

import * as db from './db';
import { isSupportedName, metaFromFilename, parseMetadata, SUPPORTED_EXTENSIONS } from './metadata';

export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'failed';
export type FileStatus = 'ok' | 'missing' | 'needs-permission' | 'session' | 'unknown';

export interface Track {
  id: string;
  fileName: string;
  relPath?: string;
  folderId?: string;
  handle?: FileSystemFileHandle;
  size: number;
  lastModified: number;
  format: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  tagBpm?: number;
  sampleRate?: number;
  channels?: number;
  bitrateKbps?: number;
  durationSec?: number;
  bpm?: number;
  firstBeat?: number;
  bpmConfidence?: number;
  gridEdited?: boolean;
  keyName?: string;
  keyShort?: string;
  keyCamelot?: string;
  keyConfidence?: number;
  analysisStatus: AnalysisStatus;
  analysisError?: string;
  cue?: number;
  hotCues: (number | null)[];
  addedAt: number;
  playCount: number;
  lastPlayed?: number;
}

export interface WaveCache {
  id: string;
  peaks: Uint8Array;
  lowRatio: Uint8Array;
  peaksPerSec: number;
  durationSec: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: number;
}

export const QUEUE_ID = 'queue';
const HOT_CUES = 8;
const MAX_SCAN_FILES = 20000;

type PermHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showDirectoryPicker' in window;
}

function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class Library {
  tracks = new Map<string, Track>();
  status = new Map<string, FileStatus>();
  playlists: Playlist[] = [];
  folders: Folder[] = [];
  private sessionFiles = new Map<string, File>();
  private listeners = new Set<() => void>();
  private notifyQueued = false;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const l of this.listeners) l();
    });
  }

  async load(): Promise<void> {
    const [tracks, playlists, folders] = await Promise.all([
      db.getAll<Track>('tracks'),
      db.getAll<Playlist>('playlists'),
      db.getAll<Folder>('folders'),
    ]);
    for (const t of tracks) {
      t.hotCues = t.hotCues ?? [];
      while (t.hotCues.length < HOT_CUES) t.hotCues.push(null);
      if (t.analysisStatus === 'analyzing') t.analysisStatus = 'pending'; // interrupted last session
      this.tracks.set(t.id, t);
      this.status.set(t.id, t.handle ? 'unknown' : 'missing');
    }
    this.playlists = playlists.sort((a, b) => a.createdAt - b.createdAt);
    if (!this.playlists.find((p) => p.id === QUEUE_ID)) {
      const q: Playlist = { id: QUEUE_ID, name: 'Queue', trackIds: [], createdAt: 0 };
      this.playlists.unshift(q);
      await db.put('playlists', q);
    }
    this.folders = folders;
    this.notify();
    void this.checkAll();
  }

  /** Verify every stored handle without prompting. */
  async checkAll(): Promise<void> {
    const list = [...this.tracks.values()];
    for (let i = 0; i < list.length; i++) {
      await this.checkTrack(list[i]);
      if (i % 50 === 49) this.notify();
    }
    this.notify();
  }

  async checkTrack(t: Track): Promise<FileStatus> {
    let s: FileStatus;
    if (this.sessionFiles.has(t.id)) s = 'session';
    else if (!t.handle) s = 'missing';
    else {
      const h = t.handle as PermHandle;
      const perm = h.queryPermission ? await h.queryPermission({ mode: 'read' }).catch(() => 'prompt' as PermissionState) : 'granted';
      if (perm !== 'granted') s = 'needs-permission';
      else {
        try {
          const f = await t.handle.getFile();
          s = 'ok';
          if (f.size !== t.size || f.lastModified !== t.lastModified) {
            // file changed on disk → re-analyse
            t.size = f.size;
            t.lastModified = f.lastModified;
            t.analysisStatus = 'pending';
            await this.save(t);
          }
        } catch {
          s = 'missing';
        }
      }
    }
    this.status.set(t.id, s);
    return s;
  }

  counts() {
    let missing = 0,
      perm = 0;
    for (const s of this.status.values()) {
      if (s === 'missing') missing++;
      else if (s === 'needs-permission') perm++;
    }
    return { total: this.tracks.size, missing, needsPermission: perm };
  }

  /** Must be called from a user gesture (click). */
  async grantAccess(): Promise<void> {
    for (const f of this.folders) {
      const h = f.handle as unknown as PermHandle;
      if (h.requestPermission) await h.requestPermission({ mode: 'read' }).catch(() => undefined);
    }
    for (const t of this.tracks.values()) {
      if (this.status.get(t.id) !== 'needs-permission' || !t.handle) continue;
      const h = t.handle as PermHandle;
      const q = await h.queryPermission?.({ mode: 'read' });
      if (q === 'granted') continue;
      if (h.requestPermission) {
        const r = await h.requestPermission({ mode: 'read' }).catch(() => 'denied' as PermissionState);
        if (r !== 'granted') break; // user said no — stop nagging
      }
    }
    await this.checkAll();
  }

  /** Returns a readable File or throws a user-friendly error. Call from a gesture when possible. */
  async getFile(t: Track): Promise<File> {
    const sf = this.sessionFiles.get(t.id);
    if (sf) return sf;
    if (!t.handle) {
      this.status.set(t.id, 'missing');
      this.notify();
      throw new Error(`"${t.title}" was added for this session only (this browser can't remember file locations). Re-link it or re-import it.`);
    }
    const h = t.handle as PermHandle;
    let perm = (await h.queryPermission?.({ mode: 'read' }).catch(() => 'prompt' as PermissionState)) ?? 'granted';
    if (perm === 'prompt' && h.requestPermission) perm = await h.requestPermission({ mode: 'read' }).catch(() => 'denied' as PermissionState);
    if (perm !== 'granted') {
      this.status.set(t.id, 'needs-permission');
      this.notify();
      throw new Error(`Access to "${t.fileName}" was not granted. Use "Grant access" in the library to allow Spindle to read your music again.`);
    }
    try {
      const f = await t.handle.getFile();
      this.status.set(t.id, 'ok');
      return f;
    } catch {
      this.status.set(t.id, 'missing');
      this.notify();
      throw new Error(`"${t.fileName}" can't be found — it may have been moved, renamed, or deleted. Use "Relink" to locate it.`);
    }
  }

  private dupKey(name: string, size: number, lm: number) {
    return `${name}|${size}|${lm}`;
  }

  private findDuplicate(name: string, size: number, lm: number): Track | undefined {
    const k = this.dupKey(name, size, lm);
    for (const t of this.tracks.values()) if (this.dupKey(t.fileName, t.size, t.lastModified) === k) return t;
    return undefined;
  }

  async addFile(file: File, handle?: FileSystemFileHandle, folderId?: string, relPath?: string): Promise<Track | null> {
    if (!isSupportedName(file.name)) return null;
    const dup = this.findDuplicate(file.name, file.size, file.lastModified);
    if (dup) {
      // re-import of a known file: refresh its location (auto-relink)
      if (handle) dup.handle = handle;
      if (folderId) dup.folderId = folderId;
      if (relPath) dup.relPath = relPath;
      if (!handle) this.sessionFiles.set(dup.id, file);
      this.status.set(dup.id, handle ? 'ok' : 'session');
      await this.save(dup);
      return dup;
    }
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    const m = parseMetadata(head, file.name);
    const fb = metaFromFilename(file.name);
    const t: Track = {
      id: uid(),
      fileName: file.name,
      relPath,
      folderId,
      handle,
      size: file.size,
      lastModified: file.lastModified,
      format: m.format,
      title: m.title || fb.title,
      artist: m.artist || fb.artist,
      album: m.album,
      genre: m.genre,
      tagBpm: m.tagBpm,
      sampleRate: m.sampleRate,
      channels: m.channels,
      bitrateKbps: m.bitrateKbps,
      analysisStatus: 'pending',
      hotCues: new Array(HOT_CUES).fill(null),
      addedAt: Date.now(),
      playCount: 0,
    };
    this.tracks.set(t.id, t);
    if (!handle) this.sessionFiles.set(t.id, file);
    this.status.set(t.id, handle ? 'ok' : 'session');
    await this.save(t);
    return t;
  }

  /** File picker import. Returns number of tracks added. */
  async importFiles(): Promise<number> {
    if (fsaSupported()) {
      let handles: FileSystemFileHandle[];
      try {
        handles = await (window as unknown as { showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          multiple: true,
          id: 'spindle-music',
          startIn: 'music',
          types: [{ description: 'Audio files', accept: { 'audio/*': SUPPORTED_EXTENSIONS.map((e) => '.' + e) } }],
        });
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return 0;
        throw e;
      }
      let n = 0;
      for (const h of handles) if (await this.addFile(await h.getFile(), h)) n++;
      this.notify();
      return n;
    }
    const files = await pickWithInput(false);
    let n = 0;
    for (const f of files) if (await this.addFile(f)) n++;
    this.notify();
    return n;
  }

  /** Import every supported audio file inside a user-chosen folder (recursive). */
  async importFolder(onProgress?: (n: number) => void): Promise<number> {
    if (!fsaSupported()) {
      const files = await pickWithInput(true);
      let n = 0;
      for (const f of files) if (await this.addFile(f)) n++;
      this.notify();
      return n;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
        id: 'spindle-folder',
        mode: 'read',
        startIn: 'music',
      });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 0;
      throw e;
    }
    let folder = this.folders.find((f) => f.name === dir.name);
    if (folder) {
      const same = await folder.handle.isSameEntry(dir).catch(() => false);
      if (!same) folder = undefined;
    }
    if (!folder) {
      folder = { id: uid(), name: dir.name, handle: dir, addedAt: Date.now() };
      this.folders.push(folder);
      await db.put('folders', folder);
    }
    let n = 0;
    for await (const { handle, path } of walk(dir, '')) {
      const f = await handle.getFile();
      if (await this.addFile(f, handle, folder.id, path)) n++;
      onProgress?.(n);
      if (n % 25 === 0) this.notify();
      if (n >= MAX_SCAN_FILES) break;
    }
    this.notify();
    return n;
  }

  /** Re-point one missing track at a file the user picks. */
  async relink(t: Track): Promise<boolean> {
    if (!fsaSupported()) {
      const [f] = await pickWithInput(false, false);
      if (!f) return false;
      this.sessionFiles.set(t.id, f);
      this.applyRelink(t, f);
      this.status.set(t.id, 'session');
      await this.save(t);
      this.notify();
      return true;
    }
    let h: FileSystemFileHandle;
    try {
      [h] = await (window as unknown as { showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ multiple: false, id: 'spindle-music' });
    } catch {
      return false;
    }
    const f = await h.getFile();
    t.handle = h;
    this.applyRelink(t, f);
    this.status.set(t.id, 'ok');
    await this.save(t);
    this.notify();
    return true;
  }

  private applyRelink(t: Track, f: File) {
    if (f.size !== t.size) t.analysisStatus = 'pending'; // different audio — redo analysis
    t.fileName = f.name;
    t.size = f.size;
    t.lastModified = f.lastModified;
  }

  /** Scan a folder and re-link every missing track whose file name (and size) matches. */
  async relinkInFolder(): Promise<number> {
    if (!fsaSupported()) return 0;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' });
    } catch {
      return 0;
    }
    const missing = [...this.tracks.values()].filter((t) => this.status.get(t.id) === 'missing');
    if (!missing.length) return 0;
    const byName = new Map<string, Track[]>();
    for (const t of missing) byName.set(t.fileName, [...(byName.get(t.fileName) ?? []), t]);
    let n = 0;
    for await (const { handle } of walk(dir, '')) {
      const cands = byName.get(handle.name);
      if (!cands?.length) continue;
      const f = await handle.getFile();
      const t = cands.find((c) => c.size === f.size) ?? cands[0];
      t.handle = handle;
      this.applyRelink(t, f);
      this.status.set(t.id, 'ok');
      await this.save(t);
      cands.splice(cands.indexOf(t), 1);
      n++;
    }
    this.notify();
    return n;
  }

  async save(t: Track): Promise<void> {
    await db.put('tracks', t);
    this.notify();
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.tracks.delete(id);
      this.status.delete(id);
      this.sessionFiles.delete(id);
      await db.del('tracks', id);
      await db.del('analysis', id);
    }
    for (const p of this.playlists) {
      const before = p.trackIds.length;
      p.trackIds = p.trackIds.filter((x) => !ids.includes(x));
      if (p.trackIds.length !== before) await db.put('playlists', p);
    }
    this.notify();
  }

  async getWave(id: string): Promise<WaveCache | undefined> {
    return db.get<WaveCache>('analysis', id);
  }
  async putWave(w: WaveCache): Promise<void> {
    await db.put('analysis', w);
  }

  // ---- playlists & queue
  playlist(id: string) {
    return this.playlists.find((p) => p.id === id);
  }
  async createPlaylist(name: string): Promise<Playlist> {
    const p: Playlist = { id: uid(), name: name.trim() || 'Untitled', trackIds: [], createdAt: Date.now() };
    this.playlists.push(p);
    await db.put('playlists', p);
    this.notify();
    return p;
  }
  async renamePlaylist(id: string, name: string) {
    const p = this.playlist(id);
    if (!p || id === QUEUE_ID) return;
    p.name = name.trim() || p.name;
    await db.put('playlists', p);
    this.notify();
  }
  async deletePlaylist(id: string) {
    if (id === QUEUE_ID) return;
    this.playlists = this.playlists.filter((p) => p.id !== id);
    await db.del('playlists', id);
    this.notify();
  }
  async addToPlaylist(id: string, trackIds: string[]) {
    const p = this.playlist(id);
    if (!p) return;
    for (const t of trackIds) if (id !== QUEUE_ID || !p.trackIds.includes(t)) p.trackIds.push(t);
    await db.put('playlists', p);
    this.notify();
  }
  async removeFromPlaylist(id: string, index: number) {
    const p = this.playlist(id);
    if (!p) return;
    p.trackIds.splice(index, 1);
    await db.put('playlists', p);
    this.notify();
  }
  async movePlaylistItem(id: string, from: number, to: number) {
    const p = this.playlist(id);
    if (!p || from === to) return;
    const [x] = p.trackIds.splice(from, 1);
    p.trackIds.splice(Math.max(0, Math.min(p.trackIds.length, to)), 0, x);
    await db.put('playlists', p);
    this.notify();
  }
  /** Pop the next queued track id. */
  async shiftQueue(): Promise<string | undefined> {
    const q = this.playlist(QUEUE_ID)!;
    const id = q.trackIds.shift();
    await db.put('playlists', q);
    this.notify();
    return id;
  }
}

async function* walk(dir: FileSystemDirectoryHandle, prefix: string, depth = 0): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  if (depth > 12) return;
  const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      if (isSupportedName(entry.name)) yield { handle: entry as FileSystemFileHandle, path };
    } else {
      yield* walk(entry as FileSystemDirectoryHandle, path, depth + 1);
    }
  }
}

function pickWithInput(directory: boolean, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = SUPPORTED_EXTENSIONS.map((e) => '.' + e).join(',') + ',audio/*';
    if (directory) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => resolve([...(input.files ?? [])].filter((f) => isSupportedName(f.name)));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Test hook / non-FSA path: add plain File objects (session only). */
export async function addSessionFiles(lib: Library, files: File[]): Promise<number> {
  let n = 0;
  for (const f of files) if (await lib.addFile(f)) n++;
  lib.notify();
  return n;
}

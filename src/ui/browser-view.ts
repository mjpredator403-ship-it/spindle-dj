// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import { fsaSupported, Library, QUEUE_ID, type FileStatus, type Track } from '../library/library';
import type { Deck } from '../deck';
import type { Settings } from '../settings';
import { fmtTime, h, setText, toast } from './dom';

type SortKey = 'title' | 'artist' | 'album' | 'bpm' | 'key' | 'durationSec' | 'format' | 'sampleRate' | 'addedAt' | 'status';
type View = { kind: 'library' } | { kind: 'playlist'; id: string } | { kind: 'missing' } | { kind: 'recent' };

const ROW_H = 28;
export const TRACK_MIME = 'application/x-spindle-track';

const STATUS_LABEL: Record<FileStatus, string> = {
  ok: '',
  session: 'session',
  missing: 'missing',
  'needs-permission': 'locked',
  unknown: '…',
};

export interface BrowserHost {
  decks: [Deck, Deck];
  loadToDeck(deck: Deck, track: Track): void;
  analyzeNow(track: Track): void;
  importFiles(): void;
  importFolder(): void;
}

export class BrowserView {
  readonly el: HTMLElement;
  private view: View = { kind: 'library' };
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'addedAt', dir: -1 };
  private query = '';
  private filter: 'all' | 'unanalysed' = 'all';
  private rows: Track[] = [];
  private selected = new Set<string>();
  private anchor: string | null = null;
  readonly search: HTMLInputElement;
  private sidebar = h('nav', { class: 'b-side', 'aria-label': 'Library sections' });
  private body = h('div', { class: 'b-body', tabindex: 0, role: 'grid', 'aria-label': 'Tracks' });
  private spacer = h('div', { class: 'b-spacer' });
  private rowsHost = h('div', { class: 'b-rows' });
  private head: HTMLElement;
  private countEl = h('span', { class: 'b-count' });
  private banner = h('div', { class: 'b-banner', hidden: true });
  private empty = h('div', { class: 'b-empty' });
  private menu: HTMLElement | null = null;
  // preview
  private audio = new Audio();
  private prevTitle = h('span', { class: 'p-title' }, 'Preview: nothing');
  private prevSeek = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Preview position', class: 'p-seek' }) as HTMLInputElement;
  private prevBtn = h('button', { class: 'sm', 'aria-label': 'Preview play/pause', onclick: () => this.togglePreview() }, '▶') as HTMLButtonElement;
  private prevUrl: string | null = null;

  constructor(private lib: Library, private host: BrowserHost, private settings: Settings) {
    this.search = h('input', { type: 'search', placeholder: 'Search title, artist, album, file…  ( / )', 'aria-label': 'Search library', class: 'b-search' }) as HTMLInputElement;
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.refresh();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.search.value = '';
        this.query = '';
        this.refresh();
        this.search.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.body.focus();
        if (this.rows[0]) this.select(this.rows[0].id, false, false);
      }
    });
    const filterSel = h('select', { 'aria-label': 'Filter', class: 'b-filter' }, h('option', { value: 'all' }, 'All'), h('option', { value: 'unanalysed' }, 'Not analysed')) as HTMLSelectElement;
    filterSel.addEventListener('change', () => {
      this.filter = filterSel.value as 'all' | 'unanalysed';
      this.refresh();
    });

    const cols: [SortKey, string, string][] = [
      ['title', 'Title', 'c-title'],
      ['artist', 'Artist', 'c-artist'],
      ['album', 'Album', 'c-album'],
      ['bpm', 'BPM', 'c-bpm'],
      ['key', 'Key', 'c-key'],
      ['durationSec', 'Time', 'c-time'],
      ['format', 'Fmt', 'c-fmt'],
      ['sampleRate', 'kHz', 'c-sr'],
      ['status', 'Status', 'c-status'],
    ];
    this.head = h(
      'div',
      { class: 'b-head', role: 'row' },
      h('span', { class: 'c-load' }, 'Load'),
      ...cols.map(([k, label, cls]) => {
        const b = h('button', { class: `c ${cls}`, role: 'columnheader', onclick: () => this.sortBy(k) }, label);
        b.dataset.key = k;
        return b;
      }),
    );

    this.body.append(this.spacer, this.rowsHost);
    this.body.addEventListener('scroll', () => this.renderRows());
    this.body.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.renderRows()).observe(this.body);

    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.duration) this.prevSeek.value = String(this.audio.currentTime / this.audio.duration);
    });
    this.audio.addEventListener('play', () => setText(this.prevBtn, '❚❚'));
    this.audio.addEventListener('pause', () => setText(this.prevBtn, '▶'));
    this.audio.addEventListener('error', () => toast('Preview: this file could not be played.', 'error'));
    this.prevSeek.addEventListener('input', () => {
      if (this.audio.duration) this.audio.currentTime = parseFloat(this.prevSeek.value) * this.audio.duration;
    });
    const prevVol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, 'aria-label': 'Preview volume', class: 'p-vol', title: 'Preview volume' }) as HTMLInputElement;
    this.audio.volume = 0.8;
    prevVol.addEventListener('input', () => (this.audio.volume = parseFloat(prevVol.value)));
    void this.applyPreviewDevice();

    const preview = h(
      'div',
      { class: 'b-preview', title: 'Preview a track without touching the decks. Choose a separate output (e.g. headphones) in Settings → Audio.' },
      this.prevBtn,
      this.prevTitle,
      this.prevSeek,
      prevVol,
    );

    const toolbar = h(
      'div',
      { class: 'b-toolbar' },
      this.search,
      filterSel,
      this.countEl,
      h('button', { class: 'sm', onclick: () => host.importFiles(), title: 'Add audio files (MP3, WAV, FLAC, OGG, M4A…)' }, '+ Files'),
      h('button', { class: 'sm', onclick: () => host.importFolder(), title: 'Add a whole music folder (scanned recursively)' }, '+ Folder'),
    );

    this.el = h(
      'section',
      { class: 'browser', 'aria-label': 'Music library' },
      this.sidebar,
      h('div', { class: 'b-main' }, toolbar, this.banner, this.head, this.body, this.empty, preview),
    );

    lib.onChange(() => {
      this.renderSidebar();
      this.refresh();
    });
    document.addEventListener('click', () => this.closeMenu());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.closeMenu());
    this.renderSidebar();
    this.refresh();
  }

  async applyPreviewDevice() {
    const id = this.settings.get('previewDeviceId');
    const a = this.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (a.setSinkId) {
      try {
        await a.setSinkId(id || '');
      } catch {
        /* device gone — falls back to default */
      }
    }
  }

  focusSearch() {
    this.search.focus();
    this.search.select();
  }

  selectedTrack(): Track | undefined {
    const id = this.anchor ?? [...this.selected][0];
    return id ? this.lib.tracks.get(id) : undefined;
  }

  // ------------------------------------------------------------- sidebar
  private renderSidebar() {
    const c = this.lib.counts();
    const item = (label: string, v: View, count?: number, extra?: HTMLElement) => {
      const active = JSON.stringify(v) === JSON.stringify(this.view);
      const b = h('button', { class: 's-item' + (active ? ' active' : ''), 'aria-current': active ? 'true' : undefined, onclick: () => this.setView(v) }, h('span', {}, label), count !== undefined ? h('span', { class: 's-n' }, String(count)) : null);
      b.addEventListener('dragover', (e) => {
        if (v.kind === 'playlist' && e.dataTransfer?.types.includes(TRACK_MIME)) {
          e.preventDefault();
          b.classList.add('drop');
        }
      });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => {
        b.classList.remove('drop');
        if (v.kind !== 'playlist') return;
        const ids = (e.dataTransfer?.getData(TRACK_MIME) ?? '').split(',').filter(Boolean);
        if (ids.length) {
          e.preventDefault();
          void this.lib.addToPlaylist(v.id, ids);
          toast(`Added ${ids.length} track(s) to ${this.lib.playlist(v.id)?.name}.`);
        }
      });
      return extra ? h('div', { class: 's-row' }, b, extra) : b;
    };
    const queue = this.lib.playlist(QUEUE_ID);
    const pls = this.lib.playlists.filter((p) => p.id !== QUEUE_ID);
    const kids: (HTMLElement | null)[] = [
      h('div', { class: 's-title' }, 'Library'),
      item('All tracks', { kind: 'library' }, c.total),
      item('Recently played', { kind: 'recent' }),
      c.missing ? item('Missing files', { kind: 'missing' }, c.missing) : null,
      queue ? item('Queue', { kind: 'playlist', id: QUEUE_ID }, queue.trackIds.length) : null,
      h('div', { class: 's-title' }, 'Playlists', h('button', { class: 'sm s-add', title: 'New playlist', 'aria-label': 'New playlist', onclick: () => this.newPlaylist() }, '+')),
      ...pls.map((p) =>
        item(
          p.name,
          { kind: 'playlist', id: p.id },
          p.trackIds.length,
          h(
            'span',
            { class: 's-tools' },
            h('button', { class: 'xs', title: 'Rename', 'aria-label': `Rename ${p.name}`, onclick: () => this.renamePlaylist(p.id) }, '✎'),
            h('button', { class: 'xs', title: 'Delete', 'aria-label': `Delete ${p.name}`, onclick: () => this.deletePlaylist(p.id) }, '×'),
          ),
        ),
      ),
      pls.length ? null : h('div', { class: 's-hint' }, 'Create a playlist with +, then drag tracks onto it.'),
      h('div', { class: 's-title' }, 'Folders'),
      ...this.lib.folders.map((f) => h('div', { class: 's-folder', title: 'Imported folder (read-only access)' }, '📁 ' + f.name)),
      fsaSupported() ? h('button', { class: 'sm s-wide', onclick: () => this.relinkFolder(), title: 'Find moved/renamed files: pick the folder they now live in' }, 'Relink missing…') : null,
    ];
    this.sidebar.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
    // permission / missing banner
    if (c.needsPermission) {
      this.banner.hidden = false;
      this.banner.replaceChildren(
        h('span', {}, `${c.needsPermission} track(s) need permission to be read again (browser security after restart). `),
        h('button', { class: 'sm', onclick: () => void this.lib.grantAccess() }, 'Grant access'),
      );
    } else this.banner.hidden = true;
  }

  private setView(v: View) {
    this.view = v;
    this.selected.clear();
    this.anchor = null;
    this.body.scrollTop = 0;
    this.renderSidebar();
    this.refresh();
  }

  private async newPlaylist() {
    const name = prompt('Playlist name', 'New playlist');
    if (name === null) return;
    const p = await this.lib.createPlaylist(name);
    this.setView({ kind: 'playlist', id: p.id });
  }
  private async renamePlaylist(id: string) {
    const p = this.lib.playlist(id);
    const name = prompt('Rename playlist', p?.name);
    if (name) await this.lib.renamePlaylist(id, name);
  }
  private async deletePlaylist(id: string) {
    const p = this.lib.playlist(id);
    if (p && confirm(`Delete playlist "${p.name}"? (Tracks stay in the library.)`)) {
      await this.lib.deletePlaylist(id);
      if (this.view.kind === 'playlist' && this.view.id === id) this.setView({ kind: 'library' });
    }
  }
  private async relinkFolder() {
    const n = await this.lib.relinkInFolder();
    toast(n ? `Relinked ${n} missing track(s).` : 'No matching missing files found in that folder.');
  }

  // --------------------------------------------------------------- rows
  private sortBy(k: SortKey) {
    this.sort = this.sort.key === k ? { key: k, dir: (this.sort.dir * -1) as 1 | -1 } : { key: k, dir: k === 'addedAt' ? -1 : 1 };
    this.refresh();
  }

  private sortVal(t: Track, k: SortKey): string | number {
    switch (k) {
      case 'bpm':
        return t.bpm ?? -1;
      case 'key':
        return t.keyCamelot ? parseInt(t.keyCamelot) * 2 + (t.keyCamelot.endsWith('B') ? 1 : 0) : 99;
      case 'durationSec':
        return t.durationSec ?? -1;
      case 'sampleRate':
        return t.sampleRate ?? -1;
      case 'addedAt':
        return t.addedAt;
      case 'status':
        return this.lib.status.get(t.id) ?? '';
      default:
        return (t[k] ?? '').toString().toLowerCase();
    }
  }

  refresh() {
    let list: Track[];
    const v = this.view;
    const ordered = v.kind === 'playlist';
    if (v.kind === 'playlist') {
      const p = this.lib.playlist(v.id);
      list = (p?.trackIds ?? []).map((id) => this.lib.tracks.get(id)).filter((t): t is Track => !!t);
    } else {
      list = [...this.lib.tracks.values()];
      if (v.kind === 'missing') list = list.filter((t) => this.lib.status.get(t.id) === 'missing');
      if (v.kind === 'recent') list = list.filter((t) => t.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    }
    if (this.query) {
      const q = this.query;
      list = list.filter((t) => `${t.title} ${t.artist ?? ''} ${t.album ?? ''} ${t.fileName} ${t.genre ?? ''}`.toLowerCase().includes(q));
    }
    if (this.filter === 'unanalysed') list = list.filter((t) => t.analysisStatus !== 'done');
    if (!ordered && v.kind !== 'recent') {
      const { key, dir } = this.sort;
      list.sort((a, b) => {
        const x = this.sortVal(a, key),
          y = this.sortVal(b, key);
        return x < y ? -dir : x > y ? dir : 0;
      });
    }
    this.rows = list;
    setText(this.countEl, `${list.length} track${list.length === 1 ? '' : 's'}`);
    for (const b of this.head.querySelectorAll<HTMLButtonElement>('button.c')) {
      const active = !ordered && b.dataset.key === this.sort.key;
      b.classList.toggle('sorted', active);
      b.setAttribute('aria-sort', active ? (this.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
    }
    if (!this.lib.tracks.size) {
      this.empty.hidden = false;
      this.empty.replaceChildren(
        h('h3', {}, 'Your library is empty'),
        h('p', {}, 'Add music you own: MP3, WAV, FLAC, Ogg, Opus or M4A. Nothing is uploaded — files stay on this device.'),
        h('div', { class: 'row' }, h('button', { onclick: () => this.host.importFiles() }, '+ Add files'), h('button', { onclick: () => this.host.importFolder() }, '+ Add a folder')),
        h('p', { class: 'muted' }, 'Tip: you can also drag audio files from the Files app straight onto a deck.'),
      );
    } else if (!list.length) {
      this.empty.hidden = false;
      this.empty.replaceChildren(h('p', {}, v.kind === 'playlist' ? 'This list is empty — drag tracks here from “All tracks”, or right-click a track.' : 'No tracks match.'));
    } else this.empty.hidden = true;
    this.spacer.style.height = `${list.length * ROW_H}px`;
    this.renderRows();
  }

  private renderRows() {
    const top = this.body.scrollTop;
    const hgt = this.body.clientHeight || 300;
    const first = Math.max(0, Math.floor(top / ROW_H) - 4);
    const last = Math.min(this.rows.length, Math.ceil((top + hgt) / ROW_H) + 4);
    this.rowsHost.style.transform = `translateY(${first * ROW_H}px)`;
    const frag: HTMLElement[] = [];
    for (let i = first; i < last; i++) frag.push(this.row(this.rows[i], i));
    this.rowsHost.replaceChildren(...frag);
  }

  private row(t: Track, index: number): HTMLElement {
    const st = this.lib.status.get(t.id) ?? 'unknown';
    const bpmTxt = t.bpm ? `${(t.bpmConfidence ?? 1) < 0.35 && !t.gridEdited ? '~' : ''}${t.bpm.toFixed(1)}` : t.analysisStatus === 'analyzing' ? '…' : t.analysisStatus === 'failed' ? 'err' : '';
    const loadBtn = (d: Deck) =>
      h(
        'button',
        {
          class: `xs ld ld-${d.name.toLowerCase()}`,
          title: `Load to deck ${d.name}`,
          'aria-label': `Load ${t.title} to deck ${d.name}`,
          onclick: (e: Event) => {
            e.stopPropagation();
            this.host.loadToDeck(d, t);
          },
        },
        d.name,
      );
    const r = h(
      'div',
      {
        class: 'b-row' + (this.selected.has(t.id) ? ' sel' : '') + (st === 'missing' ? ' missing' : ''),
        role: 'row',
        draggable: 'true',
        'aria-selected': this.selected.has(t.id) ? 'true' : 'false',
      },
      h('span', { class: 'c-load' }, loadBtn(this.host.decks[0]), loadBtn(this.host.decks[1])),
      h('span', { class: 'c c-title', title: t.fileName }, t.title),
      h('span', { class: 'c c-artist' }, t.artist ?? ''),
      h('span', { class: 'c c-album' }, t.album ?? ''),
      h('span', { class: 'c c-bpm', title: t.bpmConfidence !== undefined ? `confidence ${Math.round(t.bpmConfidence * 100)}%` : '' }, bpmTxt),
      h('span', { class: 'c c-key', title: t.keyName ?? '' }, t.keyCamelot ? `${t.keyCamelot}` : ''),
      h('span', { class: 'c c-time' }, t.durationSec ? fmtTime(t.durationSec, false) : ''),
      h('span', { class: 'c c-fmt' }, t.format.toUpperCase()),
      h('span', { class: 'c c-sr' }, t.sampleRate ? (t.sampleRate / 1000).toFixed(1) : ''),
      h('span', { class: `c c-status st-${st}`, title: statusTitle(st, t) }, STATUS_LABEL[st] || (t.analysisStatus === 'done' ? '✓' : t.analysisStatus === 'failed' ? 'analysis failed' : 'pending')),
    );
    r.addEventListener('click', (e) => this.select(t.id, e.shiftKey, e.ctrlKey || e.metaKey));
    r.addEventListener('dblclick', () => {
      const d = this.host.decks.find((x) => !x.playing) ?? this.host.decks[0];
      this.host.loadToDeck(d, t);
    });
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.selected.has(t.id)) this.select(t.id, false, false);
      this.openMenu(e.clientX, e.clientY, t, index);
    });
    r.addEventListener('dragstart', (e) => {
      if (!this.selected.has(t.id)) this.select(t.id, false, false);
      e.dataTransfer!.setData(TRACK_MIME, [...this.selected].join(','));
      e.dataTransfer!.setData('text/plain', t.title);
      e.dataTransfer!.effectAllowed = 'copy';
    });
    return r;
  }

  private select(id: string, range: boolean, toggle: boolean) {
    if (range && this.anchor) {
      const a = this.rows.findIndex((r) => r.id === this.anchor);
      const b = this.rows.findIndex((r) => r.id === id);
      this.selected.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selected.add(this.rows[i].id);
    } else if (toggle) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.anchor = id;
    } else {
      this.selected.clear();
      this.selected.add(id);
      this.anchor = id;
    }
    this.renderRows();
  }

  private onKey(e: KeyboardEvent) {
    const idx = this.rows.findIndex((r) => r.id === this.anchor);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = Math.max(0, Math.min(this.rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      if (this.rows[n]) {
        this.select(this.rows[n].id, e.shiftKey, false);
        const y = n * ROW_H;
        if (y < this.body.scrollTop) this.body.scrollTop = y;
        else if (y + ROW_H > this.body.scrollTop + this.body.clientHeight) this.body.scrollTop = y + ROW_H - this.body.clientHeight;
      }
    } else if (e.key === 'Enter' && this.rows[idx]) {
      e.preventDefault();
      e.stopPropagation();
      const d = this.host.decks.find((x) => !x.playing) ?? this.host.decks[0];
      this.host.loadToDeck(d, this.rows[idx]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size) {
      e.preventDefault();
      void this.removeSelected();
    }
  }

  private async removeSelected() {
    const ids = [...this.selected];
    if (this.view.kind === 'playlist') {
      const p = this.lib.playlist(this.view.id)!;
      const idxs = ids.map((id) => p.trackIds.indexOf(id)).filter((i) => i >= 0).sort((a, b) => b - a);
      for (const i of idxs) await this.lib.removeFromPlaylist(p.id, i);
    } else if (confirm(`Remove ${ids.length} track(s) from the library? (Files on disk are not touched.)`)) {
      await this.lib.remove(ids);
    }
    this.selected.clear();
  }

  // -------------------------------------------------------- context menu
  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }
  private openMenu(x: number, y: number, t: Track, index: number) {
    this.closeMenu();
    const ids = [...this.selected];
    const st = this.lib.status.get(t.id);
    const mi = (label: string, fn: () => void, disabled = false) => h('button', { class: 'mi', role: 'menuitem', disabled, onclick: () => { this.closeMenu(); fn(); } }, label);
    const pls = this.lib.playlists.filter((p) => p.id !== QUEUE_ID);
    const inPl = this.view.kind === 'playlist';
    this.menu = h(
      'div',
      { class: 'menu', role: 'menu' },
      mi('Load to deck A', () => this.host.loadToDeck(this.host.decks[0], t)),
      mi('Load to deck B', () => this.host.loadToDeck(this.host.decks[1], t)),
      mi('Preview', () => void this.preview(t)),
      h('hr'),
      mi(`Add to Queue${ids.length > 1 ? ` (${ids.length})` : ''}`, () => void this.lib.addToPlaylist(QUEUE_ID, ids)),
      ...pls.map((p) => mi(`Add to “${p.name}”`, () => void this.lib.addToPlaylist(p.id, ids))),
      inPl ? mi('Move up', () => void this.lib.movePlaylistItem((this.view as { id: string }).id, index, index - 1), index === 0) : null,
      inPl ? mi('Move down', () => void this.lib.movePlaylistItem((this.view as { id: string }).id, index, index + 1)) : null,
      h('hr'),
      mi('Re-analyse (BPM, key, waveform)', () => this.host.analyzeNow(t), st === 'missing'),
      st === 'missing' || st === 'session' ? mi('Relink file…', () => void this.lib.relink(t)) : null,
      mi(inPl ? 'Remove from this list' : 'Remove from library', () => void this.removeSelected()),
    );
    document.body.append(this.menu);
    const r = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    this.menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    (this.menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  // ------------------------------------------------------------ preview
  async preview(t: Track) {
    try {
      const f = await this.lib.getFile(t);
      if (this.prevUrl) URL.revokeObjectURL(this.prevUrl);
      this.prevUrl = URL.createObjectURL(f);
      this.audio.src = this.prevUrl;
      setText(this.prevTitle, `Preview: ${t.title}`);
      await this.audio.play();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  private togglePreview() {
    if (!this.audio.src) {
      const t = this.selectedTrack();
      if (t) void this.preview(t);
      return;
    }
    if (this.audio.paused) void this.audio.play();
    else this.audio.pause();
  }
}

function statusTitle(st: FileStatus, t: Track): string {
  switch (st) {
    case 'missing':
      return 'File not found — moved, renamed or deleted. Right-click → Relink.';
    case 'needs-permission':
      return 'The browser needs you to re-confirm access. Use “Grant access”.';
    case 'session':
      return 'Added for this session only; will need relinking after a restart.';
    default:
      return t.analysisStatus === 'failed' ? `Analysis failed: ${t.analysisError ?? ''}` : t.analysisStatus === 'done' ? 'Analysed' : 'Waiting for analysis';
  }
}

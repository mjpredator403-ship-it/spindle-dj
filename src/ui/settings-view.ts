// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import type { Settings, MidiBinding } from '../settings';
import { DEFAULT_KEYMAP } from '../settings';
import type { Action } from '../control/actions';
import { keyLabel } from '../control/keyboard';
import { MidiController } from '../control/midi';
import { Engine, type LatencyHint } from '../audio/engine';
import { clearAll } from '../library/db';
import { h, toast } from './dom';
import { APP_NAME, COPYRIGHT_LINE, CREDIT_LINE, ORIGINAL_AUTHOR, REPO_URL } from '../credits';

export interface SettingsHost {
  engine: Engine;
  settings: Settings;
  actions: Map<string, Action>;
  midi: MidiController;
  applyPreviewDevice(): void;
}

export class SettingsView {
  readonly dialog: HTMLDialogElement;
  private body = h('div', { class: 'set-body' });
  private tab: 'audio' | 'mixing' | 'keys' | 'midi' | 'library' | 'about' = 'audio';
  private tabs: HTMLElement;

  constructor(private host: SettingsHost) {
    const tabBtn = (id: SettingsView['tab'], label: string) =>
      h('button', { class: 'tab', role: 'tab', onclick: () => { this.tab = id; this.render(); } }, label);
    this.tabs = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabBtn('audio', 'Audio'),
      tabBtn('mixing', 'Mixing'),
      tabBtn('keys', 'Keyboard'),
      tabBtn('midi', 'MIDI'),
      tabBtn('library', 'Library & data'),
      tabBtn('about', 'About & privacy'),
    );
    this.dialog = h(
      'dialog',
      { class: 'settings', 'aria-label': 'Settings' },
      h('div', { class: 'set-head' }, h('h2', {}, 'Settings'), h('button', { class: 'sm', 'aria-label': 'Close settings', onclick: () => this.dialog.close() }, '✕')),
      this.tabs,
      this.body,
    ) as HTMLDialogElement;
    this.dialog.addEventListener('close', () => host.midi.cancelLearn());
    document.body.append(this.dialog);
  }

  open(tab?: SettingsView['tab']) {
    if (tab) this.tab = tab;
    this.render();
    this.dialog.showModal();
  }

  private render() {
    [...this.tabs.children].forEach((c, i) =>
      c.setAttribute('aria-selected', String(['audio', 'mixing', 'keys', 'midi', 'library', 'about'][i] === this.tab)),
    );
    const fn = { audio: this.audio, mixing: this.mixing, keys: this.keys, midi: this.midiTab, library: this.library, about: this.about }[this.tab];
    this.body.replaceChildren(...fn.call(this));
  }

  private field(label: string, control: HTMLElement, help?: string) {
    return h('label', { class: 'field' }, h('span', { class: 'f-label' }, label), control, help ? h('small', {}, help) : null);
  }

  private audio(): HTMLElement[] {
    const { engine, settings } = this.host;
    const st = engine.status();
    const lat = h(
      'select',
      {},
      ...(['interactive', 'balanced', 'playback'] as LatencyHint[]).map((v) =>
        h('option', { value: v, selected: settings.get('latencyHint') === v }, v === 'interactive' ? 'Low latency (interactive)' : v === 'balanced' ? 'Balanced' : 'Large buffer (most stable)'),
      ),
    ) as HTMLSelectElement;
    lat.addEventListener('change', () => {
      settings.set('latencyHint', lat.value as LatencyHint);
      toast('Latency setting saved — reload Spindle to apply it.', 'info', 6000);
    });
    const out = h('select', { disabled: !Engine.outputSelectionSupported() }) as HTMLSelectElement;
    const prev = h('select', {}) as HTMLSelectElement;
    void this.fillDevices(out, prev);
    out.addEventListener('change', async () => {
      try {
        await engine.setOutputDevice(out.value);
        settings.set('outputDeviceId', out.value);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    });
    prev.addEventListener('change', () => {
      settings.set('previewDeviceId', prev.value);
      this.host.applyPreviewDevice();
    });
    const max = h('input', { type: 'number', min: 5, max: 180, step: 5, value: settings.get('maxTrackMinutes') }) as HTMLInputElement;
    max.addEventListener('change', () => settings.set('maxTrackMinutes', Math.max(5, Math.min(180, parseInt(max.value) || 30))));
    return [
      h(
        'div',
        { class: 'statbox' },
        h('div', {}, `Audio engine: ${st.state}`),
        h('div', {}, `Sample rate: ${st.sampleRate} Hz`),
        h('div', {}, `Buffer latency: ${st.baseLatencyMs.toFixed(1)} ms · Output latency: ${st.outputLatencyMs ? st.outputLatencyMs.toFixed(1) + ' ms' : 'not reported'}`),
      ),
      this.field('Latency / buffer size', lat, 'Lower = more responsive, higher = fewer dropouts on slower Chromebooks. Applied on reload.'),
      this.field('Master output device', out, Engine.outputSelectionSupported() ? 'Where the mix plays.' : 'This browser cannot choose an output device; the system default is used.'),
      this.field('Preview output device', prev, 'Use headphones here to pre-listen to library tracks while the mix plays on speakers. (Requires two audio devices, e.g. USB headphones.)'),
      this.field('Maximum track length (minutes)', max, 'Tracks are fully decoded into memory (~23 MB per stereo minute at 48 kHz). Lower this on 4 GB Chromebooks.'),
    ];
  }

  private async fillDevices(out: HTMLSelectElement, prev: HTMLSelectElement) {
    try {
      const devs = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
      const outs = devs.filter((d) => d.kind === 'audiooutput');
      const opts = (sel: string) => [
        h('option', { value: '', selected: !sel }, 'System default'),
        ...outs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === sel }, d.label || `Output ${i + 1}`)),
      ];
      out.replaceChildren(...opts(this.host.settings.get('outputDeviceId')));
      prev.replaceChildren(...opts(this.host.settings.get('previewDeviceId')));
    } catch {
      /* enumerateDevices unavailable */
    }
  }

  private mixing(): HTMLElement[] {
    const { settings } = this.host;
    const q = h('input', { type: 'checkbox', checked: settings.get('quantize') }) as HTMLInputElement;
    q.addEventListener('change', () => settings.set('quantize', q.checked));
    const pr = h('select', {}, ...[8, 16, 50].map((r) => h('option', { value: r, selected: settings.get('pitchRange') === r }, `±${r}%`))) as HTMLSelectElement;
    pr.addEventListener('change', () => settings.set('pitchRange', parseInt(pr.value)));
    const aw = h('input', { type: 'checkbox', checked: settings.get('analyzeWhilePlaying') }) as HTMLInputElement;
    aw.addEventListener('change', () => settings.set('analyzeWhilePlaying', aw.checked));
    const zoom = h('input', { type: 'range', min: 2, max: 30, step: 1, value: settings.get('waveZoom') }) as HTMLInputElement;
    zoom.addEventListener('input', () => settings.set('waveZoom', parseInt(zoom.value)));
    return [
      this.field('Quantize cues & loops to the beat grid', q, 'When a track has a beat grid, cue points, hot cues and loops snap to the nearest beat.'),
      this.field('Default pitch range', pr),
      this.field('Analyse library in the background while a deck is playing', aw, 'Turn off if you hear dropouts on a slow Chromebook; analysis then runs only while both decks are stopped.'),
      this.field('Scrolling waveform window (seconds)', zoom),
      h(
        'p',
        { class: 'muted' },
        'Tempo changes use vinyl-style varispeed: pitch and tempo move together. Key-lock (pitch-preserving time-stretch) is not implemented in this version — see docs/ROADMAP.md.',
      ),
    ];
  }

  private keys(): HTMLElement[] {
    const { settings, actions } = this.host;
    const map = settings.get('keymap');
    const byAction = new Map<string, string>();
    for (const [code, id] of Object.entries(map)) byAction.set(id, code);
    const list = h('div', { class: 'maplist' });
    for (const a of actions.values()) {
      if (a.kind !== 'button') continue;
      const code = byAction.get(a.id);
      const btn = h('button', { class: 'sm keycap', title: 'Click, then press a key. Esc clears.' }, code ? keyLabel(code) : '—') as HTMLButtonElement;
      btn.addEventListener('click', () => {
        btn.textContent = 'press a key…';
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          const m = { ...settings.get('keymap') };
          for (const [c, id] of Object.entries(m)) if (id === a.id) delete m[c];
          if (e.key !== 'Escape') m[e.code] = a.id;
          settings.set('keymap', m);
          this.render();
        };
        window.addEventListener('keydown', onKey, true);
      });
      list.append(h('div', { class: 'maprow' }, h('span', {}, a.label), btn));
    }
    return [
      h('p', { class: 'muted' }, 'Shortcuts work when focus is not in a text field. Hold-type actions (cue, nudge) respond to key press and release.'),
      h('button', { class: 'sm', onclick: () => { settings.set('keymap', { ...DEFAULT_KEYMAP }); this.render(); } }, 'Reset to defaults'),
      list,
    ];
  }

  private midiTab(): HTMLElement[] {
    const { midi, settings, actions } = this.host;
    if (!MidiController.supported())
      return [h('p', {}, 'Web MIDI is not available in this browser. Use Chrome or Edge (desktop or ChromeOS). Spindle works fully without a controller.')];
    if (midi.status !== 'ready')
      return [
        h('p', {}, midi.status === 'denied' ? 'MIDI access was blocked. Allow it from the site settings (padlock icon) and try again.' : 'Connect a USB MIDI DJ controller, then enable MIDI.'),
        h('button', { onclick: async () => { await midi.enable(); this.render(); } }, 'Enable MIDI'),
      ];
    const binds = settings.get('midi');
    const list = h('div', { class: 'maplist' });
    const status = h('p', { class: 'muted' }, midi.inputs.length ? `Inputs: ${midi.inputs.join(', ')}` : 'No MIDI inputs detected. Plug in a controller (ChromeOS: it must be connected to ChromeOS, not shared into Linux).');
    for (const a of actions.values()) {
      const mine = binds.filter((b) => b.action === a.id);
      const learn = h('button', { class: 'sm' }, mine.length ? mine.map((b) => b.key).join(', ') : 'Learn') as HTMLButtonElement;
      learn.title = 'Click, then move/press the control on your controller';
      learn.addEventListener('click', () => {
        learn.textContent = 'move a control…';
        midi.learn((key, isNote) => {
          const mode: MidiBinding['mode'] = a.kind === 'relative' ? 'rel' : isNote ? 'button' : a.kind === 'button' ? 'button' : 'abs';
          const next = settings.get('midi').filter((b) => b.key !== key && b.action !== a.id);
          next.push({ key, action: a.id, mode });
          settings.set('midi', next);
          this.render();
        });
      });
      const clear = h('button', { class: 'xs', title: 'Remove mapping', disabled: !mine.length, onclick: () => { settings.set('midi', settings.get('midi').filter((b) => b.action !== a.id)); this.render(); } }, '×');
      list.append(h('div', { class: 'maprow' }, h('span', {}, `${a.label}`, h('small', { class: 'muted' }, ` (${a.kind})`)), h('span', {}, learn, clear)));
    }
    const exp = h('button', { class: 'sm', onclick: () => downloadJson('spindle-midi-mapping.json', settings.get('midi')) }, 'Export mapping');
    const imp = h('button', {
      class: 'sm',
      onclick: async () => {
        const txt = await pickText();
        if (!txt) return;
        try {
          const arr = JSON.parse(txt) as MidiBinding[];
          if (!Array.isArray(arr) || arr.some((b) => typeof b.key !== 'string' || typeof b.action !== 'string')) throw new Error('bad file');
          settings.set('midi', arr.filter((b) => actions.has(b.action)));
          this.render();
        } catch {
          toast('That file is not a Spindle MIDI mapping.', 'error');
        }
      },
    }, 'Import mapping');
    return [status, h('div', { class: 'row' }, exp, imp, h('button', { class: 'sm', onclick: () => { settings.set('midi', []); this.render(); } }, 'Clear all')), list];
  }

  private library(): HTMLElement[] {
    return [
      h('p', {}, 'Your library (track info, cue points, beat grids, playlists, settings) is stored in this browser’s IndexedDB on this device only.'),
      h('p', { class: 'muted' }, 'Spindle never uploads or modifies your audio files; it only reads files and folders you choose.'),
      h(
        'button',
        {
          class: 'danger',
          onclick: async () => {
            if (!confirm('Erase the whole Spindle library, playlists, cues and settings from this browser? Your audio files are not touched.')) return;
            await clearAll();
            location.reload();
          },
        },
        'Reset library & settings…',
      ),
    ];
  }

  private about(): HTMLElement[] {
    return [
      h('h3', {}, `${APP_NAME} ${__APP_VERSION__}`),
      h('p', { class: 'credit' }, CREDIT_LINE, h('span', { class: 'muted' }, ' — original author and inventor of Spindle DJ.')),
      h('p', { class: 'muted' }, COPYRIGHT_LINE),
      h('p', {}, 'Free and open-source software, licensed under the GNU GPL v3.0 or later. You may use, study, share and modify it. Modified versions must keep this credit to ', ORIGINAL_AUTHOR, ' (see NOTICE).'),
      h('p', {}, 'Source code, downloads and issue tracker: ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL)),
      h('p', {}, 'Privacy: no accounts, no telemetry, no analytics, no network requests after the app is loaded. Music never leaves your device. See PRIVACY.md in the source.'),
      h('p', { class: 'muted' }, 'Not affiliated with or endorsed by Atomix Productions (VirtualDJ) or Pioneer DJ / AlphaTheta. All trademarks belong to their owners.'),
    ];
  }
}


function downloadJson(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickText(): Promise<string | null> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.json,application/json';
    i.onchange = async () => res(i.files?.[0] ? await i.files[0].text() : null);
    i.click();
  });
}

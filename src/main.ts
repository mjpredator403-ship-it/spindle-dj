// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import './ui/styles.css';
import { Engine } from './audio/engine';
import { Library } from './library/library';
import { requestPersistence } from './library/db';
import { Settings } from './settings';
import { App } from './ui/app';
import { h } from './ui/dom';
import { CREDIT_LINE } from './credits';

async function boot() {
  const host = document.getElementById('app')!;
  if (!window.isSecureContext) {
    host.replaceChildren(fatal('Spindle must be opened from https:// or http://localhost (a “secure context”). Opening index.html directly from disk (file://) disables audio worklets, MIDI and file access. Run “npm run dev” or “npm run serve”, then open the printed address.'));
    return;
  }
  const settings = new Settings();
  await settings.load();
  let engine: Engine;
  try {
    engine = await Engine.create(settings.get('latencyHint'));
  } catch (e) {
    host.replaceChildren(fatal(`Audio could not be started: ${(e as Error).message}`));
    return;
  }
  const out = settings.get('outputDeviceId');
  if (out) engine.setOutputDevice(out).catch(() => settings.set('outputDeviceId', ''));

  const lib = new Library();
  await lib.load();
  void requestPersistence();

  const app = new App(engine, lib, settings);
  host.replaceChildren(app.root);

  // Browsers start audio suspended until the first user gesture.
  if (engine.ctx.state !== 'running') {
    const gate = h(
      'div',
      { class: 'gate' },
      h('div', { class: 'gate-card' }, h('div', { class: 'logo big' }, h('span', { class: 'logo-mark' }), 'SPINDLE'), h('p', {}, 'Free, open-source two-deck DJ mixer.'), h('button', { class: 'big', autofocus: true }, 'Start audio'), h('p', { class: 'gate-credit' }, CREDIT_LINE)),
    );
    const go = async () => {
      await engine.resume();
      gate.remove();
    };
    gate.addEventListener('click', go);
    gate.addEventListener('keydown', go);
    document.body.append(gate);
  }

  // PWA file handling: "Open with Spindle" from the ChromeOS Files app.
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  lq?.setConsumer(async ({ files }) => {
    let first = null;
    for (const fh of files ?? []) {
      const t = await lib.addFile(await fh.getFile(), fh);
      first = first ?? t;
    }
    lib.notify();
    if (first) void app.decks[0].load(first);
  });

  // Expose a small, read-mostly handle for debugging and automated tests.
  (window as unknown as { spindle: unknown }).spindle = { app, engine, lib, settings };

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

function fatal(msg: string) {
  return h('div', { class: 'fatal', role: 'alert' }, h('h2', {}, 'Spindle can’t start'), h('p', {}, msg));
}

void boot();

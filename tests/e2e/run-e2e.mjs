#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// End-to-end acceptance tests in a real Chromium: real decoding, real AudioWorklet
// decks, real Web Audio mixer graph, real recorder. The master output is recorded
// to WAV and analysed here with Goertzel filters to PROVE that mixing, EQ,
// crossfading, filtering and effects act on actual audio.
//
// Browser: set CHROME_PATH, or have chromium/google-chrome on PATH, or install
// the optional `playwright-core` + a Chrome build (see docs/TESTING.md).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SR = 48000;

// ---------------------------------------------------------------- helpers
function wav16(chs, sr) {
  const n = chs[0].length,
    c = chs.length;
  const buf = Buffer.alloc(44 + n * c * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * c * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(c, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * c * 2, 28);
  buf.writeUInt16LE(c * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chs[k][i] * 32767))), 44 + (i * c + k) * 2);
  return buf;
}
function parseWav(buf) {
  let o = 12,
    ch = 2,
    sr = 48000;
  while (o < buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      ch = buf.readUInt16LE(o + 10);
      sr = buf.readUInt32LE(o + 12);
    }
    if (id === 'data') {
      const frames = Math.floor(Math.min(size, buf.length - o - 8) / (2 * ch));
      const L = new Float32Array(frames);
      for (let i = 0; i < frames; i++) L[i] = buf.readInt16LE(o + 8 + i * ch * 2) / 32768;
      return { sr, ch, L, frames };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data');
}
function tone(x, f, sr) {
  const w = (2 * Math.PI * f) / sr,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / x.length;
}
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));
function rms(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Test track: steady tones + kick on every beat (so BPM analysis has something real to find). */
function makeTrack(freqs, bpm, seconds, offset = 0.1) {
  const n = seconds * SR;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) for (const [f, a] of freqs) L[i] += a * Math.sin((2 * Math.PI * f * i) / SR);
  const p = 60 / bpm;
  for (let t = offset; t < seconds; t += p) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 0.1 * SR && s + i < n; i++) L[s + i] += 0.35 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp((-i / SR) * 35);
  }
  return wav16([L, L], SR);
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']) if (existsSync(p)) return p;
  return null;
}

// ---------------------------------------------------------------- runner
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}${detail ? `  — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message, ms: Date.now() - t0 });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}

async function main() {
  let pw;
  try {
    pw = await import('playwright-core');
  } catch {
    console.error('playwright-core is not installed (npm i). Skipping E2E.');
    process.exit(2);
  }
  let exe = findChrome();
  let extraArgs = [];
  if (!exe) {
    try {
      const sp = (await import('@sparticuz/chromium')).default;
      exe = await sp.executablePath();
      extraArgs = sp.args.filter((a) => !a.startsWith('--single-process') && !a.includes('mute-audio'));
    } catch {
      /* none */
    }
  }
  if (!exe) {
    console.error('No Chrome/Chromium found. Set CHROME_PATH=/path/to/chrome. Skipping E2E.');
    process.exit(2);
  }

  // static server for dist/
  const port = 4300 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), join(ROOT, 'dist'), String(port)], { stdio: 'pipe' });
  await new Promise((r) => server.stdout.once('data', r));
  const url = `http://localhost:${port}/`;

  const dir = mkdtempSync(join(tmpdir(), 'spindle-e2e-'));
  const trackA = makeTrack([[440, 0.25], [100, 0.25]], 128, 40);
  const trackB = makeTrack([[660, 0.25]], 124, 40, 0.3);
  writeFileSync(join(dir, 'Test Artist - Tone A 128.wav'), trackA);
  writeFileSync(join(dir, 'Test Artist - Tone B 124.wav'), trackB);

  const browser = await pw.chromium.launch({
    executablePath: exe,
    headless: true,
    args: [...extraArgs, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  console.log(`\nSpindle DJ E2E — ${exe}\n`);
  await page.goto(url);
  await page.waitForFunction(() => window.spindle?.app);
  const gate = await page.$('.gate button');
  if (gate) await gate.click();

  const addFiles = async (files) =>
    page.evaluate(async (fs) => {
      const lib = window.spindle.lib;
      for (const f of fs) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        await lib.addFile(new File([bytes], f.name, { type: f.type, lastModified: 1700000000000 }));
      }
      lib.notify();
    }, files);
  const b64 = (b) => b.toString('base64');

  // record helper: N seconds of master output → parsed WAV (via the app's real recorder + download)
  const record = async (sec) => {
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await page.evaluate(() => window.spindle.app.recorder.start('memory'));
    await page.waitForTimeout(sec * 1000);
    await page.evaluate(() => window.spindle.app.recorder.stop());
    const d = await dl;
    const p = join(dir, `rec-${Date.now()}.wav`);
    await d.saveAs(p);
    const w = parseWav(readFileSync(p));
    // drop the first 150 ms (control ramps settling)
    return { ...w, L: w.L.subarray(Math.round(0.15 * w.sr)) };
  };
  const levels = (w) => ({ a: tone(w.L, 440, w.sr), b: tone(w.L, 660, w.sr), lo: tone(w.L, 100, w.sr), rms: rms(w.L) });
  const setRange = (sel, v) =>
    page.$eval(
      sel,
      (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      v,
    );

  await test('audio engine starts (AudioWorklet in a secure context)', async () => {
    const st = await page.evaluate(() => window.spindle.engine.status());
    assert(st.state === 'running', `AudioContext state is ${st.state}`);
    return `${st.sampleRate} Hz, base latency ${st.baseLatencyMs.toFixed(1)} ms`;
  });

  await test('import two tracks into the library (metadata from filename + WAV header)', async () => {
    await addFiles([
      { name: 'Test Artist - Tone A 128.wav', type: 'audio/wav', b64: b64(trackA) },
      { name: 'Test Artist - Tone B 124.wav', type: 'audio/wav', b64: b64(trackB) },
    ]);
    await page.waitForSelector('.b-row');
    const rows = await page.$$eval('.b-row .c-title', (els) => els.map((e) => e.textContent));
    assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
    const sr = await page.$$eval('.b-row .c-sr', (els) => els.map((e) => e.textContent));
    assert(sr.every((s) => s === '48.0'), `sample rate column: ${sr}`);
    return rows.join(' | ');
  });

  await test('load tracks via the A/B buttons; BPM + waveform come from real analysis', async () => {
    const rowA = page.locator('.b-row', { hasText: 'Tone A 128' });
    const rowB = page.locator('.b-row', { hasText: 'Tone B 124' });
    await rowA.locator('.ld-a').click();
    await rowB.locator('.ld-b').click();
    await page.waitForFunction(() => window.spindle.app.decks.every((d) => d.loaded && d.grid && d.wave), null, { timeout: 30000 });
    const info = await page.evaluate(() => window.spindle.app.decks.map((d) => ({ bpm: d.grid.bpm, fb: d.grid.firstBeat, peaks: d.wave.peaks.length, dur: d.duration })));
    assert(Math.abs(info[0].bpm - 128) < 0.1, `deck A BPM ${info[0].bpm}`);
    assert(Math.abs(info[1].bpm - 124) < 0.1, `deck B BPM ${info[1].bpm}`);
    assert(Math.abs(info[0].fb - 0.1) < 0.015, `deck A first beat ${info[0].fb}`);
    assert(info[0].peaks > 3900, `waveform buckets ${info[0].peaks}`);
    const shown = await page.$$eval('.d-bpm', (e) => e.map((x) => x.textContent));
    return `A ${info[0].bpm} BPM (beat @${info[0].fb.toFixed(3)}s), B ${info[1].bpm} BPM; displayed ${shown.join(' / ')}`;
  });

  await test('both decks play simultaneously and independently', async () => {
    await page.click('.deck-a .transport.play');
    await page.click('.deck-b .transport.play');
    // Compare against the audio clock (not wall time) so a busy CI machine can't cause false failures.
    const snap = () => page.evaluate(() => ({ p: window.spindle.app.decks.map((d) => d.ch.last.frame / d.ch.sampleRate), t: window.spindle.engine.ctx.currentTime }));
    const s0 = await snap();
    await page.waitForTimeout(1500);
    const s1 = await snap();
    const dt = s1.t - s0.t;
    const p0 = s0.p, p1 = s1.p;
    assert(dt > 0.5, `audio clock barely moved (${dt.toFixed(2)} s)`);
    for (const k of [0, 1]) assert(Math.abs(p1[k] - p0[k] - dt) < 0.1, `deck ${k ? 'B' : 'A'} advanced ${(p1[k] - p0[k]).toFixed(2)} s while audio clock advanced ${dt.toFixed(2)} s`);
    await page.click('.deck-a .transport.play'); // pause A only
    await page.waitForTimeout(600);
    const p2 = await page.evaluate(() => window.spindle.app.decks.map((d) => d.position()));
    await page.waitForTimeout(800);
    const p3 = await page.evaluate(() => window.spindle.app.decks.map((d) => d.position()));
    assert(Math.abs(p3[0] - p2[0]) < 0.01, 'deck A kept moving after pause');
    assert(p3[1] - p2[1] > 0.6, 'deck B stopped when deck A was paused');
    await page.click('.deck-a .transport.play');
    return `A ${p0[0].toFixed(2)}→${p1[0].toFixed(2)}s, B ${p0[1].toFixed(2)}→${p1[1].toFixed(2)}s`;
  });

  let centre;
  await test('crossfader: full A, full B and equal-power centre — measured in the recorded master', async () => {
    await setRange('.xfader', 0);
    const left = levels(await record(1.2));
    await setRange('.xfader', 1);
    const right = levels(await record(1.2));
    await setRange('.xfader', 0.5);
    centre = levels(await record(1.2));
    assert(db(left.b / left.a) < -40, `A side still has deck B at ${db(left.b / left.a).toFixed(1)} dB`);
    assert(db(right.a / right.b) < -40, `B side still has deck A at ${db(right.a / right.b).toFixed(1)} dB`);
    const ca = db(centre.a / left.a),
      cb = db(centre.b / right.b);
    // Absolute check: source 0.25 × xfade 0.7071 × master 0.85² (fader taper) → EQ/filters/FX at neutral must be transparent.
    const expectAbs = 0.25 * Math.SQRT1_2 * 0.85 * 0.85;
    const absErr = db(centre.a / expectAbs);
    assert(Math.abs(absErr) < 0.3, `neutral signal path not transparent: 440 Hz is ${absErr.toFixed(2)} dB off`);
    assert(Math.abs(ca + 3) < 1 && Math.abs(cb + 3) < 1, `centre should be ≈ −3 dB each (equal power): A ${ca.toFixed(2)} dB, B ${cb.toFixed(2)} dB`);
    return `full-A leak ${db(left.b / left.a).toFixed(0)} dB, full-B leak ${db(right.a / right.b).toFixed(0)} dB, centre A ${ca.toFixed(2)} dB / B ${cb.toFixed(2)} dB, neutral path error ${absErr.toFixed(2)} dB`;
  });

  await test('channel volume fader on deck A does not affect deck B', async () => {
    await setRange('.ch-a .chfader', 0.5);
    const l = levels(await record(1.2));
    await setRange('.ch-a .chfader', 1);
    const da = db(l.a / centre.a),
      dbb = db(l.b / centre.b);
    assert(Math.abs(da + 12.04) < 1, `deck A at fader 0.5 should be ≈ −12 dB, got ${da.toFixed(2)}`);
    assert(Math.abs(dbb) < 0.5, `deck B changed by ${dbb.toFixed(2)} dB`);
    return `A ${da.toFixed(2)} dB, B ${dbb.toFixed(2)} dB`;
  });

  await test('EQ low kill on deck A removes its bass, leaves deck B alone', async () => {
    const knob = page.locator('.ch-a .knob', { hasText: 'LOW' });
    await knob.focus();
    await page.keyboard.press('Home'); // → kill
    const l = levels(await record(1.2));
    await knob.focus();
    await page.keyboard.press('Enter'); // reset to flat
    const lo = db(l.lo / centre.lo),
      mid = db(l.a / centre.a),
      b = db(l.b / centre.b);
    assert(lo < -25, `100 Hz only dropped ${lo.toFixed(1)} dB`);
    assert(mid > -1.5, `440 Hz (mid band) dropped too much: ${mid.toFixed(1)} dB`);
    assert(Math.abs(b) < 0.5, `deck B changed ${b.toFixed(2)} dB`);
    return `100 Hz ${lo.toFixed(1)} dB, 440 Hz ${mid.toFixed(1)} dB, deck B ${b.toFixed(2)} dB`;
  });

  await test('filter knob (low-pass) on deck A attenuates highs', async () => {
    const knob = page.locator('.deck-a .knob', { hasText: 'FILTER' });
    await knob.focus();
    await page.keyboard.press('Home'); // full low-pass
    await page.waitForTimeout(200);
    const l = levels(await record(1.0));
    await knob.focus();
    await page.keyboard.press('Enter');
    const a = db(l.a / centre.a);
    assert(a < -20, `440 Hz only dropped ${a.toFixed(1)} dB with the LPF fully closed`);
    return `440 Hz ${a.toFixed(1)} dB`;
  });

  await test('echo and reverb effects produce real tails after the deck stops', async () => {
    await page.click('.deck-b .transport.play'); // pause B
    await setRange('.xfader', 0);
    const tail = async (fxOn, type = 'echo') => {
      await page.evaluate(([on, type]) => {
        const fx = window.spindle.app.decks[0].ch.fx;
        fx.setType(type);
        fx.setAmount(0.8);
        fx.setEnabled(on);
      }, [fxOn, type]);
      await page.waitForTimeout(400);
      const dl = page.waitForEvent('download');
      await page.evaluate(() => window.spindle.app.recorder.start('memory'));
      await page.waitForTimeout(250);
      await page.evaluate(() => window.spindle.app.decks[0].pause());
      await page.waitForTimeout(900);
      await page.evaluate(() => window.spindle.app.recorder.stop());
      const p = join(dir, `tail-${type}-${fxOn}.wav`);
      await (await dl).saveAs(p);
      const w = parseWav(readFileSync(p));
      await page.evaluate(() => window.spindle.app.decks[0].play());
      return rms(w.L.subarray(Math.round(0.6 * w.sr))); // well after the pause
    };
    const dry = await tail(false);
    const wet = await tail(true);
    const verb = await tail(true, 'reverb');
    await page.evaluate(() => window.spindle.app.decks[0].ch.fx.setEnabled(false));
    await setRange('.xfader', 0.5);
    assert(dry < 0.002, `dry tail not silent: ${dry}`);
    assert(wet > 0.01, `no echo tail: ${wet}`);
    assert(verb > 0.005, `no reverb tail: ${verb}`);
    return `tail RMS dry ${dry.toExponential(1)}, echo ${wet.toFixed(3)}, reverb ${verb.toFixed(3)}`;
  });

  await test('limiter keeps the master below full scale when everything is pushed', async () => {
    await page.evaluate(() => {
      const { app, engine } = window.spindle;
      for (const d of app.decks) {
        d.ch.setTrim(1);
        d.ch.setEq('low', 1);
        d.ch.setEq('mid', 1);
        d.ch.setEq('high', 1);
        if (!d.playing) d.play();
      }
      engine.setMasterVolume(1);
    });
    await page.waitForTimeout(300);
    const w = await record(1.0);
    let peak = 0;
    for (const v of w.L) peak = Math.max(peak, Math.abs(v));
    await page.evaluate(() => {
      const { app, engine } = window.spindle;
      for (const d of app.decks) {
        d.ch.setTrim(0.5);
        d.ch.setEq('low', 0.5);
        d.ch.setEq('mid', 0.5);
        d.ch.setEq('high', 0.5);
      }
      engine.setMasterVolume(0.85);
    });
    assert(peak < 0.999, `master peak ${peak}`);
    return `peak ${db(peak).toFixed(2)} dBFS`;
  });

  await test('beat loop (4 beats) holds the playhead inside an exact-length loop', async () => {
    await page.evaluate(() => {
      const d = window.spindle.app.decks[0];
      d.seek(10.37);
      if (!d.playing) d.play();
    });
    await page.waitForTimeout(150);
    await page.locator('.deck-a .loop', { hasText: /^4$/ }).click();
    const loop = await page.evaluate(() => window.spindle.app.decks[0].loop);
    const g = await page.evaluate(() => window.spindle.app.decks[0].grid);
    const samples = [];
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(120);
      samples.push(await page.evaluate(() => window.spindle.app.decks[0].ch.last.frame / window.spindle.engine.ctx.sampleRate));
    }
    const len = loop.end - loop.start;
    assert(Math.abs(len - (4 * 60) / 128) < 0.002, `loop length ${len}`);
    const ph = ((loop.start - g.firstBeat) / (60 / g.bpm)) % 1;
    assert(ph < 0.001 || ph > 0.999, `loop not on a grid beat: ${loop.start} (grid ${JSON.stringify(g)})`);
    assert(samples.every((s) => s >= loop.start - 0.001 && s < loop.end + 0.001), `playhead left loop: ${samples.map((s) => s.toFixed(2))}`);
    await page.locator('.deck-a .loop', { hasText: 'EXIT' }).click();
    return `loop ${loop.start.toFixed(3)}–${loop.end.toFixed(3)} s (${len.toFixed(4)} s), 25 position reports inside`;
  });

  await test('CUE: set while paused (quantised), jump back + stop while playing', async () => {
    await page.evaluate(() => {
      const d = window.spindle.app.decks[0];
      d.pause();
      d.seek(20.0);
    });
    await page.waitForTimeout(100);
    const cue = page.locator('.deck-a .transport.cue');
    await cue.dispatchEvent('pointerdown');
    await cue.dispatchEvent('pointerup');
    const set = await page.evaluate(() => window.spindle.app.decks[0].track.cue);
    const g = await page.evaluate(() => window.spindle.app.decks[0].grid);
    const beat = 60 / g.bpm;
    const expected = g.firstBeat + Math.round((20 - g.firstBeat) / beat) * beat;
    assert(Math.abs(set - expected) < 0.002, `cue ${set}, expected nearest beat ${expected}`);
    await page.click('.deck-a .transport.play');
    await page.waitForTimeout(800);
    await cue.dispatchEvent('pointerdown');
    await cue.dispatchEvent('pointerup');
    await page.waitForTimeout(150);
    const st = await page.evaluate(() => ({ p: window.spindle.app.decks[0].position(), playing: window.spindle.app.decks[0].playing }));
    assert(!st.playing && Math.abs(st.p - set) < 0.02, `after cue: ${JSON.stringify(st)}`);
    return `cue at ${set.toFixed(3)} s (beat-quantised from 20.000)`;
  });

  await test('hot cue 1 set and jump', async () => {
    await page.evaluate(() => window.spindle.app.decks[0].seek(5));
    await page.waitForTimeout(80);
    const hot = page.locator('.deck-a .hot', { hasText: '1' }).first();
    await hot.click();
    await page.evaluate(() => window.spindle.app.decks[0].seek(30));
    await hot.click();
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => ({ hc: window.spindle.app.decks[0].track.hotCues[0], p: window.spindle.app.decks[0].position(), playing: window.spindle.app.decks[0].playing }));
    assert(Math.abs(st.p - st.hc) < 0.15 && st.playing, JSON.stringify(st));
    await page.evaluate(() => window.spindle.app.decks[0].pause());
    return `hot cue 1 at ${st.hc.toFixed(3)} s`;
  });

  await test('SYNC: deck B (124) matches deck A (128) in tempo and beat phase', async () => {
    await page.evaluate(() => {
      const [a, b] = window.spindle.app.decks;
      a.seek(12.3);
      b.seek(7.77);
      a.play();
      b.play();
    });
    await page.waitForTimeout(300);
    await page.click('.deck-b .transport.sync');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const [a, b] = window.spindle.app.decks;
      const ph = (d) => {
        const x = (d.position() - d.grid.firstBeat) / (60 / d.grid.bpm);
        return x - Math.floor(x);
      };
      let diff = ph(b) - ph(a);
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      return { pitch: b.pitch, bpmB: b.bpm, bpmA: a.bpm, diff };
    });
    assert(Math.abs(r.bpmB - r.bpmA) < 0.01, `tempo mismatch ${r.bpmA} vs ${r.bpmB}`);
    assert(Math.abs(r.diff) < 0.03, `phase off by ${r.diff} beats`);
    return `B pitch ${r.pitch.toFixed(2)}% → ${r.bpmB.toFixed(2)} BPM, phase error ${(r.diff * 100).toFixed(2)}% of a beat`;
  });

  await test('unsupported / corrupt file gives an understandable error', async () => {
    await page.evaluate(() => window.spindle.app.decks.forEach((d) => d.pause()));
    await addFiles([{ name: 'broken.mp3', type: 'audio/mpeg', b64: Buffer.from('this is not audio at all').toString('base64') }]);
    await page.locator('.b-row', { hasText: 'broken' }).locator('.ld-a').click();
    await page.waitForFunction(() => window.spindle.app.decks[0].error);
    const msg = await page.$eval('.deck-a .d-status', (e) => e.textContent);
    assert(/could not be decoded/.test(msg), msg);
    await page.locator('.b-row', { hasText: 'Tone A 128' }).locator('.ld-a').click();
    await page.waitForFunction(() => window.spindle.app.decks[0].loaded && !window.spindle.app.decks[0].error);
    return msg;
  });

  await test('playlists, cues, grid and track info persist across a restart', async () => {
    await page.evaluate(async () => {
      const lib = window.spindle.lib;
      const p = await lib.createPlaylist('Warm-up');
      const ids = [...lib.tracks.values()].filter((t) => t.title.startsWith('Tone')).map((t) => t.id);
      await lib.addToPlaylist(p.id, ids);
      await lib.addToPlaylist('queue', ids.slice(0, 1));
    });
    await page.reload();
    await page.waitForFunction(() => window.spindle?.lib.tracks.size >= 2);
    const gate2 = await page.$('.gate button');
    if (gate2) await gate2.click();
    const s = await page.evaluate(() => {
      const lib = window.spindle.lib;
      const a = [...lib.tracks.values()].find((t) => t.title === 'Tone A 128');
      return {
        n: lib.tracks.size,
        bpm: a.bpm,
        cue: a.cue,
        hot: a.hotCues[0],
        pl: lib.playlists.find((p) => p.name === 'Warm-up')?.trackIds.length,
        q: lib.playlist('queue').trackIds.length,
        key: a.keyCamelot,
      };
    });
    assert(s.n === 3 && Math.abs(s.bpm - 128) < 0.1 && s.cue > 0 && s.hot > 0 && s.pl === 2 && s.q === 1, JSON.stringify(s));
    return JSON.stringify(s);
  });

  await test('session-only files are flagged “missing” after restart (not silently broken)', async () => {
    await page.waitForFunction(() => window.spindle.lib.counts().missing >= 1);
    const n = await page.evaluate(() => window.spindle.lib.counts());
    const txt = await page.$eval('.b-side', (e) => e.textContent);
    assert(/Missing files/.test(txt), 'no Missing files section');
    return JSON.stringify(n);
  });

  await test('works offline after first load (service worker)', async () => {
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => undefined);
    await page.reload(); // ensure assets were fetched through the SW
    await page.waitForFunction(() => window.spindle?.app);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.spindle?.app, null, { timeout: 15000 });
    const st = await page.evaluate(() => window.spindle.engine.ctx.state);
    await context.setOffline(false);
    return `app booted offline, audio ${st}`;
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => document.querySelector('.gate')?.remove());
  await page.screenshot({ path: join(ROOT, 'tests', 'e2e', 'last-screenshot.png') });

  await test('original-author credit is shown in the app (About + start screen)', async () => {
    await page.click('button[aria-label="Settings"]');
    await page.click('.tab:has-text("About")');
    const about = await page.$eval('dialog.settings .set-body', (e) => e.textContent);
    await page.keyboard.press('Escape');
    assert(/Created by David Blackwood/.test(about), about);
    return 'About: “Created by David Blackwood — original author and inventor”';
  });

  await test('no uncaught page errors', async () => {
    const real = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
    assert(real.length === 0, real.join('\n'));
  });

  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} E2E tests passed.\n`);
  writeFileSync(join(ROOT, 'tests', 'e2e', 'last-run.json'), JSON.stringify({ date: new Date().toISOString(), browser: exe, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Zero-dependency static server for the production build.
// Binds to 127.0.0.1 only (localhost is a "secure context", so AudioWorklet,
// Web MIDI and the File System Access API all work without HTTPS).
// Usage: node scripts/serve.mjs [dir=dist] [port=4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(root, p);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let s = await stat(file).catch(() => null);
    if (s?.isDirectory()) {
      file = join(file, 'index.html');
      s = await stat(file).catch(() => null);
    }
    if (!s) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const body = await readFile(file);
    const immutable = /\/assets\//.test(file.replaceAll('\\', '/'));
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.listen(port, host, () => {
  console.log(`Spindle DJ is running at http://localhost:${port}/  (serving ${root})`);
  console.log('Open that address in Chrome. Press Ctrl+C to stop.');
});

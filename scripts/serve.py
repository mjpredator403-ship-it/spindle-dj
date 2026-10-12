#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
"""Serve the Spindle DJ production build on http://localhost (a secure context).

Zero dependencies (Python 3.8+), so it runs in a stock ChromeOS Linux container.
Binds to 127.0.0.1 only.  Usage:  python3 scripts/serve.py [dist_dir] [port]
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "dist"))
PORT = int(sys.argv[2] if len(sys.argv) > 2 else os.environ.get("PORT", 8765))
HOST = os.environ.get("HOST", "127.0.0.1")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".map": "application/json",
    }

    def end_headers(self):
        immutable = "/assets/" in self.path
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):  # quiet
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        sys.exit(f"No build found in {ROOT}. Run 'npm run build' first (or use the prebuilt release).")
    with Server((HOST, PORT), functools.partial(Handler, directory=ROOT)) as httpd:
        print(f"Spindle DJ is running at http://localhost:{PORT}/  (serving {ROOT})", flush=True)
        print("Open that address in Chrome. Press Ctrl+C to stop.", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

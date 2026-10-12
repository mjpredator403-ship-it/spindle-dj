#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
# One-command launcher. Serves the prebuilt app on http://localhost:8765/.
#   ./run.sh          serve dist/ (builds it first if Node 20.19+ is available and dist/ is missing)
#   ./run.sh dev      hot-reload development server on http://localhost:5173/
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

have_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)'
}

if [[ "${1:-}" == "dev" ]]; then
  have_node || { echo "Node.js 20.19+ is required for dev mode. See docs/CHROMEOS.md (nvm instructions)."; exit 1; }
  [[ -d node_modules ]] || npm ci
  exec npm run dev
fi

if [[ ! -f dist/index.html ]]; then
  if have_node; then
    [[ -d node_modules ]] || npm ci
    npm run build
  else
    echo "dist/ is missing and Node.js 20.19+ is not installed."
    echo "Use the prebuilt release zip (it contains dist/), or install Node (docs/CHROMEOS.md)."
    exit 1
  fi
fi

echo "Starting Spindle DJ… open http://localhost:${PORT}/ in Chrome."
if have_node; then
  exec node scripts/serve.mjs dist "$PORT"
else
  exec python3 scripts/serve.py dist "$PORT"
fi

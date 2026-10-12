#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
# Spindle DJ - find the release zip on drive D:\, extract it, and start the app.
#
# Usage:   bash install-from-d.sh            (extract if needed, then run)
#          bash install-from-d.sh --update   (re-extract even if already installed)
# Options: ZIP_DIR=/some/path   look there instead of D:\
#          INSTALL_DIR=/path    where to extract (default: ~/spindle-dj)
#          PORT=8765            port for the local server
#
# How "D:\" appears inside bash depends on where bash is running:
#   Windows + WSL ............ /mnt/d
#   Windows + Git Bash/MSYS .. /d  (or /cygdrive/d under Cygwin)
#   ChromeOS Linux (Crostini)  /mnt/chromeos/removable/<drive label>  - the USB
#                              drive must first be shared: Files app -> right-click
#                              the drive -> "Share with Linux".
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/spindle-dj}"
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

# ---------------------------------------------------------------- find D:\
candidates=()
[[ -n "${ZIP_DIR:-}" ]] && candidates+=("$ZIP_DIR")
candidates+=("/mnt/d" "/d" "/cygdrive/d" "D:/" "/mnt/chromeos/removable/D")
# ChromeOS: any shared removable drive (label may not be "D")
if [[ -d /mnt/chromeos/removable ]]; then
  for d in /mnt/chromeos/removable/*/; do [[ -d "$d" ]] && candidates+=("${d%/}"); done
fi

ZIP=""
for dir in "${candidates[@]}"; do
  [[ -d "$dir" ]] || continue
  # newest spindle-dj-*.zip in that folder
  found="$(ls -1t "$dir"/spindle-dj-*.zip 2>/dev/null | head -n 1 || true)"
  if [[ -n "$found" ]]; then ZIP="$found"; break; fi
done

if [[ -z "$ZIP" ]]; then
  echo "Could not find spindle-dj-*.zip on drive D:."
  echo "Looked in: ${candidates[*]}"
  echo
  echo "Fixes:"
  echo "  - ChromeOS: in the Files app, right-click the drive -> 'Share with Linux', then run again."
  echo "  - Or point to the folder directly:  ZIP_DIR=/path/to/folder bash install-from-d.sh"
  exit 1
fi
echo "Found: $ZIP"

# ---------------------------------------------------------------- extract
if [[ $UPDATE -eq 1 || ! -f "$INSTALL_DIR/run.sh" ]]; then
  echo "Extracting to $INSTALL_DIR ..."
  tmp="$(mktemp -d)"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$ZIP" -d "$tmp"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ZIP" "$tmp"
  else
    echo "Need 'unzip' or 'python3'. On Debian/ChromeOS: sudo apt-get install -y unzip python3"
    exit 1
  fi
  [[ -f "$tmp/spindle-dj/run.sh" ]] || { echo "That zip does not look like a Spindle DJ release."; rm -rf "$tmp"; exit 1; }
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$tmp/spindle-dj" "$INSTALL_DIR"
  rm -rf "$tmp"
  chmod +x "$INSTALL_DIR/run.sh" "$INSTALL_DIR/scripts/serve.py" 2>/dev/null || true
else
  echo "Already installed in $INSTALL_DIR (use --update to re-extract)."
fi

# ---------------------------------------------------------------- run
cd "$INSTALL_DIR"
exec bash ./run.sh

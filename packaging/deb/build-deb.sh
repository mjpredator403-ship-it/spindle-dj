#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
# Build a Debian/Ubuntu/Crostini package: spindle-dj_<version>_all.deb
# Contents: the static web app + a tiny localhost server (python3) + a launcher
# that opens it in the default browser + a desktop menu entry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(node -p 'require("./package.json").version' 2>/dev/null || python3 -c 'import json;print(json.load(open("package.json"))["version"])')"
[[ -f dist/index.html ]] || { echo "Run 'npm run build' first."; exit 1; }

STAGE="$(mktemp -d)"
PKG="$STAGE/spindle-dj_${VERSION}_all"
mkdir -p "$PKG/DEBIAN" "$PKG/usr/share/spindle-dj" "$PKG/usr/bin" "$PKG/usr/share/applications" \
         "$PKG/usr/share/icons/hicolor/scalable/apps" "$PKG/usr/share/doc/spindle-dj"

cp -r dist "$PKG/usr/share/spindle-dj/web"
find "$PKG/usr/share/spindle-dj/web" -name '*.map' -delete
cp scripts/serve.py "$PKG/usr/share/spindle-dj/serve.py"
cp public/icon.svg "$PKG/usr/share/icons/hicolor/scalable/apps/spindle-dj.svg"
cp README.md PRIVACY.md THIRD_PARTY_NOTICES.md AUTHORS.md NOTICE "$PKG/usr/share/doc/spindle-dj/"
cp LICENSE "$PKG/usr/share/doc/spindle-dj/copyright"

cat > "$PKG/usr/bin/spindle-dj" <<'EOF'
#!/usr/bin/env bash
# Starts the local Spindle DJ server (if not already running) and opens it.
PORT="${SPINDLE_PORT:-8765}"
URL="http://localhost:${PORT}/"
if ! (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
  nohup python3 /usr/share/spindle-dj/serve.py /usr/share/spindle-dj/web "$PORT" >/tmp/spindle-dj.log 2>&1 &
  for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && break; sleep 0.1; done
fi
echo "Spindle DJ: ${URL}"
if [[ "${1:-}" != "--no-browser" ]]; then
  # ChromeOS (Crostini): garcon forwards xdg-open to the ChromeOS Chrome browser.
  xdg-open "$URL" >/dev/null 2>&1 || sensible-browser "$URL" >/dev/null 2>&1 || echo "Open ${URL} in Chrome."
fi
EOF
chmod 755 "$PKG/usr/bin/spindle-dj"

cat > "$PKG/usr/share/applications/spindle-dj.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Spindle DJ
GenericName=DJ Mixer
Comment=Free, open-source two-deck DJ mixer
Exec=spindle-dj
Icon=spindle-dj
Terminal=false
Categories=AudioVideo;Audio;Mixer;
Keywords=dj;mixer;music;bpm;
EOF

SIZE_KB="$(du -sk "$PKG/usr" | cut -f1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: spindle-dj
Version: ${VERSION}
Section: sound
Priority: optional
Architecture: all
Depends: python3 (>= 3.8), xdg-utils
Installed-Size: ${SIZE_KB}
Maintainer: David Blackwood <noreply@users.noreply.github.com>
Homepage: https://github.com/mjpredator403-ship-it/spindle-dj
Description: Free, open-source two-deck DJ mixer (runs in Chrome)
 Spindle DJ is a two-deck DJ mixing application with BPM/key analysis,
 beat sync, cue points, loops, 3-band isolator EQ, filter and effects,
 recording, a music library with playlists, keyboard shortcuts and MIDI
 controller mapping. The audio engine runs in the browser (Web Audio +
 AudioWorklet); this package serves it on http://localhost and opens it.
EOF

mkdir -p release
dpkg-deb --root-owner-group --build "$PKG" "release/spindle-dj_${VERSION}_all.deb"
rm -rf "$STAGE"
echo "Built release/spindle-dj_${VERSION}_all.deb"

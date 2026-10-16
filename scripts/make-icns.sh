#!/usr/bin/env bash
# Turn the master PNG (build/icon.png) into build/icon.icns using macOS's own
# sips + iconutil — no third-party image tooling required.
set -euo pipefail
cd "$(dirname "$0")/.."

MASTER="build/icon.png"
ICONSET="build/icon.iconset"

if [ ! -f "$MASTER" ]; then
  echo "Missing $MASTER — generate it first:  npx electron scripts/render-icon.cjs" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# size:filename pairs required by iconutil.
while IFS=: read -r px name; do
  [ -n "$px" ] || continue
  sips -z "$px" "$px" "$MASTER" --out "$ICONSET/$name.png" >/dev/null
done <<'SIZES'
16:icon_16x16
32:icon_16x16@2x
32:icon_32x32
64:icon_32x32@2x
128:icon_128x128
256:icon_128x128@2x
256:icon_256x256
512:icon_256x256@2x
512:icon_512x512
1024:icon_512x512@2x
SIZES

iconutil -c icns "$ICONSET" -o build/icon.icns
rm -rf "$ICONSET"
echo "wrote build/icon.icns"

#!/usr/bin/env bash
# Renders apps/desktop/build/icon.svg into icon.png (1024) and icon.icns, and copies the SVG to
# apps/ui/public/icon.svg (favicon and brand mark of the renderer). The generated files are
# committed, so a normal build needs none of this. Run it after changing icon.svg.
#
# Needs macOS (sips, iconutil) and Google Chrome (headless, for the SVG render with transparency).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="$here/build"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$chrome" ] || { echo "Chrome not found at $chrome (set CHROME)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
iconset="$work/icon.iconset"
mkdir -p "$iconset"

"$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=1024,1024 --screenshot="$build/icon.png" "file://$build/icon.svg" >/dev/null 2>&1
[ -s "$build/icon.png" ] || { echo "render failed" >&2; exit 1; }

# iconutil wants icon_<n>x<n>.png and icon_<n>x<n>@2x.png; each file comes from the 1024 render
for n in 16 32 128 256 512; do
  sips -z "$n" "$n" "$build/icon.png" --out "$iconset/icon_${n}x${n}.png" >/dev/null
  sips -z "$((n * 2))" "$((n * 2))" "$build/icon.png" --out "$iconset/icon_${n}x${n}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$build/icon.icns"
cp "$build/icon.svg" "$here/../ui/public/icon.svg"
echo "wrote $build/icon.png and $build/icon.icns"

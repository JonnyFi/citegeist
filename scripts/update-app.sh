#!/bin/sh
# Pull the latest main, build citegeist.app and replace the copy in /Applications.
# Usage: pnpm app:update   (run from any checkout of the repo)
set -e
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "update-app: this checkout has uncommitted changes; commit or discard them first." >&2
  exit 1
fi
git checkout main
git pull --ff-only origin main
pnpm install
pnpm package
osascript -e 'tell application "citegeist" to quit' >/dev/null 2>&1 || true
sleep 2
rm -rf /Applications/citegeist.app
ditto apps/desktop/dist/mac-arm64/citegeist.app /Applications/citegeist.app
echo "update-app: /Applications/citegeist.app is now at $(git rev-parse --short HEAD)"
open /Applications/citegeist.app

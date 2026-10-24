#!/bin/sh
# Pull the latest main, build citegeist.app and replace the copy in /Applications.
# Usage: pnpm app:update   (run from any checkout or worktree of the repo)
# When main is checked out in another worktree, the update runs there, because git refuses to
# check out a branch that another worktree holds.
set -e
cd "$(dirname "$0")/.."

# Prints the path of the worktree that has refs/heads/main checked out, if there is one.
main_worktree() {
  git worktree list --porcelain | awk '
    $1 == "worktree" { sub(/^worktree /, ""); path = $0 }
    $1 == "branch" && $2 == "refs/heads/main" { print path; exit }
  '
}

if [ "${1:-}" = "--print-main-worktree" ]; then
  main_worktree
  exit 0
fi

holder="$(main_worktree)"
if [ -n "$holder" ] && [ "$holder" != "$(pwd -P)" ]; then
  echo "update-app: main is checked out in $holder, updating there."
  cd "$holder"
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "update-app: $(pwd) has uncommitted changes; commit or discard them first." >&2
  exit 1
fi
if [ -z "$holder" ]; then
  git checkout main
fi
git pull --ff-only origin main
pnpm install
pnpm package
osascript -e 'tell application "citegeist" to quit' >/dev/null 2>&1 || true
sleep 2
rm -rf /Applications/citegeist.app
ditto apps/desktop/dist/mac-arm64/citegeist.app /Applications/citegeist.app
echo "update-app: /Applications/citegeist.app is now at $(git rev-parse --short HEAD)"
open /Applications/citegeist.app

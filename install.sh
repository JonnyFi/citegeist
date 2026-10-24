#!/bin/sh
# Installs the latest citegeist release on macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh
#
# The app is ad-hoc signed and not notarized. A file that curl downloads carries no
# com.apple.quarantine attribute, so Gatekeeper does not block it. The same script runs from the
# in-app update notice. It never installs uv or the agent CLIs, it only says how.
#
# Overrides (for tests): CITEGEIST_RELEASE_API, CITEGEIST_INSTALL_DIR.
set -eu

REPO="JonnyFi/citegeist"
API="${CITEGEIST_RELEASE_API:-https://api.github.com/repos/$REPO/releases/latest}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'install: %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "citegeist runs on macOS only."
if [ "$(uname -m)" != "arm64" ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" != "1" ]; then
  fail "citegeist needs a Mac with Apple Silicon (arm64)."
fi
command -v curl >/dev/null 2>&1 || fail "curl is required."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/citegeist-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

# Release ------------------------------------------------------------------------------------

say "Looking up the latest citegeist release ..."
curl -fsSL -H "Accept: application/vnd.github+json" -o "$WORK/release.json" "$API" ||
  fail "could not read $API. Is there a published release, and is the repository public?"
# One field per line, so this works for compact and pretty-printed JSON alike.
tr ',' '\n' <"$WORK/release.json" >"$WORK/fields"
TAG="$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' "$WORK/fields" | head -n 1)"
sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p' "$WORK/fields" >"$WORK/urls"
ZIP_URL="$(grep -E 'citegeist-.*-arm64\.zip$' "$WORK/urls" | head -n 1 || true)"
SHA_URL="$(grep -E 'citegeist-.*-arm64\.zip\.sha256$' "$WORK/urls" | head -n 1 || true)"
[ -n "$TAG" ] && [ -n "$ZIP_URL" ] && [ -n "$SHA_URL" ] ||
  fail "the latest release has no citegeist arm64 zip with a sha256 file."

say "Downloading citegeist $TAG ..."
curl -fSL --progress-bar -o "$WORK/citegeist.zip" "$ZIP_URL" || fail "download failed: $ZIP_URL"
curl -fsSL -o "$WORK/citegeist.zip.sha256" "$SHA_URL" || fail "download failed: $SHA_URL"

EXPECTED="$(awk '{print $1}' "$WORK/citegeist.zip.sha256" | head -n 1)"
ACTUAL="$(shasum -a 256 "$WORK/citegeist.zip" | awk '{print $1}')"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] ||
  fail "sha256 mismatch (expected $EXPECTED, got $ACTUAL). Nothing was installed."
say "sha256 verified."

ditto -x -k "$WORK/citegeist.zip" "$WORK/unpacked"
[ -d "$WORK/unpacked/citegeist.app" ] || fail "the zip does not contain citegeist.app."

# Install ------------------------------------------------------------------------------------

if [ -n "${CITEGEIST_INSTALL_DIR:-}" ]; then
  DEST_DIR="$CITEGEIST_INSTALL_DIR"
elif [ -w /Applications ]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
fi
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/citegeist.app"

if pgrep -f "citegeist.app/Contents/MacOS/" >/dev/null 2>&1; then
  say "Quitting the running citegeist ..."
  osascript -e 'tell application "citegeist" to quit' >/dev/null 2>&1 || true
  i=0
  while pgrep -f "citegeist.app/Contents/MacOS/" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 20 ] || fail "citegeist did not quit. Quit it and run the installer again."
    sleep 1
  done
fi

say "Installing to $DEST ..."
ditto "$WORK/unpacked/citegeist.app" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
# curl sets no quarantine attribute; this only makes sure no other path left one behind.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

say "citegeist $TAG is installed."

# Requirements that citegeist does not install ---------------------------------------------------

has() {
  command -v "$1" >/dev/null 2>&1 && return 0
  for dir in "$HOME/.local/bin" "$HOME/.claude/local" /opt/homebrew/bin /usr/local/bin "$HOME/.cursor/bin"; do
    [ -x "$dir/$1" ] && return 0
  done
  return 1
}

if ! has uv; then
  say ""
  say "Missing: uv (builds the Python environment for PDF conversion)."
  say "  brew install uv"
  say "  or: curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

if ! has claude && ! has codex && ! has cursor-agent && ! has agent; then
  say ""
  say "Missing: an agent CLI for the chat. Install at least one and log in:"
  say "  Claude Code:  npm install -g @anthropic-ai/claude-code   then: claude auth login"
  say "  Codex:        npm install -g @openai/codex               then: codex login"
  say "  Cursor:       curl https://cursor.com/install -fsS | bash  then: cursor-agent login"
fi

open "$DEST"

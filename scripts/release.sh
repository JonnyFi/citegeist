#!/bin/sh
# Builds citegeist.app locally and publishes it as a GitHub release.
#
#   pnpm release            build, zip, checksum, create the release
#   pnpm release --dry-run  run every check and print what would happen
#
# The version comes from apps/desktop/package.json (what app.getVersion() reports). Releases are
# built on this machine on purpose: GitHub Actions minutes are off limits. install.sh downloads
# the zip and verifies the checksum file.
set -eu

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *)
      echo "release: unknown argument $arg (only --dry-run exists)." >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "release: $*" >&2
  exit 1
}

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./apps/desktop/package.json').version")"
TAG="v$VERSION"
NAME="citegeist-$VERSION-arm64"
APP="apps/desktop/dist/mac-arm64/citegeist.app"
OUT="apps/desktop/dist/release"
ZIP="$OUT/$NAME.zip"
SUM="$ZIP.sha256"

[ -z "$(git status --porcelain)" ] ||
  fail "the working tree is dirty. Commit or discard your changes first."
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "the tag $TAG exists locally. Bump the version in apps/desktop/package.json."
fi
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "the tag $TAG exists on origin. Bump the version in apps/desktop/package.json."
fi
command -v gh >/dev/null 2>&1 || fail "the GitHub CLI (gh) is required."
gh auth status >/dev/null 2>&1 || fail "gh is not logged in. Run: gh auth login"
HEAD_SHA="$(git rev-parse HEAD)"
[ -n "$(git branch -r --contains "$HEAD_SHA")" ] ||
  fail "HEAD $HEAD_SHA is not on origin. Push it first, the release tag points at it."

if [ "$DRY" -eq 1 ]; then
  echo "release (dry run): checks passed. It would:"
  echo "  1. pnpm package"
  echo "  2. ditto -c -k --keepParent $APP $ZIP"
  echo "  3. write $SUM (sha256)"
  echo "  4. gh release create $TAG --target $HEAD_SHA $ZIP $SUM"
  exit 0
fi

pnpm package
[ -d "$APP" ] || fail "pnpm package did not produce $APP."

rm -rf "$OUT"
mkdir -p "$OUT"
ditto -c -k --keepParent "$APP" "$ZIP"
(cd "$OUT" && shasum -a 256 "$NAME.zip" >"$NAME.zip.sha256")
echo "release: $(cat "$SUM")"

gh release create "$TAG" "$ZIP" "$SUM" \
  --target "$HEAD_SHA" \
  --title "citegeist $VERSION" \
  --generate-notes
echo "release: $TAG is published."

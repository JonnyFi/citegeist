#!/bin/sh
# Builds the unsigned-for-Gatekeeper arm64 app. Signs with the self-signed identity
# "citegeist local signing" when the login keychain has it (see scripts/make-signing-cert.sh), else
# ad hoc. A stable identity keeps the code signature the same across builds, so macOS keeps the
# Accessibility grant and keychain access after an update. CITEGEIST_SIGNING_IDENTITY overrides,
# "-" forces ad hoc. Run from apps/desktop (pnpm package does that).
set -eu
IDENTITY_NAME="citegeist local signing"
identity="${CITEGEIST_SIGNING_IDENTITY:-}"
if [ -z "$identity" ]; then
  if security find-identity -v -p codesigning 2>/dev/null | grep -q "\"$IDENTITY_NAME\""; then
    identity="$IDENTITY_NAME"
  else
    identity="-"
  fi
fi
if [ "$identity" = "-" ]; then
  echo "package-mac: ad-hoc signature (run scripts/make-signing-cert.sh for a stable one)"
else
  echo "package-mac: signing with \"$identity\""
fi
exec electron-builder --config electron-builder.yml --mac dir --arm64 -c.mac.identity="$identity"

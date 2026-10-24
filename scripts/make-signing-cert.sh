#!/bin/sh
# Creates the self-signed code signing identity "citegeist local signing" in the login keychain,
# once. scripts/package-mac.sh signs with it, so the code signature of citegeist stays the same
# across builds and macOS keeps the Accessibility grant after an update. It is not a Developer ID:
# Gatekeeper still relies on the curl install path. Run it yourself; macOS asks for your login
# password to trust the certificate. On the first build after this, macOS asks once whether codesign
# may use the key: enter the password and choose "Immer erlauben".
set -eu
NAME="citegeist local signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "make-signing-cert: \"$NAME\" exists already."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat >"$WORK/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$WORK/cert.cnf" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
PASS="$(/usr/bin/openssl rand -hex 16)"
/usr/bin/openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" \
  -passout "pass:$PASS" -out "$WORK/id.p12"
security import "$WORK/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"
security find-identity -v -p codesigning | grep "\"$NAME\""
echo "make-signing-cert: created \"$NAME\". The next build asks once for the key: choose \"Immer erlauben\"."

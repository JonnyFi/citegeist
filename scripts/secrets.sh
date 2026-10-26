#!/bin/sh
# Scans the working tree for secrets with gitleaks (config: .gitleaks.toml).
# Skips with a hint when gitleaks is not installed: brew install gitleaks
set -e
cd "$(dirname "$0")/.."
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "secrets: gitleaks is not installed, skipping (brew install gitleaks)" >&2
  exit 0
fi
exec gitleaks dir --redact --no-banner --config .gitleaks.toml .

# ADR 0011: Electron and Python worker

Status: accepted. Date: 2026-10-23.

## Context

The UI needs a desktop shell on macOS. Document conversion relies on Python tools (Docling, GROBID, OCR) that have no equivalent in TypeScript.

## Decision

The shell is Electron (`apps/desktop`). Conversion runs in a Python worker managed with uv (`workers/convert`).

## Consequences

The core is TypeScript on Node, and Python runs as a separate worker process. Both parts are tested on their own (`pnpm test` and `uv run pytest`).

# ADR 0004: Conversion scope

Status: accepted. Date: 2026-10-23.

## Context

Most scientific PDFs already contain a text layer. Scans and scanned book chapters need OCR. Grey literature and web articles are common sources as well.

## Decision

Version 1 converts digital PDFs, arXiv HTML, web articles and scans. OCR runs locally on the Mac and costs nothing.

## Consequences

Conversion runs in a Python worker (`workers/convert`, see [ADR 0011](0011-electron-and-python-worker.md)), and every converted document becomes a block model ([ADR 0009](0009-block-model.md)).

# ADR 0003: Importers

Status: accepted. Date: 2026-10-23.

## Context

Many new users come from Zotero, Mendeley, Paperpile, EndNote or Citavi and bring an existing collection. The maintainer started without a reference manager, so importers are not needed for the first usable state.

## Decision

citegeist imports from Zotero and from BibTeX, RIS and CSL-JSON files. The Zotero import reads the local Zotero API on 127.0.0.1.

## Consequences

Importers live in `packages/import`. They rank below the first usable state and do not depend on each other.

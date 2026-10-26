# ADR 0017: Outline and section files

Status: accepted. Date: 2026-10-24.

## Context

A research plan has chapters and sections. A document for every section would produce many empty files.

## Decision

Chapters and sections are nodes of the outline in `outline.yaml`. Every chapter has its own document. A section gets a document only once it carries claims or sources. Until then its insights stand in the document of the chapter. The planning model is specified in [docs/spec/research-planning.md](../spec/research-planning.md).

## Consequences

The document of a chapter holds the early insights of its sections.

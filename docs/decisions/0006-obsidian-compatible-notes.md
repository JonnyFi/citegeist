# ADR 0006: Obsidian-compatible notes

Status: accepted. Date: 2026-10-23.

## Context

Obsidian demands a lot of manual work to keep notes and links in order. citegeist and its agents are meant to take that work over.

## Decision

Notes are Markdown files with YAML frontmatter and wiki links. The library folder is also a valid Obsidian vault. Typed connections between papers and notes are stored in the frontmatter in a machine-readable form.

## Consequences

Compatibility costs nothing and prevents lock-in.

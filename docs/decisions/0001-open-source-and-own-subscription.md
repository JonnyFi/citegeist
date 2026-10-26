# ADR 0001: Open source and own subscription

Status: accepted. Date: 2026-10-23.

## Context

citegeist started as a tool for its maintainer and is built so that an open source release needs no rework. Some useful components are licensed under the AGPL (for example Zotero's translation-server).

## Decision

- The core carries a permissive license (Apache-2.0).
- AGPL components run as a separate process behind a local HTTP interface. The separation costs development time once and no running fees.
- AI features call the official CLIs of Claude Code, Codex or Cursor, in which each user is logged in with their own subscription.
- API keys (Anthropic, OpenAI, OpenRouter, xAI) and local models are additional options that can be chosen per task.

## Consequences

Every user brings their own AI subscription, so the project carries no inference costs. Components with copyleft licenses stay out of the core process.

# ADR 0016: Language of AI texts

Status: accepted. Date: 2026-10-23.

## Context

Sources and writing projects come in different languages, and a user may read an English source for a German project.

## Decision

Each project has a language setting. In the reader, a dropdown at the source currently being read overrides the project setting for that source at any time. Without a project, a library default applies.

## Consequences

Tasks that write text, such as card paraphrases ([ADR 0010](0010-quote-cards.md)) and concept entries ([ADR 0021](0021-concept-register.md)), resolve their language by this order.

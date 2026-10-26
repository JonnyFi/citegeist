# ADR 0010: Quote cards

Status: accepted. Date: 2026-10-23, amended 2026-10-24.

## Context

A quote card is the unit in which a passage from a source enters the library. The first version carried several AI texts (paraphrase, core statement), a fixed kind and two free fields. The amendments of 2026-10-24 reduce this.

## Decision

- Each card is a single Markdown file with a double anchor (PDF and text). The wording stays unchanged and every paraphrase carries its origin. What gets exported is a project setting.
- A card carries exactly one AI text, the paraphrase: one to three sentences in the resolved language ([ADR 0016](0016-ai-text-language.md)). The core statement is gone from the task `card.paraphrase`, from the interface and from new cards. On old cards a stored "Core statement" section and the `core` stamp survive a rewrite of the file, are shown nowhere and are not searched.
- The kind is optional. The kinds are `thesis`, `finding`, `method`, `definition`, `example` and `critique`. The request that writes the paraphrase also proposes a kind, the user can change it at any time, and a kind set by the user survives a new paraphrase. When old cards are read, `quote` and `comment` map to no kind. A card without a kind uses the neutral card color.
- One free field `## Note` replaces "In my words" and "Comment". Old cards with both sections are merged when read (own words, blank line, comment), and the file changes when the card is next written.
- The export rule `own-else-ai` uses the note for paraphrased citations if one exists, otherwise the paraphrase. The copy actions are "Quote verbatim" and "Quote indirectly" (a "cf." reference with paraphrase or note).

## Consequences

Old cards stay readable. Model, time and language of the paraphrase appear in a tooltip, and rewriting and language choice are a small action in the paraphrase block.

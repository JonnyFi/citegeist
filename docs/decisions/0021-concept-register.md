# ADR 0021: Concept register

Status: accepted. Date: 2026-10-24.

## Context

Concepts that recur across sources need one place where each source's use of the concept is recorded and backed by evidence.

## Decision

- A concept is a note of type `concept` in `notes/concepts/<slug>.md`, Obsidian-compatible, with the names of the concept under `aliases`. The frontmatter lists the concept's cards (`cards`) and one entry per source (`usages`). The body is derived: the user's own text, then a marked block that is regenerated on every write, with a section `## [[citekey]]` per source, supporting quotes and `[[c_...]]` links to the cards.
- Names count as equal when they differ only in case, accents, umlaut spelling (ä or ae) or punctuation. A new concept whose name or alias belongs to an existing concept extends it. If the names belong to two different concepts, creation aborts with a pointer to `concepts.merge`. Merging turns titles and aliases of the other concepts into aliases of the target, joins the cards, rewrites links and removes the other files. Renaming keeps the old title as an alias.
- An entry is written by the task `concept.describe` in the library language ([ADR 0016](0016-ai-text-language.md)). It sees only the quotes of this source's cards assigned to the concept. Each supporting quote is checked against the stored card text (the same normalization as the literature matrix), the card text is stored, and the page comes from the card. An entry without a remaining quote is dropped. An entry remembers its cards and counts as outdated when the card set of the source changes.
- Suggestions come from cards of kind `definition` (the task `concept.name` names the defined term, which must occur in the quote or paraphrase) and from words that recur in at least two sources (counted from cards and notes without a model). Nothing is created without the user.

## Consequences

The folder separates concepts from notes, and wiki links still resolve by file name, so a concept name is never also a note name. Agents reach concepts through `cg concepts ...` ([ADR 0007](0007-core-process-and-operations.md)) and, in the chat sidebar, through its shell ([ADR 0020](0020-chat-agents-use-the-users-environment.md)).

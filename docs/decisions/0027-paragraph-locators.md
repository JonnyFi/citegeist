# ADR 0027: Paragraph locators for unpaginated sources

Status: accepted. Date: 2026-10-26.

## Context

A web page, an HTML file or an EPUB has no pages. Cards of such a source showed a page anyway ("S. 1"), citations came out as "(Williams & Srnicek, 2013, S. 1)", and the reader asked to check page numbers that do not exist. Academic practice cites a paragraph (APA 7: "para. 4") or a section for such sources, and some styles omit the locator.

## Decision

- A source is unpaginated when its conversion has no printed page labels and no PDF pages. The core derives this from the source kind, the manifest and `pages.json` ([library format](../spec/library-format.md), "Unpaginated sources").
- A card of an unpaginated source carries `locator: {label: paragraph, start, end?}`. The paragraph counts the text blocks (paragraph, list item, quote) in reading order from 1, without headings. The existing `Locator` schema already allows any CSL label, so the schema does not change.
- Citations pass the label to the CSL processor. The style decides the output. The three bundled styles render "para. 4" (English) and "Abs. 4" (German), see `packages/cite/src/render.test.ts`. Pandoc citations use the term of the locale: `[@key, para. 4]`, `[@key, Abs. 4]`.
- Older cards with no locator or the placeholder page 1 are migrated when they are read. The file changes only when the card is saved.
- `documents.assets` reports `paginated`. The reader shows the page number check only for paginated sources.

## Consequences

- Matrix evidence and concept cards keep printed pages only; they show no page for a paragraph locator.
- A paragraph number depends on the block order of the conversion. The block id stays the stable anchor, the number is a citation aid.
- A style that omits locators for unpaginated sources needs no code: CSL defines it.

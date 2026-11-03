# ADR 0034: Highlights are quote cards without AI

Status: accepted. Date: 2026-11-03.

## Context

Every selection in the reader created a quote card and started an AI job for the paraphrase and the kind. A reader who wants to mark a passage while reading, in a colour of their own, with a tag or a short note, had to wait for the AI or accept a card they did not ask for. The card file already had the fields for it: `tags`, a `color` that nothing used, and the section `## Note` ([ADR 0010](0010-quote-cards.md)).

## Decision

- A highlight is a card with `ai: false`. It has the same file, the same anchors, the same note, tags, locator, export and search as any card, so there is no second data model. `cards.regenerate` ("Create paraphrase" in the card) turns it into a full quote card at any time and keeps colour, tags and note.
- The colour is one of four fixed values, `CardColor` = `yellow | green | blue | red`. The field `color` of a card file reads any other value (an older free CSS colour) as no colour, the way a retired kind reads as no kind, and drops it when the card is next saved. A card without a colour keeps the colour of its kind. The palette is fixed so that a colour means the same on every screen and contrast holds in light and dark; the tokens `--hl-<name>` (solid, for dots and card tabs) and `--hl-<name>-fill` (translucent, for the marker) are in `apps/ui/src/styles.css`, and a test keeps text on every fill at 4.5:1 or better.
- `cards.create` takes `color` and `note`. `cards.update` takes `patch.color`, and `null` removes it. `search.query` reports `color` and `tags` on card hits. The tags of a card were already part of its search text.
- `cards.delete { id }` moves the card file to `<library>/.trash/card-<id>-<stamp>/` with a `trashed.json`, as `notes.trash` does, and `cards.restore { id }` puts it back (the app offers it as undo). Only a person may delete a card. The call is refused, with the references named in the error, while a typed link or a note points at the card or a typed link starts at it.
- No MCP tool is added. The tool list is at its limit of 20. `create_card` takes `color`, `note` and `ai` because its input is the contract of `cards.create`; delete and restore are for the app and `cg`.
- In the reader, the selection popover is one row of four colour dots and the existing "Quote" action. A click on a dot, or the key 1 to 4 while text is selected, creates the highlight at once. The new card opens in the card column with the cursor in its note field; tags and colour are edited there. A highlight is drawn as a filled marker in its colour in the PDF and the text view, every other card as an underline in the colour of its kind. The card column filters by colour (a chip for each colour in use) and by tag (a menu with the tags of the item), and the filters combine. The disabled placeholders "Explain" and "Link to note" are gone from the popover until they do something.

## Consequences

A highlight costs no AI call, so it works without a backend. Because a highlight is a card, it counts in exports and in the graph like any card, and an item with many highlights has many cards. Reverting the change leaves the files valid: the colour is ignored by older readers of the schema. A card that something links to cannot be deleted from the app until the link is removed; that is deliberate, and the error says which link it is.

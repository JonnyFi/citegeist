# ADR 0032: The inbox is explicit

Status: accepted. Date: 2026-10-27. Refines [ADR 0014](0014-agent-content-goes-to-inbox.md).

## Context

An inbox item is a normal item under `items/` with the frontmatter marker `inbox`. Accepting removes the marker. Three problems showed up in use:

- The item view showed an inbox item like a library item: breadcrumb "Bibliothek", "Löschen", "Lesen beginnen", and only a small "Inbox" chip.
- The core cleared the marker without an explicit accept when a human added the same work again, when a new file repaired the item, and when a converted PDF was merged into it. Whoever added a DOI to check for it accepted the agent's proposal by accident.
- A work held by an inbox item and by a library item could not be brought together. Adding the DOI of one to the other failed with `IDENTIFIER_IN_USE`.

## Decision

- The structure stays: one item folder, one marker.
- Only `inbox.accept` accepts. A duplicate add, a repair by a file and a merge after conversion leave the item in the inbox. `items.add` answers with `inInbox: true`, the job message says "already in the inbox", and the merge result names `inInbox`. The app says "Liegt in der Inbox" and offers "Annehmen"; an agent tells the user.
- The item view shows an inbox item as one. The breadcrumb reads "Inbox / title" and links back to the inbox. A banner names who suggested the item and why, with "Annehmen" and "Verwerfen". The "Inbox" chip, "Löschen" and "Lesen beginnen" are gone for inbox items. After "Annehmen" the view switches to the library form in place.
- A person who sets an identifier (`items.add` with a citekey, `items.resolve` with an identifier, a DOI or ISBN in `items.update`) that an item on the other side of the inbox boundary holds gets `IDENTIFIER_IN_INBOX`, with the two items in `context.merge`. The app offers one click: "Zusammenführen mit dem Inbox-Eintrag <citekey>", or, when the open item is the inbox one, the merge into the library item. Agents and two items on the same side keep `IDENTIFIER_IN_USE`.
- `items.merge { from, into }` takes an inbox item into another item. Only a person may call it. Sources move to the target and are converted there. Empty fields are filled from the inbox item; a field edited by a person or an agent, or without provenance, stays. A field the target only guessed (file name, page, first page) is replaced by a better one. Tags and projects are united. The inbox item goes to the library trash and `items.restore` brings it back. One finished job records the merge (`merged the inbox item X into Y`). An inbox item that cards or links refer to is not merged.
- Library views show accepted items only. `items.list` and `search.query` leave inbox items out by default. `items.list` takes `inbox: true` for the inbox alone and `includeInbox: true` for both; `search.query` takes `includeInbox`. The library list has the filter "Inklusive Inbox" and marks inbox rows. Project reading lists use the library filter. The project graph never drew inbox items. Resolving a citekey (the citation palette, the texts, wiki links) does not count as a library view and still sees inbox items.
- Search by an agent defaults to `includeInbox: true`, so an agent finds its own proposals. Hits from the inbox carry `inbox: true`.

## Consequences

Callers of `items.list` without a filter, such as `cg items list`, no longer see inbox items; `cg items list --includeInbox` does. Adding a work again is safe: it never changes the decision a person has not made yet.

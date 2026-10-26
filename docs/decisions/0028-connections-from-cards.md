# ADR 0028: Connections from cards

Status: accepted. Date: 2026-10-26.

## Context

Typed links ([ADR 0006](0006-obsidian-compatible-notes.md)) start at notes. A reader who marks a passage in one source and wants to say that it contradicts another source has to open a note first. The moment of use is the card.

## Decision

- A connection that starts at a card is a typed link in the literature note of the card's item: the note of type `literature` whose body has the line `Item: [[citekey]]`, the shape of the Zotero import. The core creates this note when it does not exist. The link carries `from: c_...` and `evidence: "[[c_...]]"`, and its target is an item, a card or a note. No new file kind exists, so the link rules for notes (`by`, `status`, rejected links as memory) apply unchanged.
- `links.create` takes a note id or a card id as `from`, and so does the MCP tool `link`. `links.remove` deletes a link from either, `links.forCard` and `links.forItem` list the links that start at cards, and `links.suggest` starts a suggestion run. Accepting and rejecting use `links.decide`. The MCP tool list stays at its cap.
- The index writes a link with `from` as an edge that starts at the card, so the graph, the connections panel and the backlinks of the target show the card and not the literature note.
- A suggestion arises when a card is created or its paraphrase arrives. A string match over the library finds sources whose citekey or whole main title occurs in the card text, or whose first author's family name occurs (capitalized as in the library) together with a second sign: the given name, a distinctive title word or the year. Only when the match finds something does the task `card.suggestLinks` choose the relation and a short reason, and it may suggest nothing. A card gets at most two open suggestions. They are stored as links with `status: proposed`, and a rejected one stays in the file, so the same target is not proposed again for that card. Nothing becomes a connection without the user's accept.
- The card stays as compact as before. The actions sit in a menu in the existing action bar, and the card shows one line for connections and one for a suggestion only when they exist.

## Consequences

Every card link lives in a note that Obsidian and agents can read. A library without Zotero notes gets `notes/reading-notes-<citekey>.md` the first time a card is connected. Removing the literature note removes the connections of its cards.

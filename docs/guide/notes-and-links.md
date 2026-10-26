# Notes and links

## Notes

The "Notes" screen lists the Markdown files in `notes/`. A note has a title, a type and a body. The types are permanent note, literature note, question, claim, project note and daily note. The body supports wiki links:

- `[[luhmann1984soziale]]` links to a source. The literature note of an item has the same name as its citekey, so the link resolves the same way in citegeist and in Obsidian.
- `[[luhmann1984soziale#^b7f3k2q]]` links to a paragraph of the converted full text.
- `![[c_01JB8Z3Q]]` embeds a quote card.
- `[[another-note]]` links to a note.

Typing `[[` in the editor opens a list of sources, cards and notes. The editor saves as you type. The library folder is a valid Obsidian vault, so you can edit the same files there. An agent can edit note bodies directly in the files, and citegeist indexes the change when the file watcher sees it.

Each source also has a literature note on its overview tab.

## Typed connections

The frontmatter of a note holds typed links to other notes and sources. Each link has a relation, a reason, optional evidence (a card) and an origin. The relations are:

| Group | Relations |
|---|---|
| Argument | supports, opposes, qualifies, addresses question |
| Origin | extends, uses method of, uses data from |
| Structure | elaborates, related |
| Automatic | cites, excerpt of, derived from |

A link may stay untyped. The AI proposes types: "Propose connections" in the connections panel of a source or note reads your text and suggests links with a reason and the supporting card. You accept or reject each proposal. A rejected proposal stays in the file with `status: rejected` so that it is not proposed again. Rejected links do not appear in backlinks or in the graph.

The connections panel in the right column of a source or note shows outgoing links, incoming links and proposals. The "Links to this note" panel of a note lists its backlinks.

## Graph

The graph view joins the typed links of notes, wiki links and citation relations (from the reference lists of converted files and from OpenAlex). Choose a centre node and a depth, and filter by relation type and node kind. "Show proposals" adds proposed links. The graph needs WebGL. Without it the node list next to the canvas still works.

## Concepts

The concept register ("Concepts" in the navigation rail) records how different sources define or use the same term. A concept is a note of type `concept` in `notes/concepts/`. It has aliases, the cards that belong to it and one entry per source.

- You create a concept by hand, or accept a proposal. citegeist proposes concepts from cards of the kind "definition" and from words that recur in at least two sources. It creates nothing on its own.
- "Find matching cards" assigns cards whose quote contains the term or an alias.
- "Write entries" lets the AI describe, per source, how it defines or uses the term (the role "Defines" or "Uses"). The AI sees only the quotes of the cards of that source. Every supporting quote is checked against the stored card text, and an entry without a verified quote is discarded. An entry whose cards have changed since is marked "outdated".
- Names that differ only in case, accents, umlaut spelling or punctuation count as the same concept. "Absorb another concept" merges two concepts: names become aliases, cards are combined, links are rewritten and the other file is removed.

Agents reach concepts through `cg concepts ...`, because the MCP tool set is full. See [ADR 0021](../decisions/0021-concept-register.md).

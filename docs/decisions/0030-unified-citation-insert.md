# ADR 0030: One way to insert a citation

Status: accepted. Date: 2026-10-26.

## Context

Three paths put a citation into a text and behaved differently. The card buttons inserted the quote or the paraphrase with a Pandoc citation, the `@` menu of the texts editor inserted `[@key]` and found sources only, and the quick insert (Cmd+Shift+K) pasted formatted text such as `„…“ (Williams & Srnicek, 2013, S. 1)`, also into citegeist's own editor. Formatted text does not follow the citation style of the text, so a change of style left those citations behind.

## Decision

- Three kinds exist everywhere: verbatim (quote and citation), paraphrase (paraphrase and citation, with the prefix "vgl." in German) and citation only. A source has no quote, so choosing a source inserts the citation only. The code is `apps/ui/src/lib/citation-insert.ts`. `cards.export` takes the mode `cite` and a `locale`, and `cite.format` renders a source.
- The keys are Enter (verbatim), Shift+Enter (paraphrase) and Alt+Enter (citation only), in the quick insert and in the `@` menu. The card buttons stay "Wörtlich zitieren" and "Sinngemäß zitieren". "Nur Beleg" sits in the "..." menu of the card.
- One search finds sources and cards (quote, paraphrase, source, page). The `@` menu searches the library index, the quick insert uses `search.query`.
- The target decides the output. Inside the texts editor the output is Pandoc syntax, `[@key, S. 12]`, `[vgl. @key, S. 1]`, `[@key, para. 4]`. The locator term is the term of the language of the text (the `lang` of the frontmatter, else the project's), because that is the language Pandoc reads locators in. Everywhere else the output is formatted text and rich text in the style of the project, as before.
- The quick insert writes into citegeist's own editor when the app in front was citegeist, the main window is focused and a text is open. The main window publishes the open text to the main process, and the main process sends the Pandoc snippet back to that window. Otherwise the clipboard and the paste keystroke are used.
- The texts editor shows a Pandoc citation as a chip with the in-text form of the style of the text, `(Williams & Srnicek, 2013, Abs. 2)`. The file keeps the Pandoc syntax, and a click on the chip shows it. `cite.format` renders the chips, which is the citeproc rendering the export uses. A change of style or language in the texts view redraws every chip.
- Plain citations that earlier versions pasted can be converted once. The texts view offers "Belege erkennen" when it finds `(Author, Year, locator)` that names exactly one library item, and converts them to Pandoc citations after the user confirms.

## Consequences

Every citation inserted in a text follows the style of the text, and the export renders it. A paste into Word or another app is unchanged. While Shift or Alt is held, the paste keystroke of the quick insert would become Cmd+Shift+V or Cmd+Alt+V, so the palette waits for the keys to come up before it pastes.

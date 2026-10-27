# Reading and quote cards

## The reader

The "Read" tab of an item shows the source in one of two views, which you switch at the top right:

- **PDF** shows the original file.
- **Text** shows the converted, reflowed text.

Both views share the same highlights. A highlight made in one appears in the other, and it survives a new conversion of the file. The converted text has stable block IDs, which are also the targets of links such as `[[luhmann1984soziale#^b7f3k2q]]`.

The dropdown "AI language" sets the language of the AI texts for the source you are reading. It overrides the project setting, which overrides the library default.

## Reading status

Every item is "Unread", "Reading" or "Read".

- In the item view, the status chip is a menu: click it and pick one of the three.
- In the library table, a click on the small square in front of a row moves the item one step on: unread, reading, read, unread. The tooltip names the next status. Select several rows and use "Mark as read" or "Mark as unread" in the bar above the table.
- When an item becomes "Read", citegeist stores the date. The item view shows "Read on 26.10.2026", and the library table has the column "Read on", which you can sort. Going back to "Unread" removes the date. Going from "Read" to "Reading" keeps it as the date you finished the item last.
- Opening an unread item in the "Read" tab sets it to "Reading". Items in the inbox keep their status while you preview them, and so do items you open through an agent or the command line.
- When you scroll to the end of the document, a line at the bottom of the reader asks "Finished reading?". "Mark as read" sets the status; the cross hides the line for this item. citegeist never sets "Read" on its own.

## Printed page numbers

A citation needs the printed page, not the position in the PDF. citegeist reads page labels from the PDF, from running headers and footers, and from the page range in the metadata. When it is not sure, a bar above the reader asks which printed number a PDF page carries. Confirm it once, and every card of that PDF follows. Cards on a PDF page that is not confirmed carry a "Page unchecked" mark.

## Creating a card

Select a passage in either view. The selection snaps to word boundaries. The popover offers "Quote", which saves a card. "Explain" and "Link to note" are visible but disabled.

A card is a Markdown file in `items/<citekey>/cards/`. It stores:

- the wording, unchanged. A gap in the quote is an explicit edit marked with "[...]".
- the locator (printed page) and two anchors, one in the PDF and one in the text.
- a **paraphrase** of one to three sentences. The AI writes it in the background, and the card shows "AI writing" until it arrives. The paraphrase records which model wrote it.
- a **kind**: thesis, finding, method, definition, example or critique. The AI proposes it together with the paraphrase. You can change it at any time, and a kind you set is never overwritten.
- your own **note**, a free text field, and tags.

Cards appear in the right column ("Cards") of the item and in the project. "Show in reader" jumps to the passage. If the passage can no longer be found after a new conversion, the card shows "Highlight not found". The card file stays and remains valid.

"Regenerate" asks the AI for a new paraphrase, optionally in another language. The AI never changes the wording.

## Copying a citation

Each card has two copy actions:

- **Quote verbatim** copies the wording with a citation, for example "(Luhmann 1984, p. 31)".
- **Quote indirectly** copies your note, or the paraphrase when you have no note, with a "cf." citation.

The clipboard holds formatted text and plain text. The citation style and language come from the project, and the project's export setting decides which parts of a card an export includes. In a project, "Export" copies several cards at once as direct or indirect citations. `cg cards export` does the same from a shell.

The "..." menu of a card also offers "Citation only". In the text editor of a project, the card column inserts the same citations at the cursor. See [writing and export](writing-and-export.md).

## Quick insert

A global hotkey (default Cmd+Shift+K, configurable) opens a small search palette over your cards and sources in any app. Enter inserts the quote with its citation, Shift+Enter the paraphrase with its citation, and Alt+Enter the citation alone. A source always inserts its citation. Escape closes the palette. In another app, citegeist copies the citation as formatted text and pastes it into the app that had focus. Pasting into other apps needs the Accessibility permission of macOS. Without it, citegeist copies the citation and says so. When the palette opens over the editor of a text in citegeist, the citation goes into the editor as a Pandoc citation. Turn quick insert on in the settings.

If you rebuild citegeist locally, macOS ties the permission to each build unless the app is signed with a stable identity. See [development](../development.md#stable-signing-identity).

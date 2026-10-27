# Library and import

## The library folder

A library is a folder. Items, converted texts, cards, notes and projects are files in it, and the format is described in [the library format spec](../spec/library-format.md). You can open the folder in Finder, in Obsidian or in a terminal. Machine-local data (the search index, job state, models, logs) lives under `~/Library/Application Support/citegeist/<library-id>/` and is rebuilt from the folder when it is missing.

`cg init <path>` creates a library from a shell. The app does the same when you choose "New library".

## Adding items

The field at the top of the library screen takes:

- a DOI, an arXiv ID or link, an ISBN, a PubMed ID,
- a URL,
- a BibTeX snippet,
- a PDF, dropped into the window or chosen with "Choose PDF".

`cg items add <identifier>` does the same from a shell.

citegeist then runs these steps as background jobs: it resolves the metadata, fetches an open-access PDF (through Unpaywall, arXiv and OpenAlex) when one exists, converts the file into text blocks and enriches the item with references and an index entry. The bar at the top right counts the running jobs.

Metadata comes from the registration agency of the DOI (Crossref or DataCite) for citation fields, from OpenAlex for ORCIDs, institutions and references, and from DNB, K10plus and Open Library for books. Values you enter yourself always win. A PDF without an identifier is read from its first page. The result is marked as a proposal until you check it.

A URL is fetched like a browser would. When the response is a PDF, citegeist treats it as one. When a link that should point to a file returns a web page (a login or a bot check), the call fails with `URL_RETURNED_HTML`. Download the file yourself and add it by path.

A new item is a duplicate when its DOI, ISBN, arXiv ID, PubMed ID, URL or file hash matches an existing item, or when title, year and first author match. If the existing item has no working source, citegeist attaches the new file to it.

### Citekeys

Every item has a citekey such as `luhmann1984soziale` (surname, year, first title word). A key is created once and never recalculated silently. `cg items rename` changes it and rewrites every link and card reference. Placeholder keys (for example `anonnddemos`, when the author or year was missing) are replaced after a successful conversion, as long as no card or link refers to them.

### Items without text

An item can be incomplete or lack a full text. The table shows "incomplete" when the import did not finish. "No full text" appears when no open-access PDF was found. Attach a file to the item ("Attach PDF", or drop the PDF onto the block) and citegeist converts it.

### Fixing metadata

The item view lets you correct the metadata of an existing item: edit fields, add a DOI or ISBN to an item that came without one, and fetch the metadata again from its identifiers ("Resolve metadata again", or `cg items resolve <citekey>`).

## The inbox

Everything an agent or an alert adds lands in the inbox first, with the sender and a reason. What you add yourself goes straight into the library. An agent can bypass the inbox only with `target: "library"`, which the skill allows only when you named the paper or told the agent to do it.

Only "Annehmen" moves an item into the library. Adding the same work again does not: the add field answers "Liegt in der Inbox" and offers "Annehmen", and a new PDF for an inbox item stays with that item in the inbox. You accept or discard items one by one, in a selection or all at once, in the inbox or in the item view.

The item view shows an inbox item as one. The path reads "Inbox / title", and a banner at the top says who suggested the item and why, with "Annehmen" and "Verwerfen". After "Annehmen" the view becomes the library view in place.

The library list, the search, the reading lists of a project and the project graph show accepted items only. The filter "Inklusive Inbox" in the library list adds the inbox items, marked "Inbox"; `cg items list --includeInbox` does the same on the command line. Agents search the inbox as well, so they find their own proposals, marked as inbox hits.

When you add an identifier (a DOI, an ISBN, an arXiv id) to an item and an item on the other side of the inbox holds it already, citegeist offers "Zusammenführen mit dem Inbox-Eintrag <citekey>". The merge moves the files of the inbox item into your item, fills empty fields, keeps what you edited, unites tags and projects and moves the inbox item to the trash, where `cg items restore` finds it. Working on an inbox item whose identifier a library item holds, the same button merges it into the library item. On the command line this is `cg items merge --from <inbox> --into <library>`.

## Importing a collection

"Import" in the navigation rail brings in an existing collection:

| Source | Notes |
|---|---|
| Zotero (database copy) | Choose `zotero.sqlite` or the Zotero data folder. citegeist copies the database first and never opens the original. |
| Zotero (running now) | Zotero must be running. citegeist reads its local API, by default on port 23119. |
| BibTeX, RIS, CSL-JSON | Drop the file or type its path. A folder with PDFs is optional. |

Collections can become projects, tags or nothing. Duplicates are skipped or merged. Attachments, notes and PDF annotations (as cards) are optional. "Preview" runs the whole import as a dry run and shows the counts, duplicates and problems. Nothing is written until you start the import, and each imported item carries a provenance tag. `cg import preview` and `cg import run` are the shell equivalents.

## Saving from the browser

The official Zotero Connector browser extension can save straight into citegeist. Turn on the listener in Settings > General > Zotero Connector. It accepts connections from this Mac only (127.0.0.1) and uses port 23119 by default, the port Zotero itself uses. Close Zotero or choose another port when both run.

## Searching

The search in the navigation rail (Cmd+F) covers items, cards, notes and text passages. It is a full-text search. With semantic search turned on, it also matches passages that use other words for the same thing. See [settings and models](settings-and-models.md).

## Related works and retractions

The item view lists the works a source cites and the works that cite it, from the reference list of the file, Crossref and OpenAlex. Each entry shows whether the work is already in the library or the inbox, and you can add new ones to the inbox. `cg items check-retractions` checks items with a DOI against Crossref (publisher notices and Retraction Watch data). A retracted, withdrawn or corrected source carries a badge in the table and a notice in its overview.

## Deleting

"Delete" moves an item to the trash. The confirmation offers "Undo", and `cg items restore <citekey>` brings the most recently trashed item with that citekey back.

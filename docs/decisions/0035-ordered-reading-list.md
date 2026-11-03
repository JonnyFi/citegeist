# ADR 0035: The reading list of a project is ordered

Status: accepted. Date: 2026-11-03. Closes the questions of issue #119.

## Context

A daily reading tip (a classic, then a newer paper that builds a bridge to it) arrives in the inbox through an agent. Tags and the reading status say what is unread, but not in which order to read it. The issue asked for a new object, the reading list, with several lists, notes, progress and a way to open the next text.

Every project already has a "Reading list" tab. Its items belong to the project through `projects` in the item frontmatter, and the tab showed them as a library table, sorted by any column. The reading status (`unread`, `reading`, `read`, [ADR 0033](0033-reading-status.md)) already exists.

## Decision

- No new object. The reading list of a project is its list of accepted items, and the list is ordered. A project can be per topic, so several lists exist as several projects. An item in several projects stands in several lists, at a different place in each. Items in the inbox are not on the list until they are accepted ([ADR 0032](0032-explicit-inbox.md)).
- The order and a short note per entry live in the project, not in the items: `reading` in the frontmatter of `projects/<slug>/project.md` is a list of `{ item, note? }` (`ReadingEntry` in `packages/schema`). Moving an item in one list leaves its file and the other lists alone, and a person can read and edit the order in the file.
- The effective order is the stored one applied to the project's accepted items. Items the order does not name come after the named ones, oldest first by date added (then by citekey). Entries for items that are no longer in the project, or still in the inbox, are ignored and stay in the file until the next change rewrites the whole order. A new project has an empty `reading`, and adding an item without a position stores nothing: the item simply joins the end.
- The reading status is the existing one. Progress is the number of entries with status `read`. The next text is the first entry in order whose status is not `read` (`unread` or `reading`).
- Operations: `projects.reading` reads the list with its note, progress (`total`, `read`) and `next`. `projects.moveReading { slug, citekey, position }` moves one item (0 is first; a position past the end puts it last) and stores the whole order. `projects.setReadingNote { slug, citekey, note }` sets a note, or clears it when the note is empty; a note is one line of at most 300 characters. `projects.addItems` takes an optional `position` for the items that are added by that call. Both write operations fail with `NOT_IN_READING_LIST` for an item that is not on the list. All of them are available on `cg projects ...` and over the core API through the contracts, with the pure ordering rules in `packages/ops` shared with the mock core of the UI.
- MCP: the tool list is capped at 20 tools and is full, so no tool is added. `get_project` (`projects.context`) returns a `reading` summary: `total`, `read`, `next` and the first 50 entries in order with status and note. `add_item` with `projects` puts a paper at the end of the list. Moving an entry and writing a note have no MCP tool; they are done in the app or with `cg projects moveReading` and `cg projects setReadingNote`. If an agent has to reorder, one tool has to be freed or a merged tool introduced; that is a decision for a maintainer.
- UI: the "Reading list" tab shows the items in reading order. A grip handle moves a row by drag and drop (native HTML drag and drop, no new dependency) or with the arrow keys; the row menu has "Move up" and "Move down". The note shows under the title and is edited in place; the row menu adds one. The status control is the existing chip. A line "x of y read" and the button "Read next" (which opens the first entry that is not read) stand above the table. The sort by column no longer applies in this tab, because the order is the content. The type, date and citekey columns are left out of it so that the title has room.
- Not part of this change: a pair of a classic and its bridge paper. Typed links between items exist already; a pair can be shown from them later.

## Consequences

A project file gains a `reading` key, and a project that had none behaves as before: its items appear by date added. Editing the file by hand is fine, an unknown or removed citekey is ignored. `projects.context` grows by the reading summary, which is bounded to 50 entries. Removing an item from a project and adding it again restores its old place while its entry is still stored, which is the intended result for an accidental removal. The library table keeps all its sort columns; only the project tab is ordered.

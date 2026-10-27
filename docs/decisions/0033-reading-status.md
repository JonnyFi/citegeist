# ADR 0033: The reading status is set by people, with one automatic step

Status: accepted. Date: 2026-10-27.

## Context

`status` (`unread`, `reading`, `read`) was display-only. The item view showed a static chip, the library table showed the label, and nothing could change it. The reader already tracks the reading position, so the app knows when an item is opened and when its end is reached.

## Decision

- People change the status in the item view (a menu on the chip), in the library table (a click on the status square goes unread, reading, read, unread) and for a selection of rows (`Mark as read`, `Mark as unread`).
- `items.setStatus { citekeys, status, from? }` sets the status of many items in one call. Every citekey is checked before the first file is written. With `from`, only items whose status is in the list change.
- `read_at` stores the local date on which the item was marked as read (`YYYY-MM-DD`). Becoming `read` writes it (a second reading moves it), becoming `unread` removes it, and `read` to `reading` keeps it as the date the item was last finished. The rules live in `statusPatch` in `packages/schema`; `items.update` and `items.setStatus` both use it. `read_at` is not bibliographic and does not enter `provenance`. `items.list` sorts by `readAt`.
- One step is automatic: opening a library item in the reader for the first time sets `unread` to `reading`. The app sends `items.setStatus` with `from: ["unread"]`, so a status set a moment earlier is never taken back. The step is a feature of the app, which is a human actor. No agent, MCP tool or background job starts it. An inbox item is not accepted yet, so previewing it changes nothing.
- The status never becomes `read` by itself. At the end of the document the reader shows one line, "Fertig gelesen? Als gelesen markieren", that sets it on request and can be dismissed for the item. The end is the last page in view or the last tenth of the scrollable height; a document that fits the view has none.

## Consequences

The status is a record of what the person did or confirmed. Files written before the field existed keep `status: read` without a date until the status changes. The reading position stays in `localStorage`; the dismissal of the end-of-document line is kept there too.

/**
 * Strings of an inbox item in the item view (banner, breadcrumb), of the offer to merge it with
 * the same work, and of the add field's answer for something that waits in the inbox. They are
 * spread into the catalogs in `de.ts` and `en.ts`.
 */
export const inboxItemDe = {
  "inboxItem.banner": "Inbox-Eintrag",
  "inboxItem.state": "In der Inbox",
  "inboxItem.by": "vorgeschlagen von",
  "inboxItem.accepting": "Wird angenommen",
  "inboxItem.rejecting": "Wird verworfen",
  "inboxItem.failed": "Das hat nicht geklappt: {message}",
  "inboxItem.mergeWithInbox": "Zusammenführen mit dem Inbox-Eintrag {citekey}",
  "inboxItem.mergeWithLibrary": "Zusammenführen mit {citekey} aus der Bibliothek",
  "inboxItem.mergeTextInbox":
    "Diese Kennung gehört schon zum Inbox-Eintrag {citekey}. Es ist dasselbe Werk. Beim Zusammenführen wandern die Dateien in diese Quelle, leere Felder werden ergänzt und deine Eingaben bleiben stehen.",
  "inboxItem.mergeTextLibrary":
    "Diese Kennung gehört schon zu {citekey} in der Bibliothek. Es ist dasselbe Werk. Beim Zusammenführen wandert dieser Inbox-Eintrag in {citekey}.",
  "inboxItem.merging": "Wird zusammengeführt",
  "inboxItem.merged": "Zusammengeführt mit {citekey}.",
  "inboxItem.mergedFilled": "Zusammengeführt mit {citekey}. Ergänzt: {fields}",
  "add.inInbox": "Liegt in der Inbox:",
  "add.accept": "Annehmen",
  "add.accepted": "Angenommen:",
  "filter.includeInbox": "Inklusive Inbox",
  "table.inboxMark": "Inbox",
} as const;

export const inboxItemEn = {
  "inboxItem.banner": "Inbox item",
  "inboxItem.state": "In the inbox",
  "inboxItem.by": "suggested by",
  "inboxItem.accepting": "Accepting",
  "inboxItem.rejecting": "Discarding",
  "inboxItem.failed": "That did not work: {message}",
  "inboxItem.mergeWithInbox": "Merge with the inbox item {citekey}",
  "inboxItem.mergeWithLibrary": "Merge with {citekey} in the library",
  "inboxItem.mergeTextInbox":
    "This identifier already belongs to the inbox item {citekey}. It is the same work. Merging moves its files into this item, fills empty fields and keeps what you entered.",
  "inboxItem.mergeTextLibrary":
    "This identifier already belongs to {citekey} in the library. It is the same work. Merging moves this inbox item into {citekey}.",
  "inboxItem.merging": "Merging",
  "inboxItem.merged": "Merged with {citekey}.",
  "inboxItem.mergedFilled": "Merged with {citekey}. Filled in: {fields}",
  "add.inInbox": "Waits in the inbox:",
  "add.accept": "Accept",
  "add.accepted": "Accepted:",
  "filter.includeInbox": "Include inbox",
  "table.inboxMark": "Inbox",
} as const;

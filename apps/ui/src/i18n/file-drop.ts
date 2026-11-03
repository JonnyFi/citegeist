/** Strings of the file drop area and the summary under the add field. Spread into `de.ts` and `en.ts`. */
export const fileDropDe = {
  "filedrop.choose": "Datei auswählen",
  "filedrop.chooseFolder": "Ordner auswählen",
  "filedrop.chooseAny": "Auswählen",
  "add.drop.label": "PDF, EPUB oder HTML hierher ziehen oder",
  "add.sum.pending": "Wird hinzugefügt: {n}",
  "add.sum.added": "{n} hinzugefügt",
  "add.sum.duplicate": "{n} schon vorhanden",
  "add.sum.inbox": "{n} in der Inbox",
  "add.sum.failed": "{n} fehlgeschlagen",
  "add.sum.unsupported": "{n} nicht unterstützt ({names})",
  "add.unsupported": "{name} wird nicht unterstützt. citegeist nimmt PDF, EPUB und HTML.",
  "add.row.pending": "wartet",
  "add.row.unsupported": "nicht unterstützt",
} as const;

export const fileDropEn: Record<keyof typeof fileDropDe, string> = {
  "filedrop.choose": "Choose file",
  "filedrop.chooseFolder": "Choose folder",
  "filedrop.chooseAny": "Choose",
  "add.drop.label": "Drop a PDF, EPUB or HTML file here or",
  "add.sum.pending": "Adding: {n}",
  "add.sum.added": "{n} added",
  "add.sum.duplicate": "{n} already there",
  "add.sum.inbox": "{n} in the inbox",
  "add.sum.failed": "{n} failed",
  "add.sum.unsupported": "{n} not supported ({names})",
  "add.unsupported": "{name} is not supported. citegeist takes PDF, EPUB and HTML files.",
  "add.row.pending": "waiting",
  "add.row.unsupported": "not supported",
};

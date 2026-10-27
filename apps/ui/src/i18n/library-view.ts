/** Strings for sorting the library and for searching a full text again. Spread into `de.ts` and `en.ts`. */
export const libraryViewDe = {
  "table.added": "Hinzugefügt",
  "sort.by": "Nach {column} sortieren",
  "fulltext.find": "Volltext erneut suchen",
  "fulltext.finding": "Suche läuft",
  "fulltext.searching": "Die offenen Quellen werden geprüft.",
  "fulltext.found": "Volltext gefunden",
  "fulltext.foundText": "Die PDF-Datei ist angehängt, die Umwandlung läuft.",
  "fulltext.notFound": "Kein freier Volltext gefunden",
  "fulltext.alreadyHad": "Diese Quelle hat schon eine Datei.",
  "fulltext.tried": "Geprüfte Adressen ({n})",
  "fulltext.outcome.ok": "PDF",
  "fulltext.outcome.none": "kein PDF",
  "fulltext.outcome.failed": "Fehler",
  "fulltext.failed": "Die Suche ist fehlgeschlagen: {message}",
} as const;

export const libraryViewEn = {
  "table.added": "Added",
  "sort.by": "Sort by {column}",
  "fulltext.find": "Search full text again",
  "fulltext.finding": "Searching",
  "fulltext.searching": "Checking the open sources.",
  "fulltext.found": "Full text found",
  "fulltext.foundText": "The PDF is attached and its conversion is running.",
  "fulltext.notFound": "No open full text found",
  "fulltext.alreadyHad": "This item already has a file.",
  "fulltext.tried": "Addresses checked ({n})",
  "fulltext.outcome.ok": "PDF",
  "fulltext.outcome.none": "no PDF",
  "fulltext.outcome.failed": "error",
  "fulltext.failed": "The search failed: {message}",
} as const;

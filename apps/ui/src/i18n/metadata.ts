/**
 * Strings of the metadata form, the identifier field, the hint on items without author or year
 * and the offer to rename a placeholder citekey. They are spread into the catalogs in `de.ts`
 * and `en.ts`.
 */
export const metadataDe = {
  "metaform.edit": "Metadaten bearbeiten",
  "metaform.label": "Metadaten bearbeiten",
  "metaform.type": "Typ",
  "metaform.titleField": "Titel",
  "metaform.authors": "Autorinnen und Autoren",
  "metaform.editors": "Herausgeberinnen und Herausgeber",
  "metaform.family": "Nachname",
  "metaform.given": "Vorname",
  "metaform.org": "Name der Organisation",
  "metaform.addPerson": "Person hinzufügen",
  "metaform.removePerson": "Person {n} entfernen",
  "metaform.issued": "Erschienen",
  "metaform.issuedHint": "JJJJ, JJJJ-MM oder JJJJ-MM-TT",
  "metaform.container": "Erschienen in",
  "metaform.place": "Verlagsort",
  "metaform.edition": "Auflage",
  "metaform.abstract": "Zusammenfassung",
  "metaform.saving": "Speichert",
  "metaform.saved": "Gespeichert: {fields}",
  "metaform.unchanged": "Nichts geändert.",
  "metaform.failed": "Speichern fehlgeschlagen: {message}",
  "metaform.error.title": "Der Titel darf nicht leer sein.",
  "metaform.error.doi":
    "Das ist keine gültige DOI. Eine DOI beginnt mit 10. und enthält einen Schrägstrich, zum Beispiel 10.1038/s41586-020-2649-2.",
  "metaform.error.isbn":
    "Diese ISBN ist ungültig. Eine ISBN hat 10 oder 13 Stellen mit korrekter Prüfziffer, mehrere trennst du mit einem Komma.",
  "metaform.error.url": "Die Adresse muss mit http:// oder https:// beginnen.",
  "metaform.error.issued":
    "Das Datum muss JJJJ, JJJJ-MM oder JJJJ-MM-TT lauten, zum Beispiel 2020-09-16.",
  "metaform.error.language": "Der Sprachcode besteht aus Kleinbuchstaben, zum Beispiel de oder en.",
  "metaform.error.creator": "Jede Person braucht einen Nachnamen.",

  "metahint.title": "Metadaten unvollständig",
  "metahint.text":
    "Autor oder Jahr fehlen. Mit einer DOI, ISBN oder arXiv-ID holt citegeist die Angaben, oder du trägst sie von Hand ein.",
  "metahint.addId": "Kennung hinzufügen",

  "ident.label": "DOI, ISBN, arXiv-ID, PMID oder Adresse",
  "ident.placeholder": "10.1038/s41586-020-2649-2",
  "ident.submit": "Abrufen",
  "ident.running": "Ruft ab",
  "ident.cancel": "Abbrechen",
  "ident.invalid": "Das ist keine DOI, ISBN, arXiv-ID, PMID oder Adresse.",

  "rename.offer":
    "Der Citekey {citekey} ist ein Platzhalter. Der neue Vorschlag lautet {suggested}.",
  "rename.apply": "Umbenennen",
  "rename.keep": "Behalten",
  "rename.running": "Benennt um",
  "rename.failed": "Umbenennen fehlgeschlagen: {message}",

  "item.metadataMissing": "Metadaten fehlen",
  "item.metadataMissing.hint": "Autor oder Jahr fehlen",
} as const;

export const metadataEn = {
  "metaform.edit": "Edit metadata",
  "metaform.label": "Edit metadata",
  "metaform.type": "Type",
  "metaform.titleField": "Title",
  "metaform.authors": "Authors",
  "metaform.editors": "Editors",
  "metaform.family": "Family name",
  "metaform.given": "Given name",
  "metaform.org": "Name of the organisation",
  "metaform.addPerson": "Add person",
  "metaform.removePerson": "Remove person {n}",
  "metaform.issued": "Published",
  "metaform.issuedHint": "YYYY, YYYY-MM or YYYY-MM-DD",
  "metaform.container": "Published in",
  "metaform.place": "Place",
  "metaform.edition": "Edition",
  "metaform.abstract": "Abstract",
  "metaform.saving": "Saving",
  "metaform.saved": "Saved: {fields}",
  "metaform.unchanged": "Nothing changed.",
  "metaform.failed": "Saving failed: {message}",
  "metaform.error.title": "The title cannot be empty.",
  "metaform.error.doi":
    "This is not a valid DOI. A DOI starts with 10. and contains a slash, for example 10.1038/s41586-020-2649-2.",
  "metaform.error.isbn":
    "This ISBN is not valid. An ISBN has 10 or 13 digits with a correct check digit; separate several with a comma.",
  "metaform.error.url": "The address must start with http:// or https://.",
  "metaform.error.issued": "The date must be YYYY, YYYY-MM or YYYY-MM-DD, for example 2020-09-16.",
  "metaform.error.language": "The language code is lower case letters, for example de or en.",
  "metaform.error.creator": "Every person needs a family name.",

  "metahint.title": "Metadata incomplete",
  "metahint.text":
    "The author or the year is missing. Give a DOI, ISBN or arXiv id and citegeist fetches the details, or enter them by hand.",
  "metahint.addId": "Add identifier",

  "ident.label": "DOI, ISBN, arXiv id, PMID or URL",
  "ident.placeholder": "10.1038/s41586-020-2649-2",
  "ident.submit": "Fetch",
  "ident.running": "Fetching",
  "ident.cancel": "Cancel",
  "ident.invalid": "This is not a DOI, ISBN, arXiv id, PMID or URL.",

  "rename.offer": "The citekey {citekey} is a placeholder. The new suggestion is {suggested}.",
  "rename.apply": "Rename",
  "rename.keep": "Keep",
  "rename.running": "Renaming",
  "rename.failed": "Renaming failed: {message}",

  "item.metadataMissing": "metadata missing",
  "item.metadataMissing.hint": "Author or year missing",
} as const;

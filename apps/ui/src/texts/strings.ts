/**
 * Strings of the Texte tab: the list of texts, the editor with Pandoc citations, the export
 * and the Pandoc setup, plus the card actions that insert into the open text. They are spread
 * into the catalogs in `i18n/de.ts` and `i18n/en.ts`.
 */
export const textsDe = {
  "project.textsTab": "Texte",

  "texts.loading": "Texte werden geladen",
  "texts.loadingText": "Text wird geladen",
  "texts.navigation": "Texte des Projekts",
  "texts.content": "Inhalt des Texts",
  "texts.emptyTitle": "Dieses Projekt hat noch keinen Text",
  "texts.emptyDescription":
    "Ein Text ist eine Markdown-Datei im Projektordner. Zitiere mit [@citekey, S. 12]. Beim Export setzt citegeist Belege und Literaturverzeichnis im gewählten Stil.",
  "texts.stats.one": "{words} Wörter, {n} Quelle",
  "texts.stats.other": "{words} Wörter, {n} Quellen",
  "texts.placeholder": "Schreibe hier. Tippe [@ und wähle eine Quelle.",
  "texts.keepMine": "Meine Fassung behalten",
  "texts.openText": "Text öffnen: {title}",

  "texts.new.button": "Neuer Text",
  "texts.new.title": "Text anlegen",
  "texts.new.name": "Titel",
  "texts.new.placeholder": "Kapitel 2",
  "texts.new.create": "Text anlegen",

  "texts.style": "Zitierstil",
  "texts.lang": "Sprache",
  "texts.sameAsProject": "Wie das Projekt ({value})",
  "texts.style.apa": "APA",
  "texts.style.chicago-author-date": "Chicago (Autor-Jahr)",
  "texts.style.deutsche-gesellschaft-fur-psychologie": "DGPs",
  "texts.lang.de-DE": "Deutsch (Deutschland)",
  "texts.lang.de-AT": "Deutsch (Österreich)",
  "texts.lang.en-US": "Englisch (USA)",
  "texts.lang.en-GB": "Englisch (Großbritannien)",

  "texts.unknown.one": "Ein Citekey steht nicht in der Bibliothek: {keys}",
  "texts.unknown.other": "{n} Citekeys stehen nicht in der Bibliothek: {keys}",

  "texts.export.label": "Exportieren",
  "texts.export.docx": "Word",
  "texts.export.latex": "LaTeX",
  "texts.export.pdf": "PDF",
  "texts.export.md": "Markdown",
  "texts.export.docx.hint": "Eine .docx-Datei mit Belegen und Literaturverzeichnis im Zitierstil",
  "texts.export.latex.hint": "Ein ZIP mit main.tex und references.bib für Overleaf",
  "texts.export.pdf.hint": "Ein PDF, dafür braucht der Mac LaTeX oder Typst",
  "texts.export.md.hint": "Markdown, in dem die Belege schon ausgeschrieben stehen",
  "texts.export.running": "Export läuft",
  "texts.export.done": "Exportiert nach {path}",
  "texts.export.unknown": "Nicht in der Bibliothek und deshalb unaufgelöst im Export: {keys}",
  "texts.export.warnings": "Hinweise von Pandoc: {warnings}",

  "texts.pandoc.missing": "Pandoc fehlt. Der Export braucht es.",
  "texts.pandoc.install": "Pandoc laden",
  "texts.pandoc.installing": "Pandoc wird geladen",
  "texts.pandoc.manual": "Installiere es mit „brew install pandoc“.",
  "texts.pandoc.failed": "Pandoc konnte nicht geladen werden.",
  "texts.pandoc.ready": "Pandoc {version} liegt bereit.",

  "card.insertedIn": "Eingefügt in „{title}“",
  "card.quoteDirectInsertHint": "Fügt das wörtliche Zitat mit Beleg in „{title}“ ein",
  "card.quoteIndirectInsertHint": "Fügt die sinngemäße Wiedergabe mit Beleg in „{title}“ ein",
  "chat.context.text": "Text: {title}",
} as const;

export const textsEn: { [K in keyof typeof textsDe]: string } = {
  "project.textsTab": "Texts",

  "texts.loading": "Loading texts",
  "texts.loadingText": "Loading text",
  "texts.navigation": "Texts of the project",
  "texts.content": "Content of the text",
  "texts.emptyTitle": "This project has no text yet",
  "texts.emptyDescription":
    "A text is a Markdown file in the project folder. Cite with [@citekey, p. 12]. On export, citegeist sets citations and bibliography in the chosen style.",
  "texts.stats.one": "{words} words, {n} source",
  "texts.stats.other": "{words} words, {n} sources",
  "texts.placeholder": "Write here. Type [@ and pick a source.",
  "texts.keepMine": "Keep my version",
  "texts.openText": "Open text: {title}",

  "texts.new.button": "New text",
  "texts.new.title": "Create a text",
  "texts.new.name": "Title",
  "texts.new.placeholder": "Chapter 2",
  "texts.new.create": "Create text",

  "texts.style": "Citation style",
  "texts.lang": "Language",
  "texts.sameAsProject": "Same as the project ({value})",
  "texts.style.apa": "APA",
  "texts.style.chicago-author-date": "Chicago (author-date)",
  "texts.style.deutsche-gesellschaft-fur-psychologie": "DGPs",
  "texts.lang.de-DE": "German (Germany)",
  "texts.lang.de-AT": "German (Austria)",
  "texts.lang.en-US": "English (US)",
  "texts.lang.en-GB": "English (UK)",

  "texts.unknown.one": "One citekey is not in the library: {keys}",
  "texts.unknown.other": "{n} citekeys are not in the library: {keys}",

  "texts.export.label": "Export",
  "texts.export.docx": "Word",
  "texts.export.latex": "LaTeX",
  "texts.export.pdf": "PDF",
  "texts.export.md": "Markdown",
  "texts.export.docx.hint": "A .docx file with citations and bibliography in the citation style",
  "texts.export.latex.hint": "A ZIP with main.tex and references.bib for Overleaf",
  "texts.export.pdf.hint": "A PDF; the Mac needs LaTeX or Typst for it",
  "texts.export.md.hint": "Markdown with the citations already written out",
  "texts.export.running": "Exporting",
  "texts.export.done": "Exported to {path}",
  "texts.export.unknown": "Not in the library and therefore unresolved in the export: {keys}",
  "texts.export.warnings": "Pandoc notes: {warnings}",

  "texts.pandoc.missing": "Pandoc is missing. The export needs it.",
  "texts.pandoc.install": "Download Pandoc",
  "texts.pandoc.installing": "Downloading Pandoc",
  "texts.pandoc.manual": "Install it with “brew install pandoc”.",
  "texts.pandoc.failed": "Pandoc could not be downloaded.",
  "texts.pandoc.ready": "Pandoc {version} is ready.",

  "card.insertedIn": "Inserted into “{title}”",
  "card.quoteDirectInsertHint": "Inserts the verbatim quote with its citation into “{title}”",
  "card.quoteIndirectInsertHint": "Inserts the paraphrase with its citation into “{title}”",
  "chat.context.text": "Text: {title}",
};

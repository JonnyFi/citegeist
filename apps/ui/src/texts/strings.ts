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
  "texts.export.pdf.hint": "Ein PDF für Abgabe und Druck, gesetzt mit Typst",
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

  "texts.typst.ask": "Für PDF lädt citegeist einmal Typst (etwa {size} MB). Jetzt laden?",
  "texts.typst.load": "Laden",
  "texts.typst.cancel": "Abbrechen",
  "texts.typst.loading": "Typst wird geladen, {percent} %",
  "texts.typst.failed": "Typst konnte nicht geladen werden.",

  "texts.error.PANDOC_MISSING":
    "Pandoc fehlt oder ist zu alt. Der Export braucht Pandoc 2.11 oder neuer.",
  "texts.error.PANDOC_MISSING.fix":
    "Lade Pandoc über die Schaltfläche oben im Tab Texte oder installiere es mit „brew install pandoc“.",
  "texts.error.PANDOC_FAILED": "Pandoc konnte den Text nicht exportieren: {detail}",
  "texts.error.PANDOC_FAILED.fix":
    "Behebe das genannte Problem im Text oder exportiere als Word oder LaTeX.",
  "texts.error.PANDOC_TIMEOUT": "Der Export hat zu lange gedauert und wurde abgebrochen.",
  "texts.error.PANDOC_TIMEOUT.fix": "Versuche es noch einmal oder exportiere als Word oder LaTeX.",
  "texts.error.PDF_ENGINE_MISSING": "Für ein PDF fehlt Typst oder ein LaTeX-Programm.",
  "texts.error.PDF_ENGINE_MISSING.fix":
    "Installiere Typst mit „brew install typst“ oder exportiere als Word oder LaTeX.",
  "texts.error.TEXT_UNKNOWN_STYLE": "Dieser Zitierstil ist nicht verfügbar.",
  "texts.error.TEXT_UNKNOWN_STYLE.fix": "Wähle einen der mitgelieferten Stile.",
  "texts.error.TEXT_NOT_FOUND": "Diesen Text gibt es nicht mehr.",
  "texts.error.TEXT_NOT_FOUND.fix": "Wähle in der Liste einen anderen Text.",
  "texts.error.PANDOC_NOT_INSTALLABLE": "citegeist lädt Pandoc nur für einen Mac mit Apple-Chip.",
  "texts.error.PANDOC_NOT_INSTALLABLE.fix":
    "Installiere Pandoc selbst, zum Beispiel mit „brew install pandoc“.",
  "texts.error.PANDOC_DOWNLOAD_FAILED": "Der Download von Pandoc ist fehlgeschlagen.",
  "texts.error.PANDOC_DOWNLOAD_FAILED.fix":
    "Prüfe die Netzwerkverbindung und versuche es noch einmal.",
  "texts.error.PANDOC_CHECKSUM":
    "Die geladene Datei hat nicht die erwartete Prüfsumme und wurde verworfen.",
  "texts.error.PANDOC_CHECKSUM.fix": "Versuche es noch einmal.",
  "texts.error.PANDOC_UNPACK_FAILED": "Pandoc ließ sich nicht entpacken.",
  "texts.error.PANDOC_UNPACK_FAILED.fix": "Versuche es noch einmal.",
  "texts.error.PANDOC_UNUSABLE": "Das geladene Pandoc startet nicht.",
  "texts.error.PANDOC_UNUSABLE.fix": "Installiere es mit „brew install pandoc“.",
  "texts.error.TYPST_NOT_INSTALLABLE": "citegeist lädt Typst nur für einen Mac mit Apple-Chip.",
  "texts.error.TYPST_NOT_INSTALLABLE.fix":
    "Installiere Typst selbst, zum Beispiel mit „brew install typst“.",
  "texts.error.TYPST_DOWNLOAD_FAILED": "Der Download von Typst ist fehlgeschlagen.",
  "texts.error.TYPST_DOWNLOAD_FAILED.fix":
    "Prüfe die Netzwerkverbindung und versuche es noch einmal.",
  "texts.error.TYPST_CHECKSUM":
    "Die geladene Datei hat nicht die erwartete Prüfsumme und wurde verworfen.",
  "texts.error.TYPST_CHECKSUM.fix": "Versuche es noch einmal.",
  "texts.error.TYPST_UNPACK_FAILED": "Typst ließ sich nicht entpacken.",
  "texts.error.TYPST_UNPACK_FAILED.fix": "Versuche es noch einmal.",
  "texts.error.TYPST_UNUSABLE": "Das geladene Typst startet nicht.",
  "texts.error.TYPST_UNUSABLE.fix": "Installiere es mit „brew install typst“.",

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
  "texts.export.pdf.hint": "A PDF for submission and print, typeset with Typst",
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

  "texts.typst.ask": "For PDF, citegeist downloads Typst once (about {size} MB). Download now?",
  "texts.typst.load": "Download",
  "texts.typst.cancel": "Cancel",
  "texts.typst.loading": "Downloading Typst, {percent}%",
  "texts.typst.failed": "Typst could not be downloaded.",

  "texts.error.PANDOC_MISSING":
    "Pandoc is missing or too old. The export needs Pandoc 2.11 or newer.",
  "texts.error.PANDOC_MISSING.fix":
    "Download Pandoc with the button at the top of the Texts tab, or install it with “brew install pandoc”.",
  "texts.error.PANDOC_FAILED": "Pandoc could not export the text: {detail}",
  "texts.error.PANDOC_FAILED.fix":
    "Fix the problem named above in the text, or export as Word or LaTeX.",
  "texts.error.PANDOC_TIMEOUT": "The export took too long and was stopped.",
  "texts.error.PANDOC_TIMEOUT.fix": "Try again, or export as Word or LaTeX.",
  "texts.error.PDF_ENGINE_MISSING": "A PDF needs Typst or a LaTeX program, and none was found.",
  "texts.error.PDF_ENGINE_MISSING.fix":
    "Install Typst with “brew install typst”, or export as Word or LaTeX.",
  "texts.error.TEXT_UNKNOWN_STYLE": "This citation style is not available.",
  "texts.error.TEXT_UNKNOWN_STYLE.fix": "Choose one of the styles that come with citegeist.",
  "texts.error.TEXT_NOT_FOUND": "This text no longer exists.",
  "texts.error.TEXT_NOT_FOUND.fix": "Choose another text in the list.",
  "texts.error.PANDOC_NOT_INSTALLABLE":
    "citegeist downloads Pandoc only for a Mac with an Apple chip.",
  "texts.error.PANDOC_NOT_INSTALLABLE.fix":
    "Install Pandoc yourself, for example with “brew install pandoc”.",
  "texts.error.PANDOC_DOWNLOAD_FAILED": "The download of Pandoc failed.",
  "texts.error.PANDOC_DOWNLOAD_FAILED.fix": "Check the network connection and try again.",
  "texts.error.PANDOC_CHECKSUM":
    "The downloaded file does not have the expected checksum and was discarded.",
  "texts.error.PANDOC_CHECKSUM.fix": "Try again.",
  "texts.error.PANDOC_UNPACK_FAILED": "Pandoc could not be unpacked.",
  "texts.error.PANDOC_UNPACK_FAILED.fix": "Try again.",
  "texts.error.PANDOC_UNUSABLE": "The downloaded Pandoc does not start.",
  "texts.error.PANDOC_UNUSABLE.fix": "Install it with “brew install pandoc”.",
  "texts.error.TYPST_NOT_INSTALLABLE":
    "citegeist downloads Typst only for a Mac with an Apple chip.",
  "texts.error.TYPST_NOT_INSTALLABLE.fix":
    "Install Typst yourself, for example with “brew install typst”.",
  "texts.error.TYPST_DOWNLOAD_FAILED": "The download of Typst failed.",
  "texts.error.TYPST_DOWNLOAD_FAILED.fix": "Check the network connection and try again.",
  "texts.error.TYPST_CHECKSUM":
    "The downloaded file does not have the expected checksum and was discarded.",
  "texts.error.TYPST_CHECKSUM.fix": "Try again.",
  "texts.error.TYPST_UNPACK_FAILED": "Typst could not be unpacked.",
  "texts.error.TYPST_UNPACK_FAILED.fix": "Try again.",
  "texts.error.TYPST_UNUSABLE": "The downloaded Typst does not start.",
  "texts.error.TYPST_UNUSABLE.fix": "Install it with “brew install typst”.",

  "card.insertedIn": "Inserted into “{title}”",
  "card.quoteDirectInsertHint": "Inserts the verbatim quote with its citation into “{title}”",
  "card.quoteIndirectInsertHint": "Inserts the paraphrase with its citation into “{title}”",
  "chat.context.text": "Text: {title}",
};

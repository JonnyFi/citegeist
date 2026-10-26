import type { Lang } from "../i18n";

/** Strings of the quick-insert palette. It has its own catalog because it ships as a separate unit. */
const de = {
  "qi.label": "Zitat einfügen",
  "qi.placeholder": "Karten und Quellen durchsuchen",
  "qi.recent": "Zuletzt angelegt",
  "qi.results": "Treffer",
  "qi.searching": "Suche läuft",
  "qi.noneTitle": "Nichts gefunden",
  "qi.noneDescription":
    "Für „{q}“ gibt es weder eine Zitatkarte noch eine Quelle. Versuche andere Wörter.",
  "qi.emptyTitle": "Noch keine Karten oder Quellen",
  "qi.emptyDescription":
    "Füge eine Quelle hinzu oder markiere im Reader eine Stelle, dann erscheint sie hier.",
  "qi.source": "Quelle",
  "qi.hintDirect": "Enter: wörtlich",
  "qi.hintIndirect": "Umschalt+Enter: sinngemäß",
  "qi.hintCite": "Alt+Enter: nur Beleg",
  "qi.hintSource": "Quelle: Enter fügt nur den Beleg ein",
  "qi.hintClose": "Esc: schließen",
  "qi.noPermission":
    "Kopiert, aber nicht eingefügt: citegeist braucht die Bedienungshilfen-Berechtigung, um in die andere App zu tippen. Einfügen mit Cmd+V. Der Knopf öffnet die Liste, dort citegeist einschalten oder mit „+“ hinzufügen.",
  "qi.unsupported": "Kopiert. Automatisches Einfügen gibt es nur auf dem Mac. Einfügen mit Strg+V.",
  "qi.grant": "Bedienungshilfen öffnen",
  "qi.editorGone":
    "Das Zitat konnte nicht in den Text eingefügt werden. Prüfe, ob der Text im Hauptfenster noch geöffnet ist.",
  "qi.error": "Das Zitat konnte nicht erstellt werden.",
  "qi.searchError": "Die Suche ist fehlgeschlagen.",
  "qi.noLibrary": "Öffne zuerst eine Bibliothek in citegeist.",
} as const;

export type QuickInsertKey = keyof typeof de;

const en: Record<QuickInsertKey, string> = {
  "qi.label": "Insert citation",
  "qi.placeholder": "Search cards and sources",
  "qi.recent": "Recently added",
  "qi.results": "Results",
  "qi.searching": "Searching",
  "qi.noneTitle": "Nothing found",
  "qi.noneDescription": "No quote card or source matches “{q}”. Try other words.",
  "qi.emptyTitle": "No cards or sources yet",
  "qi.emptyDescription": "Add a source or select a passage in the reader and it shows up here.",
  "qi.source": "Source",
  "qi.hintDirect": "Enter: verbatim",
  "qi.hintIndirect": "Shift+Enter: paraphrase",
  "qi.hintCite": "Alt+Enter: citation only",
  "qi.hintSource": "Source: Enter inserts the citation only",
  "qi.hintClose": "Esc: close",
  "qi.noPermission":
    'Copied but not pasted: citegeist needs the Accessibility permission to type into the other app. Paste with Cmd+V. The button opens the list; switch citegeist on there or add it with "+".',
  "qi.unsupported": "Copied. Automatic pasting only exists on the Mac. Paste with Ctrl+V.",
  "qi.grant": "Open Accessibility",
  "qi.editorGone":
    "The citation could not be inserted into the text. Check that the text is still open in the main window.",
  "qi.error": "The citation could not be created.",
  "qi.searchError": "The search failed.",
  "qi.noLibrary": "Open a library in citegeist first.",
};

const catalogs: Record<Lang, Record<QuickInsertKey, string>> = { de, en };

export function quickInsertText(lang: Lang) {
  return (key: QuickInsertKey, vars?: Record<string, string | number>): string =>
    catalogs[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
      vars && name in vars ? String(vars[name]) : whole,
    );
}

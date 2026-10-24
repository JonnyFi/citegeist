import type { Lang } from "../i18n";

/** Strings of the quick-insert palette. It has its own catalog because it ships as a separate unit. */
const de = {
  "qi.label": "Zitat einfügen",
  "qi.placeholder": "Karten durchsuchen",
  "qi.recent": "Zuletzt angelegt",
  "qi.results": "Treffer",
  "qi.searching": "Suche läuft",
  "qi.noneTitle": "Keine Karte gefunden",
  "qi.noneDescription": "Für „{q}“ gibt es keine Zitatkarte. Versuche andere Wörter.",
  "qi.emptyTitle": "Noch keine Karten",
  "qi.emptyDescription": "Markiere im Reader eine Stelle, dann erscheint hier die Karte.",
  "qi.hintDirect": "Enter: direktes Zitat",
  "qi.hintIndirect": "Umschalt+Enter: indirektes Zitat",
  "qi.hintClose": "Esc: schließen",
  "qi.noPermission":
    "Kopiert, aber nicht eingefügt: citegeist braucht die Bedienungshilfen-Berechtigung, um in die andere App zu tippen. Einfügen mit Cmd+V. Der Knopf öffnet die Liste, dort citegeist einschalten oder mit „+“ hinzufügen.",
  "qi.unsupported": "Kopiert. Automatisches Einfügen gibt es nur auf dem Mac. Einfügen mit Strg+V.",
  "qi.grant": "Bedienungshilfen öffnen",
  "qi.error": "Das Zitat konnte nicht erstellt werden.",
  "qi.searchError": "Die Suche ist fehlgeschlagen.",
  "qi.noLibrary": "Öffne zuerst eine Bibliothek in citegeist.",
} as const;

export type QuickInsertKey = keyof typeof de;

const en: Record<QuickInsertKey, string> = {
  "qi.label": "Insert citation",
  "qi.placeholder": "Search cards",
  "qi.recent": "Recently added",
  "qi.results": "Results",
  "qi.searching": "Searching",
  "qi.noneTitle": "No card found",
  "qi.noneDescription": "No quote card matches “{q}”. Try other words.",
  "qi.emptyTitle": "No cards yet",
  "qi.emptyDescription": "Select a passage in the reader and its card shows up here.",
  "qi.hintDirect": "Enter: direct citation",
  "qi.hintIndirect": "Shift+Enter: indirect citation",
  "qi.hintClose": "Esc: close",
  "qi.noPermission":
    'Copied but not pasted: citegeist needs the Accessibility permission to type into the other app. Paste with Cmd+V. The button opens the list; switch citegeist on there or add it with "+".',
  "qi.unsupported": "Copied. Automatic pasting only exists on the Mac. Paste with Ctrl+V.",
  "qi.grant": "Open Accessibility",
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

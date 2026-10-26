/**
 * Texts of the main process: native menus, dialogs, the About window and the errors that reach
 * the settings screen. The language follows the window (see `setMainLanguage`); until the
 * window reports one it is English.
 */

export type MainLang = "de" | "en";

const en = {
  "menu.about": "About citegeist",
  "menu.settings": "Settings...",
  "menu.file": "File",
  "menu.openLibrary": "Open Library...",
  "menu.newLibrary": "New Library...",
  "menu.view": "View",
  "menu.library": "Library",
  "menu.inbox": "Inbox",
  "menu.projects": "Projects",
  "menu.search": "Search",

  "library.open.error": "Could not open the library",
  "library.open.title": "Open a library folder",
  "library.create.title": "Choose a folder for the new library",
  "library.open.button": "Open",
  "library.create.button": "Create Library",
  "library.cancel": "Cancel",
  "library.create.ask": "Create a library here?",
  "library.notALibrary": "This folder is not a citegeist library.",
  "library.create.detail":
    "A new library adds citegeist.json, AGENTS.md and the folders items, notes and projects.",

  "update.terminalError": "Could not open Terminal for the update",
  "quickInsert.hotkeyError": "Quick-insert hotkey",
  "quickInsert.needsModifier":
    "A hotkey needs at least one modifier and a key, such as Cmd+Shift+K.",
  "quickInsert.badKey": '"{key}" is not a key Electron accepts.',
  "quickInsert.badModifier": '"{key}" is not a modifier. Use Cmd, Ctrl, Alt, Shift or Super.',
  "quickInsert.invalid": '"{key}" is not a valid hotkey.',
  "quickInsert.taken": "{key} is taken by another app or by macOS. Choose another hotkey.",

  "about.title": "About citegeist",
  "about.version": "Version {version}",
  "about.commit": "Commit {commit}",
  "about.license": "License: Apache-2.0",
  "about.repository": "Repository: {url}",
  "about.library": "Library: {path}",
  "about.noLibrary": "Library: none open",
  "about.logs": "Log folder: {path}",
  "about.data": "Data folder: {path}",
  "about.openLog": "Open Log",
  "about.openNotice": "Open NOTICE",
  "about.openRepository": "Open Repository",
  "about.close": "Close",
  "about.noticeMissing": "The NOTICE file is not part of this build.",
} as const;

export type MainKey = keyof typeof en;

const de: Record<MainKey, string> = {
  "menu.about": "Über citegeist",
  "menu.settings": "Einstellungen ...",
  "menu.file": "Ablage",
  "menu.openLibrary": "Bibliothek öffnen ...",
  "menu.newLibrary": "Neue Bibliothek ...",
  "menu.view": "Ansicht",
  "menu.library": "Bibliothek",
  "menu.inbox": "Inbox",
  "menu.projects": "Projekte",
  "menu.search": "Suche",

  "library.open.error": "Die Bibliothek konnte nicht geöffnet werden",
  "library.open.title": "Bibliotheksordner öffnen",
  "library.create.title": "Ordner für die neue Bibliothek wählen",
  "library.open.button": "Öffnen",
  "library.create.button": "Bibliothek anlegen",
  "library.cancel": "Abbrechen",
  "library.create.ask": "Hier eine Bibliothek anlegen?",
  "library.notALibrary": "Dieser Ordner ist keine citegeist-Bibliothek.",
  "library.create.detail":
    "Eine neue Bibliothek legt citegeist.json, AGENTS.md und die Ordner items, notes und projects an.",

  "update.terminalError": "Das Terminal für das Update konnte nicht geöffnet werden",
  "quickInsert.hotkeyError": "Hotkey der Schnelleinfügung",
  "quickInsert.needsModifier":
    "Ein Hotkey braucht mindestens eine Sondertaste und eine Taste, zum Beispiel Cmd+Shift+K.",
  "quickInsert.badKey": '"{key}" ist keine Taste, die Electron akzeptiert.',
  "quickInsert.badModifier":
    '"{key}" ist keine Sondertaste. Erlaubt sind Cmd, Ctrl, Alt, Shift und Super.',
  "quickInsert.invalid": '"{key}" ist kein gültiger Hotkey.',
  "quickInsert.taken":
    "{key} ist von einer anderen App oder von macOS belegt. Wähle einen anderen Hotkey.",

  "about.title": "Über citegeist",
  "about.version": "Version {version}",
  "about.commit": "Commit {commit}",
  "about.license": "Lizenz: Apache-2.0",
  "about.repository": "Repository: {url}",
  "about.library": "Bibliothek: {path}",
  "about.noLibrary": "Bibliothek: keine geöffnet",
  "about.logs": "Log-Ordner: {path}",
  "about.data": "Datenordner: {path}",
  "about.openLog": "Log öffnen",
  "about.openNotice": "NOTICE öffnen",
  "about.openRepository": "Repository öffnen",
  "about.close": "Schließen",
  "about.noticeMissing": "Die NOTICE-Datei gehört nicht zu diesem Build.",
};

const CATALOGS: Record<MainLang, Record<MainKey, string>> = { en, de };

let current: MainLang = "en";

export function setMainLanguage(lang: MainLang): void {
  current = lang;
}

export function mainLanguage(): MainLang {
  return current;
}

/** Text for a key in the current language; `{name}` placeholders are filled from `vars`. */
export function mt(
  key: MainKey,
  vars: Record<string, string> = {},
  lang: MainLang = current,
): string {
  return CATALOGS[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/**
 * The first language of the system's preference list that the app offers, English otherwise.
 * `["de-AT", "en"]` gives German, `["fr", "de"]` German as well, `["fr"]` English.
 */
export function languageFromPreferred(preferred: readonly string[]): MainLang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === "de") return "de";
    if (base === "en") return "en";
  }
  return "en";
}

import { settingsGet } from "@citegeist/ops";
import { useOp } from "../lib/hooks";

export type Lang = "de" | "en";

const en = {
  // Settings screen
  "settings.title": "Settings",
  "settings.loadError": "The settings could not be loaded.",
  "settings.language.title": "Language",
  "settings.language.desc": "Language of the interface.",
  "settings.backends.title": "AI backends",
  "settings.backends.desc": "API keys are stored in the macOS Keychain.",
  "settings.routing.title": "Task routing",
  "settings.routing.desc": "Which backend serves which task.",
  "settings.routing.default": "All other tasks",
  "settings.routing.inherit": "Default",
  "settings.contact.title": "Contact address",
  "settings.contact.desc":
    "Sent to Crossref with metadata lookups. Requests with an address are served from Crossref's polite pool.",
  "settings.contact.label": "Email address",
  "settings.contact.save": "Save",
  "settings.contact.saved": "Saved",
  "settings.worker.title": "Conversion worker",
  "settings.worker.desc": "Python environment for PDF conversion, OCR and web pages.",
  // Backends
  "backend.test": "Test",
  "backend.testing": "Testing",
  "backend.testOk": "Works, answered after {seconds} s",
  "backend.recheck": "Check again",
  "backend.models": "{n} models",
  "backend.key.label": "API key",
  "backend.key.save": "Save key",
  "backend.key.remove": "Remove key",
  "backend.key.stored": "Key stored in the Keychain",
  "backend.kind.subscription-cli": "Subscription",
  "backend.kind.api-key": "API key",
  "backend.kind.local": "Local",
  "backend.status.ready": "Ready",
  "backend.status.not-installed": "Not installed",
  "backend.status.logged-out": "Not logged in",
  "backend.status.outdated": "Version too old",
  "backend.status.no-key": "No key",
  "backend.status.unreachable": "Not reachable",
  "backend.status.unknown": "Unavailable",
  "backend.hint.claude-code-cli.not-installed":
    "Install Claude Code with npm install -g @anthropic-ai/claude-code.",
  "backend.hint.claude-code-cli.logged-out": "Run claude auth login in Terminal.",
  "backend.hint.claude-code-cli.outdated": "Update Claude Code, then check again.",
  "backend.hint.codex-exec.not-installed":
    "Install the Codex CLI with npm install -g @openai/codex.",
  "backend.hint.codex-exec.logged-out": "Run codex login in Terminal.",
  "backend.hint.ollama.unreachable": "Start Ollama, then check again.",
  // Tasks
  "task.card.paraphrase": "Paraphrase and core statement",
  "task.card.verify": "Check quotes",
  "task.metadata.fromFirstPage": "Metadata from the first page",
  // Worker
  "worker.status.ready": "Ready",
  "worker.status.not-installed": "Not installed",
  "worker.status.installing": "Installing",
  "worker.status.not-ready": "Not ready",
  "worker.status.unreachable": "Not reachable",
  "worker.engines": "Engines: {engines}",
  "worker.install": "Install",
  "worker.reinstall": "Reinstall",
  "worker.failed": "The installation failed.",
  "worker.progress.Checking uv": "Checking uv",
  "worker.progress.Removing the old environment": "Removing the old environment",
  "worker.progress.Installing the Python environment": "Installing the Python environment",
  "worker.progress.Starting the worker": "Starting the worker",
  "worker.progress.Worker ready": "Worker ready",
  "worker.error.WORKER_UV_MISSING":
    "uv is missing. Install it with brew install uv, then start the installation again.",
  // Onboarding
  "onb.title": "Set up citegeist",
  "onb.step": "Step {n} of {total}",
  "onb.step.library": "Library",
  "onb.step.backend": "AI backend",
  "onb.step.worker": "Conversion worker",
  "onb.library.desc": "A library is a folder with your papers, notes and citations as plain files.",
  "onb.library.create": "New library",
  "onb.library.open": "Open library",
  "onb.library.later": "Set up later",
  "onb.backend.desc": "Choose the backend that writes paraphrases and checks quotes, then test it.",
  "onb.backend.use": "Use this backend",
  "onb.backend.inUse": "In use",
  "onb.worker.desc":
    "The worker converts PDFs and web pages. The installation needs uv and takes a few minutes.",
  "onb.continue": "Continue",
  "onb.back": "Back",
  "onb.finish": "Finish",
  "onb.later": "Later",
  "error.generic": "Something went wrong.",
} as const;

export type MessageKey = keyof typeof en;

const de: Record<MessageKey, string> = {
  "settings.title": "Einstellungen",
  "settings.loadError": "Die Einstellungen konnten nicht geladen werden.",
  "settings.language.title": "Sprache",
  "settings.language.desc": "Sprache der Oberfläche.",
  "settings.backends.title": "AI-Backends",
  "settings.backends.desc": "API-Schlüssel liegen in der macOS-Keychain.",
  "settings.routing.title": "Zuordnung der Aufgaben",
  "settings.routing.desc": "Welches Backend welche Aufgabe übernimmt.",
  "settings.routing.default": "Alle anderen Aufgaben",
  "settings.routing.inherit": "Standard",
  "settings.contact.title": "Kontaktadresse",
  "settings.contact.desc":
    "Wird bei Metadaten-Abfragen an Crossref gesendet. Anfragen mit Adresse laufen über den Polite Pool von Crossref.",
  "settings.contact.label": "E-Mail-Adresse",
  "settings.contact.save": "Speichern",
  "settings.contact.saved": "Gespeichert",
  "settings.worker.title": "Konvertierung",
  "settings.worker.desc": "Python-Umgebung für PDF-Konvertierung, OCR und Webseiten.",
  "backend.test": "Testen",
  "backend.testing": "Teste",
  "backend.testOk": "Funktioniert, Antwort nach {seconds} s",
  "backend.recheck": "Erneut prüfen",
  "backend.models": "{n} Modelle",
  "backend.key.label": "API-Schlüssel",
  "backend.key.save": "Schlüssel speichern",
  "backend.key.remove": "Schlüssel entfernen",
  "backend.key.stored": "Schlüssel liegt in der Keychain",
  "backend.kind.subscription-cli": "Abo",
  "backend.kind.api-key": "API-Schlüssel",
  "backend.kind.local": "Lokal",
  "backend.status.ready": "Bereit",
  "backend.status.not-installed": "Nicht installiert",
  "backend.status.logged-out": "Nicht angemeldet",
  "backend.status.outdated": "Version zu alt",
  "backend.status.no-key": "Kein Schlüssel",
  "backend.status.unreachable": "Nicht erreichbar",
  "backend.status.unknown": "Nicht verfügbar",
  "backend.hint.claude-code-cli.not-installed":
    "Installiere Claude Code mit npm install -g @anthropic-ai/claude-code.",
  "backend.hint.claude-code-cli.logged-out": "Führe claude auth login im Terminal aus.",
  "backend.hint.claude-code-cli.outdated": "Aktualisiere Claude Code und prüfe erneut.",
  "backend.hint.codex-exec.not-installed":
    "Installiere die Codex CLI mit npm install -g @openai/codex.",
  "backend.hint.codex-exec.logged-out": "Führe codex login im Terminal aus.",
  "backend.hint.ollama.unreachable": "Starte Ollama und prüfe erneut.",
  "task.card.paraphrase": "Paraphrase und Kernaussage",
  "task.card.verify": "Zitate prüfen",
  "task.metadata.fromFirstPage": "Metadaten von der ersten Seite",
  "worker.status.ready": "Bereit",
  "worker.status.not-installed": "Nicht installiert",
  "worker.status.installing": "Installation läuft",
  "worker.status.not-ready": "Nicht bereit",
  "worker.status.unreachable": "Nicht erreichbar",
  "worker.engines": "Engines: {engines}",
  "worker.install": "Installieren",
  "worker.reinstall": "Neu installieren",
  "worker.failed": "Die Installation ist fehlgeschlagen.",
  "worker.progress.Checking uv": "Prüfe uv",
  "worker.progress.Removing the old environment": "Entferne die alte Umgebung",
  "worker.progress.Installing the Python environment": "Installiere die Python-Umgebung",
  "worker.progress.Starting the worker": "Starte den Worker",
  "worker.progress.Worker ready": "Worker bereit",
  "worker.error.WORKER_UV_MISSING":
    "uv fehlt. Installiere es mit brew install uv und starte die Installation erneut.",
  "onb.title": "citegeist einrichten",
  "onb.step": "Schritt {n} von {total}",
  "onb.step.library": "Bibliothek",
  "onb.step.backend": "AI-Backend",
  "onb.step.worker": "Konvertierung",
  "onb.library.desc":
    "Eine Bibliothek ist ein Ordner, in dem Papers, Notizen und Zitate als einfache Dateien liegen.",
  "onb.library.create": "Neue Bibliothek",
  "onb.library.open": "Bibliothek öffnen",
  "onb.library.later": "Später einrichten",
  "onb.backend.desc": "Wähle das Backend, das Paraphrasen schreibt und Zitate prüft, und teste es.",
  "onb.backend.use": "Dieses Backend verwenden",
  "onb.backend.inUse": "Aktiv",
  "onb.worker.desc":
    "Der Worker konvertiert PDFs und Webseiten. Die Installation braucht uv und dauert einige Minuten.",
  "onb.continue": "Weiter",
  "onb.back": "Zurück",
  "onb.finish": "Fertig",
  "onb.later": "Später",
  "error.generic": "Etwas ist schiefgegangen.",
};

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, de };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): Translate {
  return (key, vars) => {
    const text = MESSAGES[lang][key];
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}

/** Translated text for a key built at runtime, or undefined when no such message exists. */
export function lookup(lang: Lang, key: string): string | undefined {
  return (MESSAGES[lang] as Record<string, string>)[key];
}

const LANG_KEY = "citegeist.lang";

/** Interface language before a core exists: last choice, otherwise the browser language. */
export function guessLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "de" || stored === "en") return stored;
  } catch {
    // storage unavailable
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")
    ? "en"
    : "de";
}

export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage unavailable, the choice still applies for this session
  }
}

/**
 * Interface language and translator for components inside the core provider. The saved
 * `uiLanguage` wins; it is read through the same query the settings screen uses, so a change
 * shows up everywhere at once.
 */
export function useI18n(): { lang: Lang; t: Translate } {
  const settings = useOp(settingsGet, {});
  const lang = settings.data?.settings.uiLanguage ?? guessLang();
  return { lang, t: translator(lang) };
}

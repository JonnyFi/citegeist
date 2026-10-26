/**
 * Strings of the first run: the help for a missing uv and a missing AI backend, the sample paper
 * and the first steps in an empty library. They are spread into the catalogs in `i18n/de.ts` and
 * `i18n/en.ts`.
 */
export const onboardingDe = {
  "onb.copy": "Kopieren",
  "onb.copied": "Kopiert",
  "onb.recheck": "Erneut prüfen",

  "onb.uv.title": "uv fehlt",
  "onb.uv.desc":
    "citegeist richtet die Python-Umgebung für die PDF-Umwandlung mit uv ein. Installiere uv mit einem dieser Befehle im Terminal und prüfe dann erneut.",
  "onb.uv.brew": "Mit Homebrew",
  "onb.uv.curl": "Ohne Homebrew",
  "onb.uv.reading":
    "Ohne den Worker kannst du PDFs weiter hinzufügen und lesen. Umgewandelter Text und die Volltextsuche brauchen ihn.",
  "worker.status.uv-missing": "uv fehlt",

  "onb.agents.title": "Kein KI-Zugang gefunden",
  "onb.agents.desc":
    "citegeist nutzt die KI, die du schon hast. Installiere eines dieser Programme und melde dich an, oder trage einen API-Schlüssel ein. Prüfe danach erneut.",
  "onb.agents.install": "Installieren",
  "onb.agents.login": "Anmelden",
  "onb.agents.claude": "Claude Code",
  "onb.agents.codex": "Codex",
  "onb.agents.cursor": "Cursor",
  "onb.agents.key": "API-Schlüssel",
  "onb.agents.keyDesc":
    "Trage unten bei OpenAI, Anthropic, OpenRouter oder xAI einen Schlüssel ein. Er liegt in der Keychain von macOS.",
  "onb.agents.ollama": "Ollama",
  "onb.agents.ollamaDesc":
    "Installiere Ollama von ollama.com, starte die App und lade ein Modell, zum Beispiel mit:",
  "onb.agents.optional":
    "Lesen und Zitieren funktionieren ohne KI. Paraphrasen und Zitatprüfung brauchen einen Zugang.",

  "first.title": "Deine Bibliothek ist leer",
  "first.intro": "Drei Dinge zum Einstieg.",
  "first.add.title": "Ein Paper hinzufügen",
  "first.add.desc":
    "Ziehe ein PDF ins Fenster oder gib oben eine DOI, eine arXiv-ID oder einen Link ein.",
  "first.highlight.title": "Eine Stelle markieren",
  "first.highlight.desc":
    "Öffne ein Paper, markiere eine Passage und wähle „Zitat“. So entsteht eine Karte.",
  "first.chat.title": "Den Chat öffnen",
  "first.chat.desc": "Öffne neben einem Paper den Tab „Agent“ und stelle eine Frage dazu.",
  "first.sample.button": "Beispielquelle hinzufügen",
  "first.sample.desc":
    "Das Docling Technical Report (CC-BY 4.0, 9 Seiten) wird beim Hinzufügen von arXiv geladen.",
  "first.sample.adding": "Wird hinzugefügt",
  "first.sample.error": "Das Hinzufügen hat nicht geklappt: {message}",
};

export const onboardingEn: Record<keyof typeof onboardingDe, string> = {
  "onb.copy": "Copy",
  "onb.copied": "Copied",
  "onb.recheck": "Check again",

  "onb.uv.title": "uv is missing",
  "onb.uv.desc":
    "citegeist sets up the Python environment for PDF conversion with uv. Install uv with one of these commands in Terminal, then check again.",
  "onb.uv.brew": "With Homebrew",
  "onb.uv.curl": "Without Homebrew",
  "onb.uv.reading":
    "Without the worker you can still add and read PDFs. Converted text and full-text search need it.",
  "worker.status.uv-missing": "uv missing",

  "onb.agents.title": "No AI access found",
  "onb.agents.desc":
    "citegeist runs the AI you already have. Install one of these and log in, or add an API key. Then check again.",
  "onb.agents.install": "Install",
  "onb.agents.login": "Log in",
  "onb.agents.claude": "Claude Code",
  "onb.agents.codex": "Codex",
  "onb.agents.cursor": "Cursor",
  "onb.agents.key": "API key",
  "onb.agents.keyDesc":
    "Add a key for OpenAI, Anthropic, OpenRouter or xAI below. It is stored in the macOS Keychain.",
  "onb.agents.ollama": "Ollama",
  "onb.agents.ollamaDesc":
    "Install Ollama from ollama.com, start the app and pull a model, for example:",
  "onb.agents.optional":
    "Reading and citing work without AI. Paraphrases and quote checks need one of these.",

  "first.title": "Your library is empty",
  "first.intro": "Three things to try first.",
  "first.add.title": "Add a paper",
  "first.add.desc":
    "Drop a PDF into the window, or enter a DOI, an arXiv id or a link in the field above.",
  "first.highlight.title": "Highlight a passage",
  "first.highlight.desc": "Open a paper, select a passage and choose “Quote”. That creates a card.",
  "first.chat.title": "Open the chat",
  "first.chat.desc": "Open the Agent tab next to a paper and ask a question about it.",
  "first.sample.button": "Add a sample paper",
  "first.sample.desc":
    "The Docling Technical Report (CC-BY 4.0, 9 pages) is downloaded from arXiv when you add it.",
  "first.sample.adding": "Adding",
  "first.sample.error": "Adding it failed: {message}",
};

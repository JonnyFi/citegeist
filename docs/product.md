# citegeist: Produkt

## Kurzbeschreibung

citegeist ist eine Literaturverwaltung für den Mac, in der Mensch und Agents mit derselben Bibliothek arbeiten. Sie verwaltet Quellen so vollständig wie Zotero und wandelt PDFs in Texte um, die sich bequem lesen und von Agents durchsuchen lassen. Markierte Passagen werden zu Zitatkarten mit gedruckter Seitenzahl, Gedanken zu Notizen mit typisierten Verbindungen zwischen Papern. Agents erreichen dieselbe Bibliothek über MCP, über die CLI `cg` und direkt über die Dateien.

## Nutzer

Jonny überlegt, eine Promotion zu beginnen, und liest dafür Literatur, aus der irgendwann ein Proposal wird. Parallel liest er technische Paper für kiimu. Beides landet in einer Bibliothek, die pro Projekt und als Ganzes funktioniert.

Später sollen Forschende citegeist nutzen, die eine lokale, agent-fähige Bibliothek wollen und ihr eigenes Abo von Claude, ChatGPT oder Cursor mitbringen.

## Grundsätze

1. **Mensch und Agent haben dieselben Fähigkeiten.** Jede Operation existiert einmal im Kern und ist über Oberfläche, MCP und CLI erreichbar.
2. **Jede Änderung trägt ihre Herkunft.** citegeist speichert, ob ein Mensch, welcher Agent oder welches Modell etwas angelegt hat und aus welcher Quelle ein Wert stammt.
3. **Zitate und Seitenzahlen kommen nur aus dem Dokument.** Eine Zitatkarte speichert den Wortlaut unverändert, und ein Zitat in einer Agent-Antwort, das zu keiner gespeicherten Stelle passt, wird markiert.
4. **Die Bibliothek ist ein Ordner aus offenen Formaten.** Markdown, YAML, JSON und die Original-PDFs bleiben ohne citegeist lesbar, in Obsidian, in git und für jeden Agent mit Dateizugriff.
5. **citegeist arbeitet lokal.** Ins Netz gehen Metadaten-Abfragen, Downloads frei zugänglicher PDFs und die Aufrufe an den gewählten AI-Anbieter.
6. **AI lässt sich abschalten.** Jede AI-Funktion ist eine Option pro Aufgabe, und die klassische Verwaltung funktioniert vollständig ohne.

## Szenarien

### Ein Paper kommt in die Bibliothek

Jonny zieht ein PDF ins Fenster, fügt eine DOI ein oder teilt einen arXiv-Link. citegeist erkennt die Quelle, holt die Metadaten (Crossref, OpenAlex, arXiv, bei Büchern DNB und K10plus), lädt frei zugängliche PDFs selbst und konvertiert im Hintergrund. Aus dem Browser speichert die offizielle Zotero-Erweiterung direkt in citegeist. Ein Agent kann über MCP dasselbe tun, etwa mit „füge diese fünf Paper hinzu“.

### Lesen mit dem AI-Highlighter

Jonny liest im PDF oder in der umgebrochenen Textansicht. Er markiert einen Absatz, und ein Menü bietet „Zitat“, „Erklären“ und „Mit Notiz verknüpfen“. Bei „Zitat“ speichert citegeist den Wortlaut mit gedruckter Seitenzahl, und das Modell schreibt eine Paraphrase und eine Kernaussage dazu. Später kopiert ein Klick die Karte als direktes oder indirektes Zitat mit Beleg, etwa als „(Luhmann 1984, S. 31)“ oder als `[vgl. @luhmann1984soziale, S. 31]`.

### Gedanken verknüpfen

Zu einem Paper schreibt Jonny: „Luhmanns Kommunikationsbegriff widerspricht dem Handlungsbegriff bei Habermas, beide bearbeiten aber dasselbe Problem.“ citegeist schlägt daraus Verbindungen vor, hier `opposes` zwischen den beiden Quellen, jeweils mit Begründung und der belegenden Stelle. Jonny bestätigt oder verwirft, und bestätigte Verbindungen erscheinen im Verbindungspanel beider Paper und im Graphen.

### Das PhD-Projekt

Das Projekt „PhD-Proposal“ hat einen Projektbrief mit Forschungsfragen und Abgrenzung, eine Leseliste mit Status und eigene Notizen. Agents lesen den Brief vor jeder Projektaufgabe. Eine Literaturmatrix vergleicht ausgewählte Paper nach Fragestellung, Methode, Befund und Grenzen, und jede Zelle verweist auf die Stelle, aus der sie stammt.

### Recherche delegieren

In der Seitenleiste schreibt Jonny: „Suche Arbeiten seit 2020, die Systemtheorie auf Plattformen anwenden, und fasse die fünf relevantesten zusammen.“ Ein Agent (Claude Code, Codex, Cursor oder ein verbundener externer Agent) arbeitet im Hintergrund, nutzt die Bibliothek über MCP und legt seine Funde mit Begründung in die Inbox.

### Zitieren beim Schreiben

In Google Docs drückt Jonny einen globalen Hotkey, sucht „Autopoiesis“ und wählt eine Zitatkarte. citegeist fügt Zitat und Beleg als formatierten Text ein. Das Literaturverzeichnis erzeugt citegeist pro Projekt im gewählten Stil, und eine `.bib`- und CSL-JSON-Datei pro Projekt aktualisiert sich selbst.

### Ein anderer Agent nutzt die Bibliothek

Claude Code arbeitet im kiimu-Repo an einem RAG-Feature und fragt über MCP: „Welche Paper zu Retrieval-Evaluation habe ich gelesen, und was waren die Kernaussagen?“ Die Antwort verweist auf Zitatkarten und Notizen mit Seitenangaben.

### Überblick über alles Gelesene

Die Startseite zeigt über alle Projekte hinweg, was zuletzt gelesen und markiert wurde, welche Verbindungen neu sind und welche Fragen offen sind. Jede Zeile führt zur Quelle.

## Feature-Landkarte

„Jonny“ heißt: steht in seinem ursprünglichen Wunsch. „Vorschlag“ heißt: kommt aus der Recherche oder von mir und ist noch zu bestätigen.

| Bereich | Feature | Release | Herkunft |
|---|---|---|---|
| Verwaltung | Strukturierte Felder nach Zotero-Schema (37 Typen, 121 Felder), CSL-kompatibel | v0.1 | Jonny |
| Verwaltung | Metadaten automatisch aus DOI, arXiv-ID, ISBN, PMID | v0.1 | Jonny |
| Verwaltung | Metadaten-Erkennung aus PDFs ohne Kennung (Regex, dann Titelabgleich, dann LLM) | v0.1 | Vorschlag |
| Verwaltung | Stabile Citekeys, nie still neu erzeugt | v0.1 | Vorschlag |
| Verwaltung | Projekte (Sammlungen mit Mehrfachzugehörigkeit), Tags, Papierkorb, Undo | v0.1 | Jonny |
| Verwaltung | Dubletten erkennen und zusammenführen | v0.2 | Vorschlag |
| Verwaltung | Rückruf-Warnungen (Retraction Watch über Crossref), Preprint mit veröffentlichter Fassung verknüpfen | v0.3 | Vorschlag |
| Verwaltung | Import aus Zotero sowie BibTeX, RIS und CSL-JSON | v0.3 | D3 |
| Import | PDF per Drag and Drop, DOI, arXiv-Link, URL | v0.1 | Jonny |
| Import | arXiv-HTML direkt statt PDF-Konvertierung | v0.1 | Jonny |
| Import | Web-Artikel und graue Literatur | v0.1 | D4 |
| Import | OCR für Scans mit Apple Vision, lokal und kostenlos | v0.1 | D4 |
| Import | Zotero Connector speichert direkt in citegeist | v0.2 | Vorschlag |
| Import | Freie PDFs selbst finden (Unpaywall, arXiv, OpenAlex) | v0.2 | Vorschlag |
| Lesen | PDF-Ansicht und umgebrochene Textansicht mit denselben Markierungen | v0.1 | Jonny |
| Lesen | Erklären und Übersetzen markierter Stellen | v0.2 | Vorschlag |
| Highlighter | Zitatkarte: Wortlaut, Seite, Paraphrase, Kernaussage, eigene Worte, Art (Zitat, Befund, Methode, Definition, Kritik) | v0.1 | Jonny |
| Highlighter | Kopieren als direktes oder indirektes Zitat, Rich Text und Pandoc | v0.1 | D2 |
| Highlighter | Sprache der AI-Texte: Dropdown pro Quelle, überschreibt die Projekteinstellung | v0.1 | D9 |
| Highlighter | Gedruckte Seitenzahl einmal pro PDF bestätigen, alle Karten folgen | v0.1 | Vorschlag |
| Highlighter | Treue-Prüfung: ein zweiter Durchgang prüft die Paraphrase gegen die Stelle | v0.2 | Vorschlag |
| Highlighter | Quick-Insert per globalem Hotkey in jede App | v0.2 | Vorschlag |
| Notizen | Zettel als Obsidian-kompatibles Markdown mit Wiki-Links | v0.2 | Jonny, D6 |
| Notizen | AI schlägt typisierte Verbindungen aus Freitext vor | v0.2 | Jonny |
| Notizen | Verbindungspanel pro Paper, Backlinks, Graph-Ansicht | v0.2 | Jonny |
| Notizen | Begriffsregister: wie verschiedene Paper denselben Begriff verwenden | später | Vorschlag |
| Projekte | Projektbrief mit Forschungsfragen als Kontext für Agents | v0.1 | Jonny |
| Projekte | Startseite über alles Gelesene | v0.2 | Jonny |
| Projekte | Literaturmatrix mit belegten Zellen | v0.3 | Vorschlag |
| Agents | Inbox für alles, was Agents hinzufügen, mit Herkunft | v0.1 | D7 |
| Agents | MCP-Abkürzung: ein Agent legt ein Paper direkt in die Bibliothek | v0.1 | Jonny, D7 |
| Agents | Chat-Seitenleiste mit Kontext (Dokument, Markierung, Projekt) | v0.2 | Jonny |
| Agents | Recherche-Aufträge als Hintergrundjobs | v0.2 | Jonny |
| Agents | Fragen an die Bibliothek mit belegten Antworten | v0.2 | Vorschlag |
| Agents | Schneeballsuche über Referenzen und zitierende Arbeiten (OpenAlex) | v0.3 | Vorschlag |
| Agents | Externe Agents per Webhook, etwa ein Grok-Bot | v0.3 | Jonny |
| Agents | Alerts: neue Paper zu Themen, Autoren oder zitierenden Arbeiten | später | Vorschlag |
| Schnittstellen | MCP-Server, CLI `cg`, `AGENTS.md` im Bibliotheksordner, portabler Skill | v0.1 (lesen), v0.2 (schreiben) | Jonny |
| Inferenz | Claude Code mit eigenem Abo | v0.1 | Jonny |
| Inferenz | Codex und Cursor mit eigenem Abo, API-Keys, lokale Modelle, Routing pro Aufgabe | v0.2 | Jonny |
| Inferenz | Lokale Embeddings für semantische Suche | v0.2 | Vorschlag |
| Sync | iCloud- oder Dropbox-Ordner, git mit ausgelagertem `.git` | v0.3 | D5 |
| Schreiben | Eigener Schreibeditor oder Add-ins für Google Docs und LibreOffice | später | D2 |
| Geräte | iPad und iPhone | später | D5 |

## Releases

- **v0.1, Lesen und Zitieren:** Paper rein, lesen, markieren, als Zitat herauskopieren. Dazu Projekte mit Brief, Volltextsuche und lesender MCP-Zugang. Ab hier ist citegeist für die PhD-Lektüre nutzbar.
- **v0.2, Denken und Verknüpfen:** Notizen mit typisierten Verbindungen, Graph, Startseite, Chat-Seitenleiste, Recherche-Jobs, semantische Suche, schreibender MCP-Zugang, weitere Inferenz-Anbieter, Quick-Insert, Zotero Connector.
- **v0.3, Breite:** Importer, Sync, Literaturmatrix, Schneeballsuche, Webhooks, Rückruf-Warnungen.
- **1.0:** Feinschliff und Open-Source-Release mit Lizenzprüfung, Signierung und Dokumentation.

## Entschiedene Feature-Fragen

D7 bis D10 in `decisions.md` beantworten die Fragen aus dem ersten Entwurf. Alle Vorschläge der Landkarte sind angenommen (D10).

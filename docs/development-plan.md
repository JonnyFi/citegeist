# citegeist: Entwicklungsplan

Grundlage sind `product.md` und `architecture.md`.

## Stand

Stand: 2026-10-24. Die Wellen 0 bis 4 sind gebaut und gemergt, die App läuft als gepackte arm64-App (`pnpm package`, Anleitung in `docs/run.md`).

| Welle | Workstreams | PRs |
|---|---|---|
| 0 Fundament | W0.1 bis W0.3, Spikes S1 bis S3 | #1 |
| 1 Bausteine | W1.1, W1.2, W1.4, W1.5, W1.6, W1.8 | #1 |
| | W1.3 Konvertierung | #12 |
| | W1.7 App-Hülle | #2 |
| 2 v0.1 | W2.1 Ingest | #7 |
| | W2.2 Highlighter und Karten | #4, #11 |
| | W2.3 Bibliotheks-Oberfläche | #11 |
| | W2.4 Agent-Zugang lesen | #3 |
| | W2.5 Einstellungen und Start | #8, #9 |
| | Integration der Welle | #7, #13 |
| 3 v0.2 | W3.1 Notizen | #20 |
| | W3.2 Verbindungen | #21 |
| | W3.3 Chat und Recherche | #24 |
| | W3.4 Semantische Suche | #18 |
| | W3.5 Agent-Zugang schreiben | #17 |
| | W3.6 Backends und Quick-Insert | #19 |
| | W3.7 Einsichten und Pläne | #26 |
| | W3.8 Planansicht | #32 |
| | W3.9 Planungs-Chat (im Chat, mit W3.3 und der Integration) | #24, #28 |
| | W3.10 Design-Umsetzung | #22, #27 |
| | Integration der Welle | #25, #28 |
| 4 v0.3 | W4.1, W4.2 Importe | #31 |
| | W4.3 Sync | #29 |
| | W4.4 Literaturmatrix | #41 |
| | W4.5 Schneeballsuche und Rückrufe | #30 |
| | W4.6 Webhooks | #40 |
| | Integration der Welle | #33, #47 |
| Oberfläche zu Welle 4 | Einstellungen, Sync, Webhooks, Import (UI-2b) | #48 |
| | Matrix, verwandte Werke, Rückruf-Hinweise, Planung auf echten Verträgen (UI-2a) | #49 |
| Nachbesserung | Fehler aus der ersten echten Chat-Sitzung, Karten-Logik und Prompt | #43, #44, #45, #46 |
| Werkzeuge | `pnpm app:update`, Linux-CI mit lokalem Pre-push-Gate, Beitragsablauf | #42, #23, #53 |
| Schreiben | Texte als Markdown mit Pandoc-Zitaten, Tab „Texte“, Export über Pandoc nach Word, LaTeX und PDF, Pandoc-Download mit fester Prüfsumme (D20) | dieser PR |
| Abschluss | Dateiauswahl, Rückruf-Marker in `items.list`, schlankere App, Hinzufügen-Menü, Löschen mit Rückgängig, PDF anhängen | dieser PR |

Offen sind:

- **iPad.** Die App ist nur für macOS gebaut.
- **Visueller Editor und Add-ins.** Ein Schreibeditor ohne Markdown oder Add-ins für Word und Google Docs entstehen nur, wenn sich Bedarf zeigt (D20). Geschrieben wird bis dahin als Markdown in citegeist.
- **Signierung.** Die App ist ad hoc signiert und nicht notarisiert. Ohne Developer ID verteilt `install.sh` sie über `curl`, `pnpm release` baut und veröffentlicht lokal, und die App weist selbst auf neue Versionen hin (siehe `docs/run.md`). Eine notarisierte App mit Auto-Update braucht die Developer ID.
- **Prüfung für den Open-Source-Release (D1).** Die AGPL-Isolation der Abhängigkeiten (der Python-Worker läuft als eigener Prozess), die Nutzungsbedingungen von Gemma für EmbeddingGemma und die CPAL-Namensnennung. Dazu läuft vor dem Release `/cso`.
- **Erledigt nach Plan:** Alerts (PR #57), Begriffsregister (PR #59), Lizenz- und Sicherheitsprüfung (PR #58).


## Arbeitsweise

citegeist wird fast vollständig von Agents gebaut, parallel in Conductor-Workspaces. Drei Regeln machen das möglich:

1. **Verträge zuerst.** Schemas, Operations-Registry, Ordnerformat und Worker-Protokoll stehen fest, bevor parallele Arbeit beginnt. Eine Vertragsänderung ist ein eigener PR der Lead-Session und wird vor den abhängigen Paketen gemergt.
2. **Disjunkte Pfade.** Jeder Workstream besitzt eigene Verzeichnisse. Zwei Workstreams einer Welle ändern nie dieselbe Datei.
3. **Maschinelle Abnahme.** Ein Workstream ist fertig, wenn `pnpm verify` und seine eigenen Abnahmetests grün sind. Jonny schaut auf Oberfläche und Produktfragen. Den Code prüfen `/review` und die Tests.

### Rollen

- **Jonny:** Produktentscheidungen, Abnahme der Oberfläche, Antworten auf offene Fragen.
- **Lead-Session (Opus):** pflegt Verträge, `AGENTS.md`, `CLAUDE.md`, Hotspot-Dateien und die Merge-Reihenfolge, integriert am Ende jeder Welle.
- **Workstream-Agents (Sonnet):** je ein Conductor-Workspace pro Workstream.

### Ablauf pro Workstream mit gstack

1. Die Lead-Session macht aus dem Workstream-Steckbrief mit `/spec` ein GitHub-Issue.
2. In einem neuen Conductor-Workspace liest der Agent das Issue. Bei Größe L läuft vorher `/autoplan`, bei S und M direkt die Umsetzung.
3. Der Agent implementiert, bis `pnpm verify` und die Abnahmetests grün sind.
4. `/review` prüft den Diff, bei Oberfläche, CLI oder Worker zusätzlich `/qa`.
5. `/ship` öffnet den PR und schließt das Issue beim Merge.

Auf Ebene des Projekts kommen dazu: `/plan-eng-review` auf `architecture.md` vor Welle 1, `/plan-devex-review` auf MCP, CLI und Skill vor Welle 2, `/plan-design-review` und `/design-consultation` vor der ersten Oberflächen-Welle, `/retro` nach jeder Welle, `/cso` vor dem Open-Source-Release.

### Token-Budget

- Workstream-Agents starten mit Sonnet. Opus bleibt für Verträge, Architekturfragen und die Integration am Wellenende.
- `/autoplan` nur bei Größe L, weil es vier Reviews hintereinander fährt.
- Pro Welle laufen höchstens sechs Workspaces gleichzeitig. Das schont das Usage-Limit, und mehr kann ein einzelner Reviewer kaum sinnvoll abnehmen.
- Steckbriefe sind knapp und verweisen auf Abschnitte in `architecture.md`, statt sie zu wiederholen.
- Agents lesen Recherche-Berichte nur abschnittsweise, wenn ihr Steckbrief darauf verweist.

## Repo-Struktur

```
apps/
  desktop/          Electron main und preload
  ui/               React-Renderer, läuft auch im Browser gegen einen Mock-Kern (für /qa)
  cli/              cg, inklusive cg mcp
packages/
  schema/           Zod-Schemas, JSON-Schema-Export                 HOTSPOT
  ops/              Operations-Registry, Verträge aller Operationen  HOTSPOT
  core/             Ordner, Index, Watcher, Jobs, Dienste
  metadata/         Resolver und Merge
  cite/             CSL, BibTeX, RIS, Citekeys, Zitat-Export
  ai/               Backends, Aufgaben, Evals
  mcp/              MCP-Server auf Basis von ops
  anchoring/        Anker-Bibliothek (rein TypeScript)
  reader/           PDF- und Textansicht mit Markierungsebene
workers/
  convert/          Python mit uv: Docling, GROBID, OCR, arXiv, Web
skills/
  citegeist/        portabler Skill im gstack-Aufbau
fixtures/           PDFs mit CC-BY-Lizenz, HTTP-Aufnahmen, erwartete Ausgaben
docs/
```

Hotspots, die nur die Lead-Session ändert: `packages/schema`, `packages/ops/src/contracts`, die Wurzel-`package.json`, `pnpm-lock.yaml`, `turbo.json`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows`.

## Welle 0: Fundament

Die Lead-Session baut das Gerüst. Daneben laufen drei Spikes in eigenen Workspaces. Ihr Code ist Wegwerfcode, ihr Ergebnis ist ein Bericht in `docs/spikes/` mit Messwerten gegen die Kriterien aus `architecture.md`.

| ID | Inhalt | Größe |
|---|---|---|
| W0.1 | Monorepo mit pnpm, Turborepo, TypeScript, Biome, Vitest, Playwright. `pnpm verify` (Lint, Typen, Tests). CI auf macOS-Runnern. `CLAUDE.md` mit Modulkarte und Hotspots. `conductor.json` mit Setup-Skript (`pnpm install`, `uv sync`) | M |
| W0.2 | Verträge: alle Zod-Schemas aus `architecture.md`, Signaturen aller Operationen in `packages/ops`, Spezifikation des Ordnerformats in `docs/spec/library-format.md`, Worker-Protokoll als JSON-RPC-Schema | L |
| W0.3 | Fixture-Korpus: 15 PDFs (zweispaltig, Mathe, Tabellen, deutscher Scan, Buchkapitel, arXiv, Web-Artikel), 20 DOIs und ISBNs mit erwarteten Metadaten, aufgenommene HTTP-Antworten | M |
| S1 | Spike Konvertierung: Docling plus GROBID gegen die Kriterien, Seitenzahlen-Zuordnung | M |
| S2 | Spike Inferenz: Latenz des Highlighters über vorgewärmtes Agent SDK, `codex app-server` und `agent -p` | S |
| S3 | Spike Anker: pdf.js-Markierung, dieselbe Stelle in der Textansicht, Neukonvertierung | M |

Abnahme der Welle: Jonny beantwortet die offenen Fragen aus `product.md`, `/plan-eng-review` läuft auf der Architektur, und die Spikes haben bestanden oder einen Rückfall ausgelöst.

## Welle 1: Bausteine

Sechs parallele Workstreams. Jeder testet gegen Fixtures und Mocks und braucht keinen der anderen.

| ID | Besitzt | Liefert | Abnahme | Größe |
|---|---|---|---|---|
| W1.1 Kern-Speicher | `packages/core` (store, index, watcher) | Lesen und atomares Schreiben aller Dateitypen, Index mit FTS5, Watcher, Neuaufbau, Problemliste | Rundreise aller Schemas ohne Verlust; Neuaufbau eines Korpus mit 1.000 synthetischen Quellen unter zwei Minuten; externe Änderung nach unter einer Sekunde im Index | L |
| W1.2 Metadaten | `packages/metadata` | Resolver für Crossref, doi.org, OpenAlex, arXiv, DNB, K10plus, Open Library; Erkennung aus PDF-Text; Merge mit Herkunft pro Feld; Client mit Cache und Ratenbegrenzung | alle 20 Fixture-Kennungen ergeben die erwarteten Felder aus den HTTP-Aufnahmen; Titelabgleich lehnt die Luhmann-Falle ab | M |
| W1.3 Konvertierung | `workers/convert` | Pfade arXiv, Digital, Scan, Web; `blocks.jsonl`, `pages.json`, `doc.md`, `doc.html`; Wiederzuordnung der Block-IDs | Kriterien aus S1 auf allen 15 Fixtures; Golden-Tests für `doc.md` | L |
| W1.4 Zitieren | `packages/cite` | Citekey-Formel, CSL-Ausgabe (APA 7 de, DGPs, Chicago), BibTeX/RIS/CSL-JSON lesen und schreiben, Zitat-Export als Rich Text und Pandoc | Golden-Tests für 10 Quellen mal 3 Stile; Rundreise BibTeX ohne Verlust | M |
| W1.5 AI-Backends | `packages/ai` | `InferenceBackend` für Claude Code und einen Mock; Aufgaben `card.paraphrase` und `metadata.fromFirstPage` mit Schemas und Evals | Tests laufen gegen den Mock; ein manueller Eval-Lauf gegen das Abo mit 10 Fixtures besteht | M |
| W1.6 Reader | `packages/anchoring`, `packages/reader` | PDF-Ansicht mit Textebene und Auswahl-Popover, Textansicht aus `doc.html`, doppelte Anker, unscharfes Wiederfinden | Kriterien aus S3; Komponententests im Browser-Modus von Vitest | L |

Danach folgen W1.7 und W1.8, sobald ein Slot frei wird:

| ID | Besitzt | Liefert | Abnahme | Größe |
|---|---|---|---|---|
| W1.7 App-Hülle | `apps/desktop`, `apps/ui` (Gerüst) | Electron startet den Kern als `utilityProcess`, Routing, Design-Tokens, Bibliothekstabelle gegen Mock-Kern | Playwright-Smoke-Test startet die App und zeigt die Tabelle | M |
| W1.8 MCP und CLI | `packages/mcp`, `apps/cli` | Generierung von CLI-Kommandos und MCP-Tools aus `ops`, stdio-Shim, HTTP mit Token | MCP-Client-Test ruft alle lesenden Tools gegen einen Fixture-Kern auf | M |

## Welle 2: Durchstich zu v0.1

Hier entsteht die erste nutzbare Version: Paper rein, lesen, markieren, zitieren.

| ID | Inhalt | Abnahme | Größe |
|---|---|---|---|
| W2.1 Ingest | Pipeline aus Erkennen, Metadaten, Quelle holen, Konvertieren, Index; Jobs mit Wiederholung | ein PDF per Drag and Drop, eine DOI und ein arXiv-Link landen vollständig in der Bibliothek (E2E-Test) | L |
| W2.2 Highlighter | Popover-Aktion „Zitat“, Karte schreiben, Paraphrase und Kernaussage über das Backend, Seitenbestätigung pro PDF, Kopieren als Rich Text und Pandoc | E2E: Markierung in der PDF-Ansicht erzeugt eine Karte mit richtiger gedruckter Seite, die Zwischenablage enthält Zitat und Beleg | L |
| W2.3 Bibliotheks-Oberfläche | Tabelle mit Filtern, Item-Ansicht mit Metadaten, Karten und Literaturnotiz, Projekte mit Brief | `/qa` gegen den Browser-Build mit Mock-Kern | M |
| W2.4 Agent-Zugang lesen | MCP-Tools `search`, `get_item`, `read_document`, `list_cards`, `get_project`, `cite`; `AGENTS.md`-Generator; Skill-Entwurf | Claude Code findet über MCP eine Karte per Suchbegriff; `/context` zeigt unter 1.500 Tokens | M |
| W2.5 Einstellungen und Start | Bibliothek anlegen oder öffnen, Backend wählen und testen, Python-Umgebung beim ersten Start installieren | frische Installation bis zur ersten importierten Quelle ohne Terminal | M |

Abnahme der Welle: Die E2E-Tests laufen, und Jonny kann ab hier echte Literatur lesen. Die Entwicklung läuft ohne Pause weiter. Was ihn beim Lesen stört, kommt als Issue in die laufende Welle.

## Welle 3: v0.2, Denken und Verknüpfen

| ID | Inhalt | Größe |
|---|---|---|
| W3.1 Notizen | CodeMirror-Editor mit Live-Vorschau, Wiki-Links mit Autovervollständigung, Einbetten von Karten, Backlinks | L |
| W3.2 Verbindungen | Aufgabe `note.proposeLinks`, Vorschläge annehmen oder verwerfen, Verbindungspanel, Graph mit sigma.js | M |
| W3.3 Chat und Recherche | Seitenleiste als ACP-Client, Kontext aus Dokument, Markierung und Projekt, Recherche-Jobs mit Inbox zum Filtern der Ergebnissen in der Inbox | L |
| W3.4 Semantische Suche | lokale Embeddings, hybride Suche, `library.ask` mit belegten Antworten und Zitatprüfung | M |
| W3.5 Agent-Zugang schreiben | MCP-Tools `add_item`, `create_card`, `create_note`, `link`, `jobs_get`; Skill fertig, Plugin-Paket, `.mcpb` | M |
| W3.6 Backends und Quick-Insert | Codex, Cursor, API-Keys, lokale Modelle, Routing pro Aufgabe; globaler Hotkey mit Kartensuche; Zotero Connector | M |
| W3.7 Einsichten und Pläne | Einsichten als datierte Absätze, Absatzindex, Suche über Links und dann semantisch, Gliederung mit festen Feldern, Verlauf mit Rückgängig pro Zug, Vorschläge für ungefragte Änderungen | L |
| W3.8 Planansicht | Tab pro Plan mit Gliederung, Knotenformular, Dokumenten und Verlauf | M |
| W3.9 Planungs-Chat | Festhalten von Einsichten im Chat, Zurückholen mit Zitat, direkte Änderungen mit Rückgängig | M |
| W3.11 Texte | Markdown-Texte pro Projekt (`texts.*`), Pandoc-Zitate im Editor mit Vervollständigung und Markierung, Karten fügen Zitat und Beleg ein, `texts.export` und `pandoc.*` über Pandoc als eigenen Prozess (D20) | L |

Die Forschungsplanung folgt `docs/spec/research-planning.md`. Vor W3.7 liefert die Lead-Session `plan.ts` und die Verträge aus Abschnitt 6 der Spec. Der erste Schnitt ist W3.7 zusammen mit dem Festhalten aus W3.9, das bis zum Ende von W3.3 über Claude Code und MCP läuft.

```markdown
## W3.7 Einsichten und Pläne

Ziel: Einsichten liegen als datierte Absätze in Plandateien, die Gliederung als feste Felder, der Agent schreibt beides über Operationen, und jede Änderung lässt sich zurücknehmen.
Besitzt: packages/core/src/planning/**
Liest: packages/schema (plan.ts), packages/ops (insights.*, plans.*, outline.*, plan.docs.*, history.*, proposals.*), docs/spec/research-planning.md Abschnitte 2 bis 6
Darf nicht ändern: Hotspots, andere Pakete
Abnahme:
- [ ] note_insight schreibt an alle drei Orte einen Absatz mit Datum und Block-ID, der Index zerlegt ihn mit seinen Links
- [ ] insights.find liefert auf einem Fixture-Projekt zuerst die Link-Treffer, dann die semantischen, jeweils mit why
- [ ] Umordnen der Gliederung ändert die berechneten Nummern, alle Links auf Knoten bleiben gültig
- [ ] Rundreise von outline.yaml ohne Verlust
- [ ] history.revertTurn stellt alle Dateien eines Zugs wieder her und führt eine Handänderung dazwischen per Drei-Wege-Merge zusammen
- [ ] Schreibende Operationen eines Hintergrundjobs und im Prüfmodus erzeugen Vorschläge
- [ ] note_insight, find_insights, get_project, edit_outline und edit_plan_doc bestehen den MCP-Client-Test
- [ ] pnpm verify grün
Modell: Sonnet. Größe: L.
```

```markdown
## W3.8 Planansicht

Ziel: Jonny liest und bearbeitet Gliederung, Dokumente und Einsichten in der App.
Besitzt: apps/ui/src/plan/**
Liest: W3.1-Editor, packages/ops (plans.*, outline.*, plan.docs.*, history.*), docs/spec/research-planning.md Abschnitte 4 und 7
Darf nicht ändern: Hotspots, apps/ui/src/chat/**
Abnahme:
- [ ] Tab pro Plan mit Gliederung und berechneten Nummern, Planungsdokument und Einsichten des Projekts
- [ ] Knotenformular schreibt über outline.apply, Dokumente über den Editor
- [ ] Ziehen in der Gliederung ordnet um und nummeriert neu
- [ ] Verlauf einer Datei zeigt Fassungen mit Herkunft und stellt eine wieder her
- [ ] /qa gegen den Browser-Build mit Mock-Kern grün
Modell: Sonnet. Größe: M.
```

```markdown
## W3.9 Planungs-Chat

Ziel: Jonny hält Einsichten im Chat fest, und der Agent holt sie beim Planen zurück.
Besitzt: apps/ui/src/chat/planning/**, packages/ai/tasks/plan-chat/**
Liest: W3.3, W3.7, docs/spec/research-planning.md Abschnitte 2, 3 und 5
Darf nicht ändern: Hotspots, apps/ui/src/plan/**
Abnahme:
- [ ] Gegen das Mock-Backend schreibt „bitte einmal notieren“ einen Absatz mit Links an den passenden Ort, und die Antwort nennt den Ort in einer Zeile
- [ ] „Füge Kapitel 4 einen Unterabschnitt 4.4 hinzu“ legt den Knoten an der richtigen Stelle an
- [ ] Plant Jonny ein Kapitel, stehen vor dem Zug die fünf passenden Einsichten im Kontext, zitierte Einsichten erscheinen als Chip
- [ ] Ein Verweis auf einen unbekannten Absatz wird markiert
- [ ] „Rückgängig“ an einem Zug nimmt alle seine Änderungen zurück
- [ ] Ein manueller Lauf gegen das Abo hält drei Einsichten aus Fixture-Quellen fest und zitiert eine davon beim Umbau eines Kapitels
Modell: Sonnet. Größe: M.
```

```markdown
## W3.11 Texte

Ziel: Jonny schreibt ein Kapitel in citegeist, belegt es aus seinen Karten und exportiert es nach Word oder LaTeX.
Besitzt: packages/core/src/texts/**, packages/editor/src/citations.ts, apps/ui/src/texts/**
Liest: D20, docs/spec/library-format.md Abschnitt „Texte“, W3.1, W3.3
Darf nicht ändern: Hotspots (der Lead hat `packages/schema/src/texts.ts` und `packages/ops/src/contracts/texts.ts` geliefert)
Abnahme:
- [x] `[@` im Editor bietet die Bibliothek an, Quellen des Projekts zuerst, und ein unbekannter Citekey ist markiert
- [x] „Wörtlich zitieren“ und „Sinngemäß zitieren“ einer Karte fügen Zitat und Beleg an der Cursorposition des offenen Texts ein
- [x] `texts.export` erzeugt docx, LaTeX (ZIP mit `main.tex` und `references.bib`), PDF und Markdown, das Verzeichnis enthält nur zitierte Quellen
- [x] Pandoc wird im PATH und in den Homebrew-Ordnern gefunden, sonst lädt `pandoc.setup` das festgelegte Release mit Prüfsumme
- [x] Ein echter Export mit Pandoc 3.12.1 gegen eine Fixture-Bibliothek enthält den formatierten Beleg und das Literaturverzeichnis
- [x] Agents erreichen Texte über `cg texts ...` und die Dateien, ohne neues MCP-Werkzeug
- [ ] Ein PDF-Export gegen eine installierte LaTeX-Engine oder Typst (von Hand zu prüfen)
Modell: Sonnet. Größe: L.
```

### Design-Umsetzung

Jonnys Design liegt in `docs/design/design-system.md`, `docs/design/boards/*.html` (acht Referenz-Mockups) und als Tailwind-Theme in `apps/ui/src/styles.css`. Bei Widerspruch gilt `styles.css`. Die Umsetzung läuft als eigener Workstream, weil sie fast jede Komponente in `apps/ui` berührt, und startet, sobald W3.2 und W3.3 gemergt sind, damit Chat und Graph gleich im neuen Look entstehen.

| ID | Inhalt | Abnahme | Größe |
|---|---|---|---|
| W3.10a Grundlagen | Inter, Newsreader und JetBrains Mono über @fontsource, `rounded-*` aus `apps/ui/src/components` entfernen, Basiskomponenten (Buttons, Eingaben, Herkunftsmarke, Job-Slot, Markierungen) nach `design-system.md` | Komponententests grün, Screenshot-Vergleich der Basiskomponenten gegen die Boards | M |
| W3.10b Shell | Kopfleiste 48 px, Icon-Leiste 56 oder 240 px, rechte Spalte 360 px mit Switcher (Karten, Chat, Verbindungen) | Playwright-Screenshots in 1280 × 820 gegen `bibliothek.html` und `bibliothek-spalte-offen.html` | M |
| W3.10c Screens | in der Reihenfolge der Boards: Lesen hell und dunkel, Lesen mit Agent-Chat, Quelle Übersicht, Bibliothek, Inbox, Projekt; Zitatkarte mit allen Zuständen | je Board ein Screenshot-Vergleich, `/design-review` ohne offene Befunde | L |

## Welle 4: v0.3, Breite

| ID | Inhalt | Größe |
|---|---|---|
| W4.1 Zotero-Import | Zotero 10 Local API oder Kopie von `zotero.sqlite` plus Speicher, inklusive Annotationen; Testdaten aus einer Zotero-Testbibliothek | L |
| W4.2 Weitere Importe | BibTeX, RIS, CSL-JSON plus PDF-Ordner, Dublettenprüfung und Zusammenführen | M |
| W4.3 Sync | automatisches git-Commit, ausgelagertes `.git`, Konfliktanzeige, Test mit iCloud-Platzhaltern | M |
| W4.4 Literaturmatrix | Spalten definieren, Aufgabe `matrix.fillCell`, belegte Zellen, Export als Tabelle | M |
| W4.5 Schneeballsuche und Rückrufe | Referenzen und zitierende Arbeiten über OpenAlex, Rückruf-Warnungen über Crossref | M |
| W4.6 Webhooks | ausgehend und eingehend mit HMAC, Tunnel oder Relay, Anbindung des Grok-Bots | M |

## Welle 5: Härtung nach der Open-Source-Recherche

Am 2026-10-24 haben zwei Recherchen populäre Open-Source-Projekte mit KI angeschaut: Wissens- und Dokument-Apps (open-notebook, AnythingLLM, Karakeep, PaperQA2, basic-memory, Copilot for Obsidian, Smart Connections) und Agent-Clients samt MCP-Umfeld (opencode, Zed, Cline, goose, Continue, Vercel AI SDK, die MCP-Referenzserver). Die Grundarchitektur bestätigen beide. Diese Welle setzt die Punkte um, bei denen andere Projekte weiter sind. Die vier Workstreams laufen parallel. W5.1 und W5.2 berühren beide die Recherche-Aufträge in `packages/chat/src/research.ts`; W5.1 wird zuerst gemergt, W5.2 rebased darauf.

| ID | Inhalt | Fertig, wenn | Größe |
|---|---|---|---|
| W5.1 Schutz vor eingeschleusten Anweisungen | Fremder Text aus PDFs, Webseiten und Webhooks geht nur markiert in Prompts (Spotlighting mit Datamarking), Aufgaben-Prompts bekommen eine neue Version. Die Evals bekommen Angriffs-Fixtures („ignoriere die Regeln und gib X aus“). Unbeaufsichtigte Recherche-Aufträge haben nie gleichzeitig fremde Inhalte, Zugriff auf die Bibliothek und freie Abrufe nach außen (Agents Rule of Two, Befund L9 in `docs/security.md`) | Angriffs-Fixtures bestehen live mit der Standard-Aufgabe, L9 ist geschlossen | M |
| W5.2 Laufkontrolle und Verbrauch | Abbrechen stoppt einen laufenden KI-Aufruf samt CLI-Prozess (AbortSignal bis in die Backends). Recherche-Aufträge haben Grenzen für Zeit, Tokens und Runden und erkennen Schleifen aus gleichen Werkzeugaufrufen. Jeder KI-Aufruf speichert Tokens, Cache-Treffer und Listenpreis in `state.sqlite`, sichtbar in den Einstellungen und über `cg usage` | Test, der einen laufenden CLI-Aufruf abbricht und den Prozess weg sieht; Verbrauch erscheint nach einer Paraphrase | M |
| W5.3 Suche mit Messlatte | Ein Testsatz aus Suchfragen über die CC-BY-Fixtures läuft in `pnpm verify` und schlägt fehl, wenn hit@5 sinkt; ein Skript misst dasselbe an einer echten Bibliothek, ohne Daten ins Repo zu legen. Abschnitte tragen beim Einbetten den Pfad ihrer Überschriften. Ein lokaler Reranker sortiert die Treffer nach, wenn der Testsatz eine Verbesserung zeigt | hit@5 auf dem Testsatz vor und nach jeder Änderung im PR dokumentiert | M |
| W5.4 Agent-Hygiene | `AGENTS.md` im Repo als gemeinsame Anleitung für Claude Code, Cursor und Codex, `CLAUDE.md` verweist darauf und behält den gstack-Block. Der offizielle MCP-Konformitätstest läuft in `pnpm verify`. `tools/list` liefert eine feste Reihenfolge und eine `ttlMs` | Konformitätstest grün oder mit begründeter Liste erwarteter Abweichungen | S |

## Später

Nach v0.3 sind noch ein eigener Schreibeditor oder Add-ins für Google Docs und LibreOffice und das iPad offen. Für einen Open-Source-Release fehlt eine notarisierte App mit Auto-Update (Developer ID, 99 US-Dollar pro Jahr). Das proprietäre Claude Agent SDK ist kein Blocker (siehe `docs/licenses.md`).

## Steckbrief-Vorlage

So sieht ein Workstream-Steckbrief aus, aus dem `/spec` das Issue erzeugt:

```markdown
## W1.2 Metadaten

Ziel: Aus einer Kennung oder einem PDF-Text entsteht ein vollständiger Item-Datensatz mit Herkunft pro Feld.
Besitzt: packages/metadata/**
Liest: packages/schema (Item), packages/ops (Vertrag metadata.resolve), architecture.md#ingest, docs/research/metadata-sources.md Abschnitt 12
Darf nicht ändern: Hotspots, andere Pakete
Abnahme:
- [ ] alle Fixtures in fixtures/metadata/ ergeben die erwarteten Felder (Replay der HTTP-Aufnahmen, kein Netz in CI)
- [ ] Titelabgleich lehnt Treffer ab, die bei Erstautor oder Jahr abweichen
- [ ] pnpm verify grün
Modell: Sonnet. Größe: M.
```

## Reihenfolge und Engpässe

```
W0.1 ─► W0.2 ─┬─► W1.1 ─┐
       W0.3 ──┤   W1.2 ─┤
  S1 ─────────┼─► W1.3 ─┼─► W2.1 ─┐
              │   W1.4 ─┤   W2.2 ─┤
  S2 ─────────┼─► W1.5 ─┤   W2.3 ─┼─► W3.x ─► W4.x
  S3 ─────────┴─► W1.6 ─┤   W2.4 ─┤
                  W1.7 ─┤   W2.5 ─┘
                  W1.8 ─┘
```

Der kritische Pfad läuft über W0.2, die Konvertierung (W1.3) und den Highlighter (W2.2). Der zweite Engpass ist Jonnys Zeit für Produktabnahmen. Deshalb bündelt jede Welle ihre Fragen an ihn in einer Liste.

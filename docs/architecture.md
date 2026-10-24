# citegeist: Architektur

Stand: 2026-10-23, Entwurf zur Abstimmung. Die Belege stehen in `docs/research/`, die Entscheidungen in `docs/decisions.md`.

## Überblick

```
 ┌──────────────── citegeist.app (Electron 45) ────────────────┐
 │  Renderer (React): Bibliothek · Reader · Notizen · Graph ·  │
 │  Projekte · Inbox · Chat-Seitenleiste · Einstellungen       │
 │  Main: Fenster, Menü, globaler Hotkey, Zwischenablage       │
 └───────────────┬─────────────────────────────────────────────┘
                 │ oRPC über 127.0.0.1 (HTTP + WebSocket)
 ┌───────────────▼─────────── citegeist-core (Node 24) ────────┐
 │  Operations-Registry ──► RPC (UI) · MCP (Agents) · CLI (cg) │
 │  Dienste: Items · Ingest · Dokumente · Zitatkarten ·        │
 │           Notizen/Graph · Projekte · Zitieren · Suche ·     │
 │           Jobs · Agent-Sitzungen · Connectoren              │
 │  Speicher: Bibliotheksordner (Wahrheit) + SQLite (Index)    │
 └──┬──────────────┬─────────────────┬────────────────┬───────┘
    │ JSON-RPC     │ HTTP            │ Subprozess/ACP │ HTTPS
    ▼ stdio        ▼ localhost       ▼                ▼
 Python-Worker   translation-     Claude Code,      Crossref, OpenAlex,
 (Docling,       server (AGPL,    Codex, Cursor     arXiv, DNB, K10plus,
 GROBID, OCR)    optional)        (eigenes Abo)     Unpaywall, API-Anbieter
```

Die Architektur folgt drei Regeln. Der Kern ist ein eigener Prozess und gehört niemandem exklusiv: App, CLI und MCP-Clients sind gleichrangige Clients. Dateien im Bibliotheksordner sind die Wahrheit, SQLite ist ein Index, der sich jederzeit neu aufbauen lässt. Jede Fähigkeit ist genau einmal als Operation definiert und erscheint automatisch auf allen drei Zugängen.

## Prozesse

| Prozess | Rolle | Lebensdauer |
|---|---|---|
| `citegeist-core` | Besitzt die Bibliothek, einziger Schreiber in den Index, führt Jobs aus, stellt RPC, MCP-HTTP und Events bereit | Läuft, solange App oder CLI ihn brauchen. Optional als launchd-Agent dauerhaft, damit Agents nachts arbeiten können |
| Electron-App | Oberfläche, startet den Kern als `utilityProcess` oder verbindet sich mit einem laufenden | Solange das Fenster offen ist |
| `cg` (CLI) | Spricht mit dem laufenden Kern, startet ihn bei Bedarf headless | Pro Aufruf |
| `cg mcp` | stdio-Shim für MCP-Clients, leitet an den Kern weiter | Pro MCP-Client |
| Python-Worker | Konvertierung, OCR, GROBID-Aufrufe; per `uv` in Application Support installiert, Modelle in festen Versionen beim ersten Gebrauch | Vom Kern gestartet, beendet sich bei Leerlauf |
| Pandoc | Export von Texten nach Word, LaTeX, PDF und Markdown (D20); GPL-2.0, daher nur als eigener Prozess; aus `PATH` und Homebrew oder als festes Release auf Wunsch geladen | Pro Export |
| translation-server | Zoteros Web-Übersetzer für URL-Import ohne Browser, AGPL, nur als eigener Prozess | Optional, bei Bedarf |
| Agent-CLIs | Inferenz über das Abo des Nutzers | Vorgewärmter Pool plus Sitzungen |

Ein Kern pro Bibliothek: `~/Library/Application Support/citegeist/<library-id>/core.lock` hält PID und Port. Wer startet, prüft zuerst den Lock und verbindet sich mit dem laufenden Kern.

Der Kern nimmt den Aufrufer aus dem Header `x-citegeist-actor` (`human`, `system` oder `agent:<name>`). Ohne Header handelt der Aufruf als `human`, so spricht die Oberfläche der App. Ein ungültiger Wert wird mit 400 abgelehnt. `GET /health` meldet mit `actors: true`, dass der Kern den Header kennt; `cg` leitet Schreibzugriffe von Agents nur an einen Kern weiter, der das meldet. Läuft keine App, öffnet `cg mcp` die Bibliothek als Kern: Es nimmt `core.lock`, bedient denselben HTTP-Endpunkt, und die App, die danach startet, verbindet sich mit ihm. Einmalige `cg`-Kommandos nehmen den Lock nicht.

## Operations-Registry

Jede Fähigkeit ist eine Operation mit Name, Zod-Schema für Ein- und Ausgabe, Zugriffsklasse und Handler:

```ts
export const addItem = defineOperation({
  name: "items.add",
  summary: "Add an item by DOI, arXiv ID, ISBN, PMID, URL or file path",
  access: "write",               // read | write | admin
  input: AddItemInput,           // Zod 4
  output: AddItemResult,
  handler: async (ctx, input) => { /* ... */ },
});
```

Daraus entstehen ohne Zusatzcode die oRPC-Prozedur für die Oberfläche, das CLI-Kommando `cg items add` mit `--json` und, für eine kuratierte Teilmenge, ein MCP-Tool. `ctx.actor` trägt, wer aufruft (`human`, `agent:<name>`, `system`), und landet als Herkunft an jedem geschriebenen Objekt.

Fehler folgen dem Vertrag für agent-taugliche Fehlermeldungen aus gstack: Sie nennen, was mit welchen Werten fehlschlug, enthalten auf der ersten oder letzten Zeile einen sicheren Fix, beschreiben Wiederholbarkeit und Nebenwirkungen und tragen einen stabilen Code. Im MCP-Kanal heißt das `isError: true`, in der CLI ein eigener Exit-Code mit `--json`-Form.

## Bibliotheksordner

```
~/Citegeist/                              Bibliothek, syncbar (iCloud, Dropbox, git)
  AGENTS.md                               Regeln für Agents, von citegeist erzeugt und gepflegt
  CLAUDE.md                               Verweis auf AGENTS.md
  citegeist.json                          Manifest: Format-Version, Bibliotheks-ID, geteilte Einstellungen
  items/
    luhmann1984soziale/                   ein Ordner pro Quelle, benannt nach Citekey
      luhmann1984soziale.md               Frontmatter: Metadaten (CSL-kompatibel). Text: Literaturnotiz
      sources/3f9a1c2e7b4d.pdf            Originale, benannt nach SHA-256, unveränderlich
      derived/3f9a1c2e7b4d/               pro Quelldatei
        manifest.json                     Pipeline, Werkzeug- und Modellversionen, Qualitätsflags
        pages.json                        PDF-Index, gedruckte Seite, Herkunft der Seitenzahl, OCR ja/nein
        blocks.jsonl                      kanonisches Blockmodell, eine Zeile pro Block
        idmap.json                        Weiterleitungen alter Block-IDs nach Neukonvertierung
        refs.jsonl                        Literaturverzeichnis des Papers, mit Blöcken verknüpft
        doc.md                            Agent-Ansicht mit Seitenmarken und ^block-IDs
        doc.html                          Lese-Ansicht
        assets/                           Abbildungen, benannt nach Block-ID
      cards/
        c_01JB8Z3Q.md                     eine Zitatkarte pro Datei
  notes/
    autopoiesis-erklaert-stabilitaet.md   Zettel mit Frontmatter und Wiki-Links
    concepts/
      autopoiesis.md                      Begriff (type: concept) mit Aliasen, Karten und Einträgen pro Quelle
  projects/
    phd-proposal/
      project.md                          Projektbrief, Forschungsfragen, Leseliste
      exports/phd-proposal.bib            automatisch aktualisiert
      exports/phd-proposal.json           CSL-JSON, automatisch aktualisiert
      texts/kapitel-2.md                  Text mit Pandoc-Zitaten (D20)
      exports/kapitel-2.docx              Export des Texts über Pandoc
  chats/                                  gespeicherte Agent-Gespräche
```

Rechnerlokal unter `~/Library/Application Support/citegeist/<library-id>/` liegen `index.sqlite` (Suche, Graph, Vektoren), `state.sqlite` (Jobs, Einstellungen dieses Rechners), Logs, Caches, die Python-Umgebung und die Modelle. Nichts davon gehört in einen synchronisierten Ordner.

Der Ordner ist ein gültiger Obsidian-Vault. Die Literaturnotiz heißt wie der Citekey, damit `[[luhmann1984soziale]]` in Obsidian und in citegeist auf dieselbe Datei zeigt. `[[luhmann1984soziale#^b7f3k2q]]` verlinkt einen Absatz des Volltexts, `![[c_01JB8Z3Q]]` bettet eine Zitatkarte ein.

### Schreiben in den Ordner

Der Kern schreibt atomar (temporäre Datei, dann `rename`) und aktualisiert den Index sofort. Ein Watcher (`@parcel/watcher`) erkennt Änderungen von außen, etwa wenn ein Agent eine Notiz direkt bearbeitet oder iCloud eine Datei bringt, validiert sie gegen das Schema und indiziert neu. Eigene Schreibvorgänge erkennt er am Hash. Ungültige Dateien landen in einer Problemliste, die Oberfläche und MCP anzeigen. iCloud-Platzhalter (ausgelagerte Dateien) lädt der Kern bei Bedarf nach.

Konvertierte Dateien unter `derived/` sind nur für den Kern beschreibbar. `AGENTS.md` sagt das, und der Watcher stellt den Stand bei fremden Änderungen wieder her.

## Datenmodell

Alle Schemas leben als Zod-4-Definitionen in `packages/schema` und werden als JSON Schema für Agents und den Python-Worker exportiert.

### Item

Frontmatter der Literaturnotiz. Die Feldnamen folgen CSL-JSON in der YAML-Form, die auch Pandoc liest. Die Typen und Felder kommen aus dem Zotero-Schema, das als versionierte Daten eingebunden ist (37 Typen, 121 Felder, CSL-Abbildung inklusive).

```yaml
id: 01JB8Z3QK7...            # ULID, unveränderlich
citekey: luhmann1984soziale  # stabil, nur per expliziter Umbenennung änderbar
type: book
title: Soziale Systeme
subtitle: Grundriß einer allgemeinen Theorie
author: [{family: Luhmann, given: Niklas}]
issued: 1984
publisher: Suhrkamp
publisher-place: Frankfurt am Main
ISBN: "9783518282663"
language: de
ids: {gnd: "...", openalex: W..., doi: null, arxiv: null}
tags: [systemtheorie]
projects: [phd-proposal]
status: read                 # inbox | unread | reading | read
provenance:                  # pro Feld: Quelle und Zeitpunkt
  title: crossref@2026-10-23
  abstract: openalex@2026-10-23
created: {at: 2026-10-23T10:12:00Z, by: human}
```

Citekeys folgen einer Formel im Stil von Better BibTeX (Standard: Nachname, Jahr, erstes Titelwort). Ein Key entsteht einmal und wird nicht still neu berechnet. Eine Umbenennung schreibt alle Wiki-Links und Kartenverweise um. Eine Ausnahme gibt es für Platzhalter: Entsteht der Key aus einem fehlenden Autor oder Jahr (`anonnddemos`), ersetzt ihn der Kern nach einer erfolgreichen Konvertierung durch den Key aus den besseren Daten, sofern weder Karten noch Links auf den Eintrag verweisen.

Ein Eintrag, dessen Import scheitert, bleibt mit dem Feld `incomplete` (Code, Meldung, Zeitpunkt, Job) im Frontmatter stehen. `items.get`, `items.list`, die Problemliste, die Oberfläche und MCP zeigen ihn an. Ein Anhängen oder erneutes Hinzufügen einer funktionierenden Datei, `documents.convert` oder das Löschen beseitigen den Zustand. Eine erfolgreiche Konvertierung entfernt das Feld.

Zwei weitere Zustände eines Eintrags sind getippte Felder im Frontmatter. `fulltext` (`status: found | missing`, `tried` mit den geprüften Quellen, `checked_at`) hält fest, ob die Volltextsuche nach dem Hinzufügen per DOI eine Datei gefunden hat; `items.list` meldet es als Flag, und die Tabelle zeigt bei `missing` den Hinweis „ohne Volltext“. `proposal` (`status`, `source`, `reason`, `candidates`) markiert Metadaten, die nur geraten sind (erste Seite, Dateiname, Webseite) und auf eine Prüfung warten. Ältere Dateien, die `fulltext` noch als `status: none` mit `at` führen, liest der Kern in der neuen Form und schreibt sie beim nächsten Speichern um.

### Dokument

`blocks.jsonl` ist die kanonische Form eines konvertierten Dokuments. Jeder Block trägt eine einmal vergebene ID, Typ, Abschnitt, Text und Spans mit PDF-Seite, gedruckter Seite, Zeichenbereich und Koordinaten im Koordinatensystem des Original-PDFs:

```json
{"id":"b7f3k2q","type":"paragraph","sec":"2.1","flow":"body",
 "text":"...","spans":[{"page":4,"label":"215","start":0,"end":812,"bbox":[72.0,310.2,290.1,520.7]}],
 "src":{"engine":"docling@2.142.1","native":"#/texts/57"}}
```

Bei einer Neukonvertierung ordnet der Kern neue Blöcke über Seitenüberlappung, Koordinaten und Textähnlichkeit den alten zu und übernimmt deren IDs. Die Zuordnung landet in `idmap.json`, damit Links und Karten weiter auflösen. `doc.md` und `doc.html` sind daraus abgeleitet.

Gedruckte Seitenzahlen kommen in dieser Reihenfolge: aus `/PageLabels` im PDF, aus erkannten Kopf- und Fußzeilen (längste aufsteigende Zahlenfolge, wie Zotero es macht), aus dem Seitenbereich bei Crossref als Versatz. Der Nutzer kann die Zuordnung einmal pro PDF bestätigen oder korrigieren, und alle Karten dieses PDFs folgen.

### Zitatkarte

Eine Markdown-Datei pro Karte, damit zwei Rechner gleichzeitig markieren können, ohne dass git oder iCloud Konflikte erzeugen, und damit Obsidian Karten einbetten kann.

```markdown
---
id: c_01JB8Z3Q
item: luhmann1984soziale
source: 3f9a1c2e7b4d
kind: definition             # optional: thesis | finding | method | definition | example | critique
locator: {label: page, start: "31", end: "32"}
anchor:
  pdf: {page: 42, quads: [[72.0, 310.2, 290.1, 330.0]], file: 3f9a1c2e7b4d}
  text: {block: b7f3k2q, exact: "…", prefix: "…", suffix: "…"}
quote_sha256: 9c1d…         # Hash des Wortlauts, Abweichungen werden markiert
paraphrase: {by: "claude-code/haiku", at: 2026-10-23T11:02:00Z, checked: false}
tags: [kommunikation]
projects: [phd-proposal]
created: {at: 2026-10-23T11:01:40Z, by: human}
---
> Exakter Wortlaut der markierten Stelle …

## Paraphrase
…

## Note
…
```

Der Wortlaut steht im Zitatblock und bleibt unverändert, Auslassungen wie „[…]“ sind explizite Bearbeitungen. Die Karte trägt einen AI-Text, die Paraphrase mit einem bis drei Sätzen (D15), und die Paraphrase trägt ihre Herkunft. Die Art (D16) kommt aus derselben Anfrage wie die Paraphrase: Die AI ordnet die Karte beim Anlegen einer Art zu, der Nutzer ändert sie jederzeit, und eine gesetzte Art überschreibt die AI beim Neuschreiben nie. Der Abschnitt „Note“ (D17) ist ein freies Feld des Nutzers. Die Abschnitte haben feste Überschriften, die ein strenger Parser liest. Unbekannte Abschnitte bleiben erhalten. Welche Teile beim Export mitkommen, legt eine Einstellung pro Projekt fest. Die Regel `own-else-ai` nimmt für sinngemäße Zitate die Notiz, sonst die Paraphrase.

Karten aus früheren Fassungen bleiben lesbar. Der Parser liest die Abschnitte „In my words“ und „Comment“ als Notiz (eigene Worte, Leerzeile, Kommentar) und schreibt beim nächsten Speichern nur noch „Note“. Die Arten `quote` und `comment` gelten als nicht gesetzt, die übrigen alten Arten gelten unverändert. Ein gespeicherter Abschnitt „Core statement“ mit seinem Stempel `core` bleibt beim Umschreiben erhalten, die Oberfläche zeigt ihn nirgends, und die Suche liest ihn nicht.

Die Karte in der Oberfläche besteht aus Kopfzeile (Art und Belegstelle), Wortlaut, Paraphrase-Block, Notiz und zwei Aktionen. Der Paraphrase-Block trägt Stern und Titel, Modell und Zeit stehen in einem Tooltip, und die kleine Aktion „Neu schreiben“ mit der Sprachwahl sitzt in seiner Kopfzeile. „Wörtlich zitieren“ kopiert das Zitat mit Beleg, „Sinngemäß zitieren“ kopiert die Notiz oder die Paraphrase mit „vgl.“-Beleg.

Die Auswahl im Reader rastet an Wortgrenzen ein. `packages/anchoring` rückt beide Ränder einer Auswahl nach außen, bis sie nicht mehr in einem Wort stehen (`snapToWordBoundaries`, ein Apostroph zwischen Buchstaben gehört zum Wort, ein Bindestrich nicht), und der Textanker entsteht aus dem erweiterten Bereich (`createSelectionAnchor`). Der PDF-Viewer und der Textviewer setzen die sichtbare Auswahl auf denselben Bereich, sobald der Zeiger losgelassen ist, und die Vierecke des PDF-Ankers folgen dem erweiterten Bereich.

Die Karte hat zwei Anker: einen PDF-Anker (Seite, Vierecke, Datei-Hash) im Zotero-kompatiblen Positionsformat und einen Textanker nach W3C (exakter Text, Kontext davor und danach, Block-ID als Hinweis). Fehlt ein Anker nach einer Neukonvertierung, sucht der Kern die Stelle unscharf wie der Hypothesis-Client.

### Notiz und Verbindung

```yaml
id: n_01JB9...
type: permanent              # permanent | literature | question | claim | project
title: Autopoiesis erklärt die Stabilität sozialer Systeme
links:
  - to: "[[luhmann1984soziale]]"
    rel: supports
    why: Kap. 1 begründet …
    evidence: "[[c_01JB8Z3Q]]"
    by: agent:claude-code
    status: proposed         # proposed | accepted | rejected
```

Verbindungen dürfen untypisiert bleiben. Ein Typ wird vorgeschlagen und vom Nutzer angenommen. Eine abgelehnte Verbindung bleibt mit `status: rejected` in der Datei, damit `links.propose` sie nicht noch einmal vorschlägt. Der Index kennt sie nicht, sie erscheint weder in Rückverweisen noch im Graphen. Das Vokabular ist klein und auf die Zitations-Ontologie CiTO abbildbar:

| Gruppe | Relationen |
|---|---|
| Argument | `supports`, `opposes`, `qualifies`, `addresses` (bezieht sich auf eine Forschungsfrage) |
| Herkunft | `extends`, `uses-method-of`, `uses-data-from` |
| Struktur | `elaborates` (Folgezettel im Sinne Luhmanns), `related` als Rückfall |
| Automatisch | `cites`, `excerpt-of`, `derived-from` |

Der Graph ist die Vereinigung aus den Verbindungen in Notizen, den Wiki-Links und den Zitationsbeziehungen aus `refs.jsonl` und OpenAlex. Der Index hält ihn als Kantentabelle, Abfragen laufen über rekursive CTEs in SQLite.

### Projekt

`project.md` trägt im Frontmatter Titel, Status, Forschungsfragen mit IDs und den Zitierstil, im Text den Projektbrief. Die Zugehörigkeit einer Quelle steht im Item (`projects:`), damit ein Agent sie mit einem einzigen Lesezugriff sieht. Agents bekommen den Brief bei jeder Projektaufgabe als Kontext.

### Texte

Ein Text (D20) ist eine Markdown-Datei unter `projects/<slug>/texts/`, das Format steht in `docs/spec/library-format.md`. Der Kern liest Zitate mit dem Scanner in `packages/schema` (`scanCitations`), den auch der Editor für seine Markierungen nutzt. `texts.export` schreibt in einen Arbeitsordner den Text, die CSL-Datei des Stils, die zitierten Quellen als CSL-JSON und als `.bib`, ruft Pandoc auf und legt das Ergebnis in `exports/` ab. Word, PDF und Markdown setzt `--citeproc`. LaTeX behält die Zitate als biblatex-Befehle und kommt als ZIP mit `references.bib`. Für PDF sucht der Kern xelatex, lualatex, tectonic, pdflatex oder Typst. Pandoc findet er im `PATH`, in Homebrew oder in `<lokaler Ordner>/pandoc/<Version>/`, wohin `pandoc.setup` das festgelegte Release lädt.

## Ingest

```
Eingabe ──► Erkennen ──► Metadaten ──► Quelle holen ──► Konvertieren ──► Anreichern ──► Index
```

- **Eingabe:** PDF, DOI, arXiv-ID oder Link, ISBN, PMID, URL, BibTeX-Schnipsel, Zotero Connector, MCP.
- **Erkennen:** DOI, arXiv-ID und ISBN per Regex auf den ersten Seiten und aus XMP. Danach GROBID-Kopfdaten mit Titelabgleich, akzeptiert nur bei Übereinstimmung von Titelähnlichkeit, Erstautor, Jahr (plus minus eins) und Typ. Ein Suchscore allein reicht nicht. Zuletzt liest ein LLM die erste Seite und schlägt CSL-Felder vor, die als Vorschlag markiert bleiben.
- **Metadaten:** Für Zitierfelder (DOI, Jahr, Typ, Seiten, Titel, Autorenreihenfolge) gewinnt der Datensatz der Registrierungsagentur (Crossref, DataCite über doi.org). OpenAlex ergänzt ORCIDs, Institutionen, Themen und Referenzen, Abstracts kommen aus der Quelle, die einen hat. Bücher kommen von DNB und K10plus, Open Library ist der Rückfall. Eingaben des Nutzers gewinnen immer. Alle Abfragen laufen über einen gemeinsamen Client mit Cache und Ratenbegrenzung pro Quelle.
- **Quelle holen:** freie PDFs über Unpaywall, arXiv und OpenAlex, arXiv-HTML, wo es existiert.
- **Konvertieren:** Python-Worker, siehe unten. Nach einer erfolgreichen Konvertierung liest der Kern bei geratenen Metadaten (Platzhaltertitel, fehlender Autor, Review-Marke) die erste Seite der PDF erneut: Kennungen, dann `metadata.fromFirstPage` mit Titelabgleich. Bestätigte Werte ersetzen die geratenen, Werte von Nutzern und Registrierungsagenturen bleiben unberührt.
- **Anreichern:** Referenzen, Zitationsgraph, Embeddings, eine AI-Zusammenfassung und eine Einschätzung der Relevanz für jedes Projekt.

Eine URL wird wie von einem Browser abgerufen (Weiterleitungen, Browser-Kopfzeilen) und nach ihrem Inhalt beurteilt: Beginnt die Antwort mit `%PDF`, wird sie wie eine lokale PDF behandelt, auch wenn Adresse oder Content-Type etwas anderes sagen. Liefert eine Adresse, die auf eine Datei zeigt, eine Webseite (Login, Cookie- oder Bot-Sperre), scheitert der Aufruf mit `URL_RETURNED_HTML` und der Aufforderung, die Datei herunterzuladen und ihren Pfad zu übergeben.

Ein Duplikat ist ein Treffer auf DOI, ISBN, arXiv-ID, PMID, URL oder Datei-Hash, ersatzweise auf vollständigen Titel mit Jahr und Erstautor. Hat der getroffene Eintrag keine funktionierende Quelle, hängt der Kern die neue Datei an und konvertiert sie, statt sie zu verwerfen.

Was ein Agent hinzufügt, landet zuerst in der Inbox, dort übernimmt oder verwirft Jonny es. Mit `target: "library"` legt ein Agent ein Paper direkt in die Bibliothek. Was Jonny selbst hinzufügt, landet immer direkt in der Bibliothek (D7).

Jeder Schritt ist ein Job in `state.sqlite` mit Status, Fortschritt und Wiederholung. Langsame Arbeit gibt über MCP sofort einen Job-Handle zurück, den Status liefert `jobs.get`.

### Konvertierung

| Pfad | Wann | Werkzeuge |
|---|---|---|
| arXiv | arXiv-HTML existiert (etwa 97 Prozent der Paper) | LaTeXML-HTML bereinigen, Seiten über die Sprungziele im arXiv-PDF zuordnen |
| Digital | PDF mit Textebene | Docling (MIT) für Layout und Blöcke, GROBID 0.9 (nativ auf Apple Silicon) für Kopfdaten und Referenzen |
| Scan | keine oder schlechte Textebene | OCRmyPDF mit Apple Vision, das Deutsch kann. Seiten, die der schnelle Pfad als schlecht markiert, gehen an ein lokales VLM (PaddleOCR-VL oder MinerU2.5-Pro) |
| Web | Artikel, graue Literatur | Readability oder defuddle, dann dasselbe Blockmodell ohne Seiten |

Cloud-APIs für OCR gibt es nur auf ausdrücklichen Wunsch. Welche Werkzeuge im Pfad „Digital“ tatsächlich gewinnen, entscheidet ein Spike auf 15 Fixture-PDFs mit festen Kriterien (Plan in `docs/research/document-conversion.md`, Abschnitt 9.3).

## AI-Schicht

### Backends

Eine Schnittstelle mit zwei Aufrufformen:

```ts
interface InferenceBackend {
  complete<T>(req: { task: string; prompt: string; schema: ZodType<T>; model?: string }): Promise<T>;
  session(req: { system: string; mcpServers: McpConfig[]; cwd: string }): AgentSession;
}
```

| Backend | Weg | Zweck |
|---|---|---|
| Claude Code | Claude Agent SDK, Pool aus ein bis zwei vorgewärmten Prozessen (`startup()`), strukturierte Ausgabe über `outputFormat`, `settingSources: []`, feste Claude-Code-Version | Highlighter, Extraktion, Recherche-Jobs |
| Codex | `codex app-server` als langlebiger JSON-RPC-Prozess, `codex exec --output-schema` für Einzelaufrufe | dieselben Aufgaben |
| Cursor | `agent -p --output-format stream-json`, Struktur über Prompt und Validierung, `agent acp` für Chat | Chat und Recherche |
| ACP-Agents | citegeist als ACP-Client, eigener MCP-Server pro Sitzung übergeben, Umgebung des Nutzers nach A11 | Chat-Seitenleiste mit jedem ACP-fähigen Agent |
| API-Key | Anthropic, OpenAI, OpenRouter, xAI | Option pro Aufgabe |
| Lokal | Ollama, MLX, LM Studio über OpenAI-kompatible Endpunkte | Option pro Aufgabe |

Zwei Punkte aus der Recherche bestimmen die Konfiguration. `claude -p --bare` liest nur API-Keys und ignoriert das Abo, und laut Doku wird es künftig Standard für `-p`. citegeist pinnt deshalb die Claude-Code-Version und testet das Abo-Login in CI. Ohne `settingSources: []` lädt jede Sitzung die persönliche `~/.claude`-Konfiguration des Nutzers mit. Das ist für Inferenz-Aufgaben und Recherche-Jobs gewollt und bleibt so.

### Chat-Agents arbeiten in der Umgebung des Nutzers

Für Chat-Sitzungen gilt A11 statt der Isolation. Der Agent der Seitenleiste bekommt dieselbe Umgebung wie das Claude Code des Nutzers:

| | Standard | Einstellung „Isolierter Agent" |
|---|---|---|
| Claude Code (ACP-Adapter) | `settingSources: ["user", "project"]`, Shell erlaubt, MCP-Server des Nutzers geladen | `settingSources: []`, `strictMcpConfig`, Shell gesperrt |
| Claude Code (Rückfall `claude -p`) | `--setting-sources user,project`, `Bash` erlaubt | `--strict-mcp-config`, keine Einstellungen, `Bash` gesperrt |
| Codex | Codex-Konfiguration des Nutzers | gleiche Konfiguration, Berechtigungen wie unten |
| Berechtigungsregel | Shell, fremde Werkzeuge und Änderungen außerhalb der Bibliothek erlaubt | Shell und Änderungen außerhalb von Bibliothekstext und Arbeitsordner abgelehnt |

Der citegeist-MCP-Server kommt in jedem Fall pro Sitzung dazu, mit eigenem Write-Token. Im Bibliotheksordner bleiben `derived`, `sources`, `exports` und `citegeist.json` auch in der Umgebung des Nutzers geschützt. Recherche-Aufträge laufen immer isoliert. Die Einstellung liegt in `settings.json` unter `chat.isolated` und wirkt ab dem nächsten Beitrag einer Sitzung.

### Aufgaben

Die Sprache aller AI-Texte (Paraphrase, Zusammenfassung) folgt einer Kette: Dropdown an der gerade gelesenen Quelle, sonst Projekteinstellung, sonst Bibliotheksstandard (D9). Das Dropdown ist im Reader jederzeit erreichbar.

Jede AI-Aufgabe ist ein Eintrag in `packages/ai/tasks/` mit Eingabe- und Ausgabeschema, versioniertem Prompt, Standard-Modellklasse (`fast` oder `smart`) und Eval-Fixtures. Beispiele: `card.paraphrase`, `card.verify`, `note.proposeLinks`, `item.summarize`, `item.relevance`, `metadata.fromFirstPage`, `matrix.fillCell`, `concept.describe`, `concept.name`. Das Routing (welches Backend für welche Aufgabe) ist eine Einstellung. Agentische Aufgaben (`library.ask`, `research.run`) laufen als Sitzung mit dem citegeist-MCP-Server und den Web-Werkzeugen des jeweiligen Agents. Was eine Sitzung anlegt, trägt `by: agent:<name>`.

Jede Agent-Antwort mit Zitat geht durch eine Prüfung: Ein Zitat, das zu keiner gespeicherten Stelle passt, wird markiert.

### Embeddings

Die Abos bieten keine Embeddings, deshalb laufen sie lokal mit Transformers.js. Kandidaten sind Qwen3-Embedding-0.6B und EmbeddingGemma, die Wahl fällt ein Test mit echten deutschen und englischen Anfragen. Für Ähnlichkeit auf Paper-Ebene kommen SPECTER2-Vektoren von Semantic Scholar dazu, wo es sie gibt.

## Zugänge für Agents

### MCP-Server

- TypeScript-SDK v2 (`@modelcontextprotocol/server`), Spec-Revision 2026-07-28, ältere Clients bleiben über den Kompatibilitätsmodus des SDK bedient.
- `cg mcp` als stdio-Shim für alle lokalen Clients, dazu Streamable HTTP auf `127.0.0.1` mit Bearer-Token sowie Origin- und Host-Prüfung. Für Claude Desktop gibt es zusätzlich ein `.mcpb`-Paket.
- Höchstens zwanzig Tools: `search`, `get_item`, `read_document` (nach Seite, Abschnitt oder Block), `list_cards`, `add_item`, `attach_file` (lokale Datei an einen bestehenden Eintrag hängen und konvertieren), `trash_item` (Inbox-Einträge, unvollständige Einträge und von Agents angelegte Einträge, solange keine Karte und kein Link auf sie verweist; der Papierkorbordner hält fest, wer gelöscht hat), `create_card`, `create_note`, `link`, `list_projects`, `create_project`, `get_project` (Projekt, Pläne und Gliederung in einem Aufruf), `related_works` (zitierte und zitierende Werke eines Eintrags, `direction`), `cite`, `jobs_get`, dazu die Planungswerkzeuge `edit_outline`, `edit_plan_doc`, `note_insight` und `find_insights`. Lesende Tools tragen `readOnlyHint`, jede Antwort hat einen kurzen Text plus `structuredContent`, Volltexte kommen als `resource_link`.
- Server-Anweisungen unter 4.096 Zeichen, weil Claude Code beim Start nur Tool-Namen und Anweisungen lädt.
- Fehlertexte nennen Operationen einmal unter ihrem Operationsnamen (`items.trash`). Der MCP-Server schreibt sie auf den Namen des Tools um (`trash_item`), die CLI auf das Kommando (`cg items trash`). Eine Operation ohne Tool auf der Verbindung erscheint als `cg`-Kommando mit dem Hinweis, dass der Nutzer es ausführen muss. Ein Test stellt sicher, dass jeder Operationsname in den Quellen existiert.

### CLI

`cg` deckt alle Operationen ab, mit `--json` für Agents mit Shell. Für Massenarbeit (50 DOIs importieren) ist sie sparsamer als MCP, weil der Agent die Ausgabe vor dem Lesen filtern kann.

### Skill

Ein portabler Skill unter `skills/citegeist/SKILL.md` nach der Agent-Skills-Spezifikation, aufgebaut wie ein gstack-Skill: Frontmatter mit Beschreibung und Auslösern, klare Abläufe (Paper hinzufügen, Zitatkarte anlegen, Notiz verknüpfen, Zitat erzeugen), agent-taugliche Fehler. Er sagt dem Agent, MCP zu nutzen, wenn verbunden, sonst die CLI. Verteilt wird er als Claude-Code-Plugin mit einem Agent-Plugins-Manifest daneben, und ein Symlink nach `~/.agents/skills/citegeist` erreicht Codex und Cursor.

### AGENTS.md im Bibliotheksordner

citegeist erzeugt und pflegt eine `AGENTS.md`, die das Ordnerformat erklärt und die Regeln nennt: Schreiben über `cg` oder MCP, Notiztexte dürfen direkt bearbeitet werden, `derived/` und Wortlaute in Karten bleiben unberührt, neue Inhalte tragen `by: agent:<name>`.

### Webhooks und externe Agents

Ausgehend schickt citegeist einen Auftrag mit Kontext und Rückruf-Adresse per HTTP POST, signiert mit HMAC und auf Wunsch mit dem eigenen Schlüssel der Plattform des Agents in einem Auth-Header (Wert im Schlüsselbund). Eingehend nimmt ein Endpunkt Paper und Notizen an und behandelt sie wie Eingaben über MCP: Inbox als Standard, direkt in die Bibliothek mit `target: "library"` (D7). Neben der HMAC-Signatur lässt sich pro Connector ein Bearer-Token für Agents einschalten, die keine Signatur berechnen können. Der erste Anwendungsfall ist Jonnys Grok-Bot. Webhooks sind allgemein gehalten, damit sich auch andere Agents wie Hermes anschließen lassen (D8).

Der Kern lauscht auf einem zufälligen, privaten Port. Für Aufrufe aus dem Internet öffnet er, solange ein Connector existiert, einen zweiten Listener auf `127.0.0.1` und einem festen Port (Standard 47321, einstellbar). Dieser Listener bedient nur `/hooks/<name>` und `/mcp`; ein Tunnel (Tailscale Funnel, Cloudflare Tunnel) zeigt auf ihn. Die öffentliche Adresse des Tunnels steht in den Einstellungen und wird für alle Rückruf-Adressen verwendet.

Auf `/mcp` liegt der MCP-Server des Kerns mit Streamable HTTP, derselbe Werkzeugsatz und dieselbe Implementierung wie bei `cg mcp --http`. Zugang bekommen nur Connectors, bei denen der Nutzer ihn einschaltet, mit eigenem Token im Schlüsselbund. Der Akteur ist `agent:<connector>`, Neues landet in der Inbox, `admin`-Operationen und Zugriff auf lokale Dateien sind ausgeschlossen (D21).

### Zotero-Kompatibilität

- **Connector:** Der Kern spricht optional das Connector-Protokoll auf einem einstellbaren Port, damit die offizielle Zotero-Erweiterung direkt in citegeist speichert. Die Übersetzer laufen dabei im Browser, citegeist bekommt fertige Datensätze und lädt PDFs mit den Cookies des Nutzers. Die Fallstricke (Header `X-Zotero-Version`, `filesEditable: true`, Portkonflikt mit laufendem Zotero) stehen in `docs/research/zotero-parity.md`.
- **Lese-API:** Später kann der Kern lesende Endpunkte im Format der Zotero Local API anbieten, dann funktionieren bestehende Zotero-MCP-Server und Plugins gegen citegeist.

## Suche und Index

`index.sqlite` über better-sqlite3 enthält Tabellen für Items, Personen, Kennungen, Blöcke, Karten, Notizen, Kanten, Projekte und Tags. Volltext läuft über zwei FTS5-Tabellen: eine mit vorab gestemmten Wörtern (Deutsch und Englisch, Stemming in JS vor dem Indizieren) und eine Trigramm-Tabelle für Teilwörter. Vektoren liegen in sqlite-vec. Die Suche kombiniert Volltext, Vektoren und Filter per Reciprocal Rank Fusion, optional mit einem lokalen Reranker. Jede Abfrage nennt ihren Bereich: Projekt, Sammlung oder ganze Bibliothek.

Ein vollständiger Neuaufbau liest nur den Bibliotheksordner und soll 1.000 Quellen in unter zwei Minuten schaffen.

## Sync

Siehe D5. Der Kern bietet optional ein automatisches git-Commit nach Arbeitssitzungen, damit Änderungen von Agents als eigene Commits sichtbar sind. Da jede Karte und jede Notiz eine eigene Datei ist, entstehen Konflikte nur, wenn zwei Rechner dieselbe Datei ändern. Dann legt der Kern beide Fassungen nebeneinander und meldet den Konflikt in der Problemliste.

## Sicherheit

- Alle lokalen Server binden nur an `127.0.0.1` und prüfen Origin und Host gegen DNS-Rebinding.
- Tokens für RPC und MCP-HTTP liegen in einer Datei mit Rechten 0600, MCP-Tokens haben Scopes (`read`, `write`, und `research` für unbeaufsichtigte Recherche-Aufträge).
- Die Zugriffsklasse `admin` (Einstellungen, Löschen ohne Papierkorb) ist über MCP nicht erreichbar.
- API-Keys liegen in der macOS-Keychain.
- Agent-Sitzungen laufen mit einem eigenen Arbeitsordner und ohne persönliche Agent-Konfiguration.
- Fremder Text (PDF- und Webinhalte, Metadaten, Texte von Agents und Webhooks) geht nur datamarkiert in die Prompts der AI-Aufgaben, siehe D22 und `packages/ai/src/untrusted.ts`.
- Das MCP-Token eines Recherche-Auftrags hat den Scope `research`: die lesenden Werkzeuge und `add_item`, keine lokalen Dateien, keine Adresse außerhalb der Wissenschaftsserver.

## Tech-Stack

| Schicht | Wahl | Zweitbeste Option | Ausschlaggebend |
|---|---|---|---|
| Hülle | Electron 45 | Tauri 2 | pdf.js zielt auf Chromium, der Kern ist Node, Playwright testet Electron |
| Kern | Node 24, TypeScript | | eine Sprache mit SDKs für MCP, Claude, Codex und Zitieren |
| UI | React, shadcn/ui auf Base UI, Tailwind v4 | | Agents bauen damit zuverlässig |
| RPC | oRPC | Hono RPC | typisiert, Schemas aus Zod |
| Schemas | Zod 4, JSON-Schema-Export | | eine Quelle für TS, Python und MCP |
| PDF | pdfjs-dist 6 mit eigener Markierungsebene, Floating UI | EmbedPDF | volle Kontrolle über Anker und Popover |
| Editor | CodeMirror 6 mit Live-Vorschau im Stil von Obsidian | TipTap 3 | verlustfreies Markdown, Agents bearbeiten dieselben Dateien |
| Index | SQLite (better-sqlite3), FTS5, sqlite-vec | PGlite | mehrere Leser, ausgereift, neu aufbaubar |
| Watcher | @parcel/watcher | chokidar | nativ, robust bei vielen Dateien |
| Embeddings | Transformers.js mit Qwen3-Embedding-0.6B oder EmbeddingGemma | Ollama | lokal, ohne zweiten Dienst |
| Graph | sigma.js mit graphology | Cytoscape.js | WebGL, große Graphen |
| Zitieren | citation-js mit citeproc-js, CSL-Stile, bibtex-parser | Hayagriva | Standard, deutsche Locale vorhanden |
| Konvertierung | Python mit uv, Docling, GROBID, OCRmyPDF und Apple Vision | Marker | MIT-Lizenz, Seiten und Koordinaten pro Block |
| MCP | TypeScript-SDK v2 | | stabil seit Juli 2026 |
| Monorepo | pnpm, Turborepo, Vitest, Playwright, Biome | Nx | schlank, schnelle Gates |

## Risiken und Spikes

Jede Annahme bekommt einen Test mit festem Kriterium, bevor die Arbeit darauf aufbaut. Fällt ein Test durch, greift der genannte Rückfall.

| Annahme | Test | Besteht, wenn | Rückfall |
|---|---|---|---|
| Docling und GROBID liefern Blöcke mit richtiger Seite und Lesereihenfolge | Spike auf 15 Fixture-PDFs | mindestens 95 Prozent der Blöcke auf der richtigen Seite, Lesereihenfolge in 13 von 15 PDFs korrekt, unter 60 Sekunden für 20 Seiten | Marker oder ein VLM-Pfad |
| Gedruckte Seitenzahlen lassen sich zuordnen | gleicher Spike | richtig in mindestens 90 Prozent der Journal-Artikel | Bestätigung pro PDF wird Pflicht |
| Der Highlighter ist über das Abo schnell genug | vorgewärmter Agent-SDK-Prozess, 50 Paraphrasen | p50 unter 3 Sekunden, p95 unter 6 Sekunden | Routing auf API-Key oder lokales Modell |
| Karten halten zwischen PDF- und Textansicht und über Neukonvertierungen | 200 Testmarkierungen | 98 Prozent landen in der anderen Ansicht an derselben Stelle, 95 Prozent nach Neukonvertierung | Anker auf Block-Ebene vergröbern |
| Dateien als Wahrheit vertragen gleichzeitiges Schreiben von App und Agent | Lasttest mit Watcher | kein Datenverlust, Index nach unter einer Sekunde aktuell | Schreiben nur noch über den Kern |
| Deutsche Suche findet, was sie soll | 30 echte Anfragen | relevante Treffer in den Top 5 bei 25 von 30 | anderer Stemmer oder Embeddings als Hauptsignal |
| MCP bleibt sparsam | `/context` in Claude Code | unter 1.500 Tokens beim Start | Tools zusammenlegen, Details in den Skill |

## Lizenzen

Der Kern bekommt eine permissive Lizenz. Zotero-Code (Client, Reader, translation-server, die meisten Übersetzer) steht unter AGPL und läuft nur als eigener Prozess. Das Zotero-Schema hat keine Lizenzdatei. Bis das geklärt ist, bindet citegeist es als Daten zur Laufzeit ein, statt es ins Repo zu kopieren. CSL-Stile stehen unter CC BY-SA und werden unverändert ausgeliefert. citeproc-js steht unter CPAL oder AGPL, die Pflichten zur Namensnennung prüft der Release-Schritt vor 1.0.

# Bibliotheksformat, Version 1

Die Schemas in `packages/schema/src` sind verbindlich. Diese Seite beschreibt, wo welche Datei liegt und wer sie schreiben darf. Den Hintergrund liefert `docs/architecture.md`, Abschnitt „Bibliotheksordner“.

| Pfad | Schema | Schreibt |
|---|---|---|
| `citegeist.json` | `LibraryManifest` | Kern |
| `AGENTS.md`, `CLAUDE.md` | frei | Kern (generiert) |
| `items/<citekey>/<citekey>.md` | Frontmatter `ItemFrontmatter`, Text frei (Literaturnotiz) | Kern; Agents und Menschen dürfen den Text bearbeiten |
| `items/<citekey>/sources/<hash>.<ext>` | Originaldatei, unveränderlich | Kern |
| `items/<citekey>/derived/<hash>/manifest.json` | `DerivedManifest` | Python-Worker |
| `items/<citekey>/derived/<hash>/pages.json` | `Pages` (je Seite `labelConfidence` von 0 bis 1) | Worker, Bestätigung durch den Kern |
| `items/<citekey>/derived/<hash>/blocks.jsonl` | `Block`, eine Zeile pro Block | Worker |
| `items/<citekey>/derived/<hash>/idmap.json` | `IdMap` | Worker |
| `items/<citekey>/derived/<hash>/header.json` | frei, nur wenn der Worker Kopfdaten fand | Worker |
| `items/<citekey>/derived/<hash>/refs.jsonl`, `doc.md`, `doc.html`, `assets/` | abgeleitet | Worker |
| `items/<citekey>/cards/<id>.md` | Frontmatter `CardFrontmatter`, Text `CardBody` | Kern; der Abschnitt „Note“ darf frei bearbeitet werden |
| `alerts.yaml` | wie `projects/<slug>/alerts.yaml`, für Alerts ohne Projekt | Kern, Agents, Menschen |
| `notes/<slug>.md` | Frontmatter `NoteFrontmatter`, Text frei | Kern, Agents, Menschen |
| `projects/<slug>/project.md` | Frontmatter `ProjectFrontmatter`, Text Projektbrief | Kern, Agents, Menschen |
| `projects/<slug>/alerts.yaml` | `alerts:` mit einer Liste von `AlertDef` (Name, Quelle, Intervall, Limit, Ranking). Letzter Lauf und Merkliste liegen nicht hier, sondern maschinenlokal in `alerts-state.json` | Kern, Agents, Menschen |
| `projects/<slug>/exports/*` | abgeleitet | Kern |
| `chats/<datum>-<slug>.md` | frei | Kern |

## Regeln

- Dateien sind UTF-8 mit LF. Frontmatter ist YAML zwischen `---`-Zeilen.
- Der Kern schreibt atomar über eine temporäre Datei und `rename`.
- Der Text einer Karte beginnt mit einem Zitatblock (`> `), der den Wortlaut enthält. Danach folgen die Abschnitte aus `CARD_SECTIONS` als Überschriften zweiter Ebene. `quote_sha256` ist der SHA-256 des Wortlauts nach Entfernen des Zitatpräfixes und Normalisieren der Zeilenumbrüche auf `\n`.
- Seitenmarken in `doc.md`: `<!-- page <index> label=<label> -->` auf eigener Zeile, innerhalb eines Absatzes `<!-- p:<label> -->`. Jeder Block endet mit ` ^<blockid>`.
- Seiten ohne gedruckte Seitenzahl tragen die Marken `<!-- page <index> -->` und `<!-- p:#<index> -->`. `<index>` zählt die Seiten der Datei ab 0, das `#` vor dem Index unterscheidet ihn von einer gedruckten Seitenzahl.
- Blöcke über mehrere Zeilen (Tabellen, Code, abgesetzte Formeln) tragen ihre `^<blockid>` auf einer eigenen Zeile nach einer Leerzeile. So erkennt Obsidian den Blocklink.
- `pages.json` gibt je Seite in `labelConfidence` an, wie sicher die gedruckte Seitenzahl ist. Liegt der Wert unter 0,5, fragt die App einmal nach. Der Worker schreibt dort zusätzlich `labelFlags`, `furniture` (Kopf- und Fußzeilen) und `pageRangeHint`; der Kern liest diese Schlüssel nicht.
- `header.json` enthält die Kopfdaten, die der Worker in der Quelle fand: bei einem PDF das Ergebnis von GROBID, bei einer Webseite die Metadaten, die trafilatura findet, bei arXiv-HTML den Titel. Die Datei fehlt, wenn nichts gefunden wurde, und der Worker löscht sie bei einer erneuten Konvertierung ohne Fund.
- Rechnerlokale Daten (`index.sqlite`, `state.sqlite`, Logs, Modelle) liegen unter `~/Library/Application Support/citegeist/<library-id>/`, nie im Bibliotheksordner.
- iCloud-Konfliktkopien (`<name> 2.md`) meldet der Kern als Problem und übernimmt sie nicht still.

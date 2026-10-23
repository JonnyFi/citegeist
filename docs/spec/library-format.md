# Bibliotheksformat, Version 1

Die Schemas in `packages/schema/src` sind verbindlich. Diese Seite beschreibt, wo welche Datei liegt und wer sie schreiben darf. Den Hintergrund liefert `docs/architecture.md`, Abschnitt „Bibliotheksordner“.

| Pfad | Schema | Schreibt |
|---|---|---|
| `citegeist.json` | `LibraryManifest` | Kern |
| `AGENTS.md`, `CLAUDE.md` | frei | Kern (generiert) |
| `items/<citekey>/<citekey>.md` | Frontmatter `ItemFrontmatter`, Text frei (Literaturnotiz) | Kern; Agents und Menschen dürfen den Text bearbeiten |
| `items/<citekey>/sources/<hash>.<ext>` | Originaldatei, unveränderlich | Kern |
| `items/<citekey>/derived/<hash>/manifest.json` | `DerivedManifest` | Python-Worker |
| `items/<citekey>/derived/<hash>/pages.json` | `Pages` | Worker, Bestätigung durch den Kern |
| `items/<citekey>/derived/<hash>/blocks.jsonl` | `Block`, eine Zeile pro Block | Worker |
| `items/<citekey>/derived/<hash>/idmap.json` | `IdMap` | Worker |
| `items/<citekey>/derived/<hash>/refs.jsonl`, `doc.md`, `doc.html`, `assets/` | abgeleitet | Worker |
| `items/<citekey>/cards/<id>.md` | Frontmatter `CardFrontmatter`, Text `CardBody` | Kern; der Abschnitt „In my words“ darf frei bearbeitet werden |
| `notes/<slug>.md` | Frontmatter `NoteFrontmatter`, Text frei | Kern, Agents, Menschen |
| `projects/<slug>/project.md` | Frontmatter `ProjectFrontmatter`, Text Projektbrief | Kern, Agents, Menschen |
| `projects/<slug>/exports/*` | abgeleitet | Kern |
| `chats/<datum>-<slug>.md` | frei | Kern |

## Regeln

- Dateien sind UTF-8 mit LF. Frontmatter ist YAML zwischen `---`-Zeilen.
- Der Kern schreibt atomar über eine temporäre Datei und `rename`.
- Der Text einer Karte beginnt mit einem Zitatblock (`> `), der den Wortlaut enthält. Danach folgen die Abschnitte aus `CARD_SECTIONS` als Überschriften zweiter Ebene. `quote_sha256` ist der SHA-256 des Wortlauts nach Entfernen des Zitatpräfixes und Normalisieren der Zeilenumbrüche auf `\n`.
- Seitenmarken in `doc.md`: `<!-- page <index> label=<label> -->` auf eigener Zeile, innerhalb eines Absatzes `<!-- p:<label> -->`. Jeder Block endet mit ` ^<blockid>`.
- Rechnerlokale Daten (`index.sqlite`, `state.sqlite`, Logs, Modelle) liegen unter `~/Library/Application Support/citegeist/<library-id>/`, nie im Bibliotheksordner.
- iCloud-Konfliktkopien (`<name> 2.md`) meldet der Kern als Problem und übernimmt sie nicht still.

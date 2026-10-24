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
| `projects/<slug>/texts/<text>.md` | Frontmatter `TextFrontmatter` (Titel, Zitierstil, Sprache), Text Markdown mit Pandoc-Zitaten | Kern, Agents, Menschen |
| `projects/<slug>/exports/*` | abgeleitet; auch die Word-, LaTeX-, PDF- und Markdown-Dateien von `texts.export` | Kern |
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

## Texte

Ein Text (D20) ist eine Markdown-Datei, zum Beispiel `projects/phd-proposal/texts/kapitel-2.md`. Der Dateiname ohne `.md` ist der Slug des Texts: Kleinbuchstaben, Ziffern und Bindestriche, so wie bei Projekten. Die Datei liegt im Bibliotheksordner und wird nicht indexiert, wie die Dokumente eines Plans.

```markdown
---
title: Kapitel 2
style: apa
lang: de-DE
created: { at: 2026-10-24T09:00:00.000Z, by: human }
---

# Soziale Systeme

Luhmann setzt Kommunikation als Grundelement [@luhmann1984soziale, S. 31]. Bei @gillespie2018custodians steht
die Plattform im Mittelpunkt [vgl. @luhmann1984soziale; -@habermas1981theorie].
```

- `title` ist Pflicht. `style` ist eine CSL-Stil-ID (`apa`, `chicago-author-date`, `deutsche-gesellschaft-fur-psychologie`) und `lang` ein BCP-47-Tag. Fehlt `style`, gilt der Stil des Projekts. Fehlt `lang`, gilt die Sprache des Projekts (D9), sonst dessen `locale`. `created` setzt der Kern beim Anlegen, andere Schlüssel bleiben erhalten.
- Zitate folgen der Pandoc-Syntax: `[@citekey]`, `[@citekey, S. 12]`, `[vgl. @a2020x; @b2021y]`, `[-@citekey]` und `@citekey` im Fließtext. Ein Citekey muss ein Item der Bibliothek benennen. Ein unbekannter bleibt im Export unaufgelöst, und der Editor markiert ihn. Als Zitat zählt nichts in Code, Kommentaren, Links, Wiki-Links und im Frontmatter, ebenso wenig eine E-Mail-Adresse.
- Bilder und andere Dateien, auf die der Text relativ verweist, liegen neben ihm. `texts.export` übergibt Pandoc diesen Ordner als Ressourcenpfad.
- Der Export steht in `projects/<slug>/exports/<text>.docx`, `<text>.zip` (LaTeX: `main.tex` mit biblatex und `references.bib` mit den zitierten Quellen), `<text>.pdf` oder `<text>.md`. Pandoc läuft dafür als eigener Prozess (D20).

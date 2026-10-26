# Library format, version 1

The schemas in `packages/schema/src` are authoritative. This page describes where each file lives and who may write it. The background is in [the architecture document](../architecture.md), section on the library folder.

| Path | Schema | Written by |
|---|---|---|
| `citegeist.json` | `LibraryManifest` | Core |
| `AGENTS.md`, `CLAUDE.md` | free | Core (generated) |
| `items/<citekey>/<citekey>.md` | Frontmatter `ItemFrontmatter`, body free (literature note) | Core; agents and humans may edit the body |
| `items/<citekey>/sources/<hash>.<ext>` | Original file, immutable | Core |
| `items/<citekey>/derived/<hash>/manifest.json` | `DerivedManifest` | Python worker |
| `items/<citekey>/derived/<hash>/pages.json` | `Pages` (per page `labelConfidence` from 0 to 1) | Worker, confirmation by the core |
| `items/<citekey>/derived/<hash>/blocks.jsonl` | `Block`, one line per block | Worker |
| `items/<citekey>/derived/<hash>/idmap.json` | `IdMap` | Worker |
| `items/<citekey>/derived/<hash>/header.json` | free, only if the worker found header data | Worker |
| `items/<citekey>/derived/<hash>/refs.jsonl`, `doc.md`, `doc.html`, `assets/` | derived | Worker |
| `items/<citekey>/cards/<id>.md` | Frontmatter `CardFrontmatter`, body `CardBody` | Core; the "Note" section may be edited freely |
| `alerts.yaml` | like `projects/<slug>/alerts.yaml`, for alerts without a project | Core, agents, humans |
| `notes/<slug>.md` | Frontmatter `NoteFrontmatter`, body free. A note of type `literature` with the line `Item: [[citekey]]` is the literature note of that item and holds the links that start at its cards (`from: c_...`) | Core, agents, humans |
| `projects/<slug>/project.md` | Frontmatter `ProjectFrontmatter`, body is the project brief | Core, agents, humans |
| `projects/<slug>/alerts.yaml` | `alerts:` with a list of `AlertDef` (name, source, interval, limit, ranking). The last run and the watch list are not stored here but machine-locally in `alerts-state.json` | Core, agents, humans |
| `projects/<slug>/insights.md` | free Markdown; every insight is a paragraph that ends with a block id `^i-<id>` (`InsightBlockId`) | Core, agents, humans |
| `projects/<slug>/plans/<plan>/plan.md` | Frontmatter `PlanFrontmatter`, body is the planning document | Core, agents, humans |
| `projects/<slug>/plans/<plan>/outline.yaml` | `Outline` | Core, agents, humans |
| `projects/<slug>/plans/<plan>/nodes/<slug>.md` | Frontmatter `NodeDocFrontmatter`, body free | Core, agents, humans |
| `projects/<slug>/texts/<text>.md` | Frontmatter `TextFrontmatter` (title, citation style, language), body is Markdown with Pandoc citations | Core, agents, humans |
| `projects/<slug>/exports/*` | derived; includes the Word, LaTeX, PDF and Markdown files from `texts.export` | Core |
| `chats/<date>-<slug>.md` | free | Core |

## Rules

- Files are UTF-8 with LF line endings. Frontmatter is YAML between `---` lines.
- The core writes atomically through a temporary file and `rename`.
- The body of a card starts with a quote block (`> `) that contains the verbatim wording. The sections from `CARD_SECTIONS` follow as second-level headings. `quote_sha256` is the SHA-256 of the wording after removing the quote prefix and normalizing line breaks to `\n`.
- Page markers in `doc.md`: `<!-- page <index> label=<label> -->` on its own line, and `<!-- p:<label> -->` inside a paragraph. Every block ends with ` ^<blockid>`.
- Pages without a printed page number carry the markers `<!-- page <index> -->` and `<!-- p:#<index> -->`. `<index>` counts the pages of the file from 0, and the `#` in front of the index distinguishes it from a printed page number.
- Blocks that span several lines (tables, code, display formulas) carry their `^<blockid>` on a separate line after a blank line. This is how Obsidian recognizes the block link.
- `pages.json` states per page in `labelConfidence` how reliable the printed page number is. If the value is below 0.5, the app asks once. The worker also writes `labelFlags`, `furniture` (headers and footers) and `pageRangeHint` there; the core does not read these keys.
- `header.json` contains the header data the worker found in the source: the GROBID result for a PDF, the metadata trafilatura finds for a web page, the title for arXiv HTML. The file is absent if nothing was found, and the worker deletes it when a repeated conversion finds nothing.
- Machine-local data (`index.sqlite`, `state.sqlite`, logs, models) lives under `~/Library/Application Support/citegeist/<library-id>/` and never in the library folder.
- The core reports iCloud conflict copies (`<name> 2.md`) as a problem and does not adopt them silently.

## Unpaginated sources

A source is unpaginated when its conversion has neither printed page labels nor PDF pages: a web page, an HTML file, an EPUB, or arXiv HTML that was converted without its PDF. The core derives this and stores nothing extra (`isUnpaginated` in `packages/schema/src/paragraphs.ts`). A source is unpaginated if

- its `kind` in the item is `web`, `html` or `epub`, or
- its `manifest.json` has `path: web` or the flag `no-pages` or `no-pdf-for-page-mapping`, or
- there is no manifest and `pages.json` holds one placeholder page of `textSource: html` without a label.

A `pdf` source and arXiv HTML that is mapped to the pages of its PDF are paginated. `documents.assets` reports the result as `paginated`. The worker still writes a placeholder `pages.json` for an unpaginated source (one page, `label: null`), and the reader does not ask for page numbers.

Cards of an unpaginated source carry a paragraph locator instead of a page: `locator: {label: paragraph, start: "4"}`, or with `end` when the quote spans several paragraphs. The paragraph number counts the blocks of type `paragraph`, `list-item` and `quote` in the body flow in reading order, from 1. Titles, headings, tables, figures, captions, equations, code, footnotes, references and page furniture are not counted. The label is the CSL locator term `paragraph`, so the citation style decides how it reads (APA: "para. 4", German locale "Abs. 4"). A card of a paginated source keeps `label: page`.

Older cards of an unpaginated source have no locator or the placeholder `{label: page, start: "1"}`. The core derives the paragraph from the text anchor whenever such a card is read, and rewrites the file only when the card is saved. A locator that a person typed (any other page) stays as it is. A paragraph number follows the current conversion: after a re-conversion that adds or removes blocks, the number of an unsaved card can move, and a saved card keeps the number it was saved with.

## Texts

A text ([ADR 0002](../decisions/0002-writing-in-markdown-with-pandoc.md)) is a Markdown file, for example `projects/phd-proposal/texts/kapitel-2.md`. The file name without `.md` is the slug of the text: lowercase letters, digits and hyphens, as for projects. The file lives in the library folder and is not indexed, like the documents of a plan.

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

- `title` is required. `style` is a CSL style id (`apa`, `chicago-author-date`, `deutsche-gesellschaft-fur-psychologie`) and `lang` a BCP 47 tag. If `style` is missing, the style of the project applies. If `lang` is missing, the language of the project applies ([AI text language](../decisions/0016-ai-text-language.md)), otherwise its `locale`. The core sets `created` on creation and keeps other keys.
- Citations follow the Pandoc syntax: `[@citekey]`, `[@citekey, S. 12]`, `[@citekey, Abs. 4]`, `[vgl. @a2020x; @b2021y]`, `[-@citekey]` and `@citekey` in running text. A citekey has to name an item of the library. An unknown one stays unresolved in the export, and the editor marks it. Nothing in code, comments, links, wiki links or frontmatter counts as a citation, and neither does an email address.
- Images and other files the text refers to relatively live next to it. `texts.export` passes this folder to Pandoc as the resource path.
- The export lands in `projects/<slug>/exports/<text>.docx`, `<text>.zip` (LaTeX: `main.tex` with biblatex and `references.bib` with the cited sources), `<text>.pdf` or `<text>.md`. Pandoc runs as a separate process for this ([ADR 0002](../decisions/0002-writing-in-markdown-with-pandoc.md)).

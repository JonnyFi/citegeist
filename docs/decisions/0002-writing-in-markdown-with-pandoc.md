# ADR 0002: Writing in Markdown with Pandoc

Status: accepted. Date: 2026-10-23, amended 2026-10-24 and 2026-10-26.

## Context

The first decision assumed that users write no long texts in citegeist and only take citations out of it. Version 1 therefore offered two ways into a text: an export for Pandoc, Typst and LaTeX (stable citekeys, `.bib` and CSL-JSON files that update automatically) and a rich-text copy that puts the quote and its formatted reference on the clipboard together. With a chapter to write, the text should be created where the quote cards live. The amendment of 2026-10-24 builds on the first decision and adds writing inside citegeist.

## Decision

- A text is a Markdown file under `projects/<slug>/texts/` with a small frontmatter for title, citation style and language.
- Citations use the Pandoc syntax, for example `[@citekey, p. 12]`. The editor completes them after `[@` from the library (sources of the project first) and marks unknown citekeys.
- A quote card inserts a verbatim or paraphrased quote with its reference at the cursor ([ADR 0010](0010-quote-cards.md)); [ADR 0030](0030-unified-citation-insert.md) describes the three kinds of insert and the chips. The chat agent drafts and revises passages directly in the file ([ADR 0018](0018-direct-agent-edits-with-undo.md)).
- `texts.export` runs Pandoc as a separate process and produces Word (`.docx`), LaTeX (a ZIP with `main.tex` and `references.bib`), PDF and Markdown. The bibliography contains only cited sources and follows the citation style of the text, otherwise of the project (CSL). The language follows the text, otherwise the project ([ADR 0016](0016-ai-text-language.md)). PDF is typeset with Typst (amendment of 2026-10-26, below).
- Pandoc is not part of the app bundle. citegeist looks for it in `PATH` and the Homebrew folders and can download a pinned release with a fixed checksum into the machine-local folder (`pandoc.setup`). Pandoc is GPL-2.0 and therefore always runs as its own process.
- LaTeX is an export target and no editing surface. A visual editor and add-ins for Word or Google Docs may follow if a need shows up.

## Consequences

Agents reach texts through `cg texts ...` and the files themselves, because the MCP tool set is full ([ADR 0007](0007-core-process-and-operations.md)).

## Amendment 2026-10-26: PDF through Typst

Asking people to install a TeX distribution to get a PDF was too much. citegeist now typesets the PDF with Typst, which is a single binary of about 45 MB.

- `typst.setup` downloads a pinned official release (`typst-aarch64-apple-darwin.tar.xz` from github.com/typst/typst, fixed sha256) into `<local base>/typst/<version>/`, like `pandoc.setup` does for Pandoc. Typst is Apache-2.0 and runs as a separate process that Pandoc starts (`--pdf-engine`).
- The PDF export prefers Typst (the downloaded copy, then one on `PATH` or in Homebrew). A LaTeX engine is only the fallback on a Mac that has one and no Typst.
- The page is A4 with 11 pt New York (Typst uses its bundled serif font where New York is missing), margins of 2.5 cm and page numbers. Hyphenation follows the language of the text.
- The first PDF export asks before it downloads ("Für PDF lädt citegeist einmal Typst ... Jetzt laden?") and exports once the download is done. Errors of the export show in the UI language; the core keeps its codes and English messages.

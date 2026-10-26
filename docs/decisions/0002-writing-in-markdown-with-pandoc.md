# ADR 0002: Writing in Markdown with Pandoc

Status: accepted. Date: 2026-10-23, amended 2026-10-24.

## Context

The first decision assumed that users write no long texts in citegeist and only take citations out of it. Version 1 therefore offered two ways into a text: an export for Pandoc, Typst and LaTeX (stable citekeys, `.bib` and CSL-JSON files that update automatically) and a rich-text copy that puts the quote and its formatted reference on the clipboard together. With a chapter to write, the text should be created where the quote cards live. The amendment of 2026-10-24 builds on the first decision and adds writing inside citegeist.

## Decision

- A text is a Markdown file under `projects/<slug>/texts/` with a small frontmatter for title, citation style and language.
- Citations use the Pandoc syntax, for example `[@citekey, p. 12]`. The editor completes them after `[@` from the library (sources of the project first) and marks unknown citekeys.
- A quote card inserts a verbatim or paraphrased quote with its reference at the cursor ([ADR 0010](0010-quote-cards.md)). The chat agent drafts and revises passages directly in the file ([ADR 0018](0018-direct-agent-edits-with-undo.md)).
- `texts.export` runs Pandoc as a separate process and produces Word (`.docx`), LaTeX (a ZIP with `main.tex` and `references.bib`), PDF and Markdown. The bibliography contains only cited sources and follows the citation style of the text, otherwise of the project (CSL). The language follows the text, otherwise the project ([ADR 0016](0016-ai-text-language.md)). PDF needs a LaTeX engine or Typst on the machine.
- Pandoc is not part of the app bundle. citegeist looks for it in `PATH` and the Homebrew folders and can download a pinned release with a fixed checksum into the machine-local folder (`pandoc.setup`). Pandoc is GPL-2.0 and therefore always runs as its own process.
- LaTeX is an export target and no editing surface. A visual editor and add-ins for Word or Google Docs may follow if a need shows up.

## Consequences

Agents reach texts through `cg texts ...` and the files themselves, because the MCP tool set is full ([ADR 0007](0007-core-process-and-operations.md)).

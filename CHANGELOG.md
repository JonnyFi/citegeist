# Changelog

All notable changes to citegeist are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Citing web pages.** Cards of a source without pages (web page, HTML, EPUB) cite a paragraph instead of a page: "Abs. 4" or "para. 4", and the citation style decides the wording. The reader no longer asks for page numbers there.

### Added

- **Connections from cards.** A quote card can start a typed connection, for example "widerspricht" to another source. The card menu offers "Verbinden" and "An den Agent", the agent can connect a card with the `link` tool, and a card whose text names a source of the library shows one suggestion that you accept or dismiss.

## [0.1.0] - not yet released

The first public version. It covers the whole workflow from adding a paper to writing a text.

### Added

- **Library.** A library is a plain folder of Markdown, YAML, JSON and original PDFs. The search index is machine-local and rebuilds from the folder. Items follow the Zotero schema with stable citekeys.
- **Import.** Add items by DOI, arXiv ID or link, ISBN, PubMed ID, URL, BibTeX snippet or PDF. Metadata comes from Crossref, OpenAlex, arXiv, DNB, K10plus and Open Library. Importers read Zotero (database copy or running Zotero), BibTeX, RIS and CSL-JSON, and the Zotero Connector browser extension saves into citegeist.
- **Conversion.** A Python worker converts digital PDFs, scans (local OCR with Apple Vision), arXiv HTML and web pages into a block model with page references and printed page numbers.
- **Reading and quote cards.** A PDF view and a text view share highlights. A card stores the exact wording, the page, an AI paraphrase, a kind and a note, and copies as a verbatim or an indirect citation.
- **Notes and links.** Obsidian-compatible Markdown notes with wiki links, typed connections that the AI proposes and you confirm, a graph view and a concept register.
- **Projects and planning.** Project briefs with research questions, plans with an outline (templates for a proposal and for IMRaD), insights, gap view and a literature matrix with evidence for every cell.
- **Writing and export.** Markdown texts with Pandoc citations, completion from the library and export to Word, LaTeX and PDF in a CSL style.
- **Literature search and alerts.** A scored search over OpenAlex, arXiv and Semantic Scholar, preprint tracking and saved searches that run as alerts and fill the inbox.
- **Agents.** An MCP server and the `cg` command line, an agent chat in the sidebar for Claude Code, Codex and Cursor with undo per turn, research jobs, an inbox for everything agents add, and webhooks with a remote MCP endpoint for cloud agents.
- **AI backends.** Claude Code, Codex and Cursor command line tools with your own login, API keys for Anthropic, OpenAI, OpenRouter and xAI, and Ollama. Routing per task and a usage ledger.
- **Search.** Full-text search with an optional local semantic search and reranker.
- **Sync.** iCloud, Dropbox or a git remote, with a git history of changes and conflict handling.
- **Quick insert.** A global hotkey that pastes a card citation into any app.
- **Installation.** `install.sh` installs the app without an Apple Developer ID and links `cg` to `~/.local/bin`. The app shows when an update is available.

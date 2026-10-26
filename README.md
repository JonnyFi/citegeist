# citegeist

citegeist is a macOS research library in which you and your AI agents work on the same plain files: PDFs, quote cards, notes and citations.

![Reading a source with the agent chat open](docs/design/screens/lesen-agent-chat.png)

The screenshot shows the German interface. The interface language switches to English in Settings.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh
```

The script downloads the latest release, verifies its checksum, installs `citegeist.app` into `/Applications` (or `~/Applications` when that folder is not writable) and links the `cg` command to `~/.local/bin/cg`. citegeist has no Apple Developer ID. A file that `curl` downloads carries no quarantine attribute, so Gatekeeper does not block the app. The same script updates an existing installation.

Requirements:

- macOS on Apple Silicon.
- [uv](https://docs.astral.sh/uv/) (`brew install uv`). The PDF conversion worker runs in a Python environment that uv sets up.
- At least one AI backend for the chat and the AI tasks: the Claude Code, Codex or Cursor command line tool you are logged in to, an API key (Anthropic, OpenAI, OpenRouter or xAI), or Ollama. Without any of them the library, reader and search still work.

Pandoc is only needed to export texts. citegeist finds it on your machine or downloads a pinned release on request.

## Quick start

1. Start citegeist and create a library. A library is an ordinary folder that you choose.
2. Add a paper. Paste a DOI, arXiv link, ISBN or URL into the field at the top of the library, or drop a PDF into the window. citegeist looks up the metadata and converts the PDF in the background.
3. Open the paper, switch to the reading tab, select a passage and choose "Quote". citegeist saves a quote card with the exact wording and the printed page number. A paraphrase follows a few seconds later.
4. Open the agent chat in the right column and ask a question about your library. The agent answers with citations to your cards.

[docs/getting-started.md](docs/getting-started.md) covers the first run in more detail.

## Features

**Library and import.** Items follow the Zotero schema. Metadata comes from Crossref, OpenAlex, arXiv, DNB and K10plus. citegeist converts digital PDFs, scans (local OCR), arXiv HTML and web pages into text blocks with page references. You can import from Zotero, BibTeX, RIS and CSL-JSON, and the Zotero Connector browser extension can save into citegeist directly. See [library and import](docs/guide/library-and-import.md).

**Reading and quote cards.** A PDF view and a text view share the same highlights. A quote card stores the wording unchanged, the page, an AI paraphrase, a kind and your own note. One click copies a card as a verbatim or an indirect citation. See [reading and cards](docs/guide/reading-and-cards.md).

**Notes and links.** Notes are Markdown files with wiki links and work in Obsidian. Typed links between notes and sources (supports, opposes, extends and others) are proposed by the AI and confirmed by you. A graph view and a concept register show how sources relate. See [notes and links](docs/guide/notes-and-links.md).

**Projects and planning.** A project holds a brief with research questions, a reading list, cards, plans with an outline, insights and a literature matrix. See [projects and planning](docs/guide/projects-and-planning.md).

**Writing and export.** Write in Markdown with Pandoc citations such as `[@luhmann1984soziale, p. 31]`. Export to Word, LaTeX or PDF in a CSL citation style. See [writing and export](docs/guide/writing-and-export.md).

**Literature search and alerts.** A search over OpenAlex, arXiv and Semantic Scholar ranks papers and verifies DOIs. Saved searches run as alerts and put new papers into the inbox. See [literature search and alerts](docs/guide/literature-search-and-alerts.md).

**Sync.** The library folder syncs through iCloud, Dropbox or a git remote, and git keeps a history of agent changes. See [sync](docs/guide/sync.md).

## Agents

Agents reach the library in four ways:

- The MCP server (`cg mcp`) gives Claude Code, Codex, Cursor and Claude Desktop search, reading, cards, notes and planning tools.
- The `cg` command line exposes every operation of the app, with `--json` output.
- The chat in the app starts Claude Code or Codex with your own login and gives it access to the library. File changes made in a chat turn can be undone.
- Cloud agents connect through webhooks and a remote MCP endpoint behind a tunnel.

Anything an agent adds lands in the inbox first, marked with its origin. [docs/agents.md](docs/agents.md) has the setup for each client.

## Files and privacy

The library is a plain folder of Markdown, YAML, JSON and your original PDFs. It stays readable without citegeist, in Obsidian, in git and for any agent with file access. The search index, job state and models live separately in `~/Library/Application Support/citegeist`, and the app rebuilds the index from the folder when needed.

citegeist sends no telemetry. The app goes to the network for these things:

- Metadata and open-access PDF lookups at Crossref, OpenAlex, arXiv, DNB, K10plus, Open Library, Unpaywall, PubMed and, for the literature search, Semantic Scholar, DBLP, OpenReview and ORCID.
- Model calls. They go through the command line tool you are logged in to, or to the API provider whose key you stored. With Ollama they stay on your Mac.
- Downloads you start: the semantic search model from Hugging Face, the conversion models and GROBID, and the pinned Pandoc release from GitHub.
- A check against the GitHub releases API at most once a day to show "Update available".

API keys are stored in the macOS Keychain. [docs/security-model.md](docs/security-model.md) describes what agents can and cannot do.

## Build from source

Requirements: macOS on Apple Silicon, Node 22 or newer, pnpm 10 and uv.

```sh
pnpm install
pnpm --filter @citegeist/ui dev                                         # Vite server for the UI
ELECTRON_RENDERER_URL=http://localhost:5173 pnpm --filter @citegeist/desktop dev   # Electron with hot reload
pnpm package        # unsigned arm64 citegeist.app in apps/desktop/dist
pnpm verify         # biome, typecheck, vitest and pytest; must pass before every push
```

[docs/development.md](docs/development.md) describes the repository layout, tests, evals and the release process.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Bugs and feature requests go to the issue tracker. Report security problems as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

citegeist is licensed under the [Apache License 2.0](LICENSE). Third-party components and their licenses are listed in [docs/licenses.md](docs/licenses.md).

<p align="center">
  <img src="../apps/desktop/build/icon.png" width="80" alt="The citegeist logo">
</p>

<h1 align="center">citegeist documentation</h1>

<p align="center">
  <a href="getting-started.md">Getting started</a> ·
  <a href="#guides">Guides</a> ·
  <a href="#agents">Agents</a> ·
  <a href="#reference">Reference</a> ·
  <a href="#contributing">Contributing</a>
</p>

## Start here

1. **[Getting started](getting-started.md)** walks through the install and takes you from an empty folder to the first paper and the first quote card.
2. **[Reading and cards](guide/reading-and-cards.md)** shows how a highlighted passage becomes a card and how a card turns into a citation.
3. **[Connecting agents](agents.md)** explains how to add citegeist to Claude Code, Codex, Cursor or Claude Desktop.

## Guides

### Collect

| Page | What it covers |
|---|---|
| [Library and import](guide/library-and-import.md) | Adding papers by DOI, arXiv, ISBN, URL or PDF, the inbox, Zotero and BibTeX imports, retractions |
| [Literature search and alerts](guide/literature-search-and-alerts.md) | Searching OpenAlex, arXiv and Semantic Scholar, preprint tracking, alerts, research jobs |

### Read and connect

| Page | What it covers |
|---|---|
| [Reading and cards](guide/reading-and-cards.md) | The reader, printed page numbers, quote cards, copying citations, quick insert |
| [Notes and links](guide/notes-and-links.md) | Markdown notes, typed connections, the graph, the concept register |

### Plan and write

| Page | What it covers |
|---|---|
| [Projects and planning](guide/projects-and-planning.md) | Projects, research plans with an outline, insights, the literature matrix |
| [Writing and export](guide/writing-and-export.md) | Texts with Pandoc citations, export to Word, LaTeX and PDF |

### Set up

| Page | What it covers |
|---|---|
| [Settings and models](guide/settings-and-models.md) | AI backends, routing, semantic search, metadata sources, limits |
| [Sync](guide/sync.md) | iCloud, Dropbox, a git remote, history and conflicts |

## Agents

| Page | What it covers |
|---|---|
| [Connecting agents](agents.md) | `cg mcp` for local clients, the chat in the sidebar, cloud agents such as Grok Bot |
| [Webhooks](webhooks.md) | Connectors, signatures, tunnels and the remote MCP endpoint |
| [Agent skill](../skills/citegeist/SKILL.md) | The skill that tells an agent which channel to use and in what order |
| [Security model](security-model.md) | What agents and connectors may do, network egress, the threat model |

## Reference

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | Processes, the library folder, the data model, ingest, the AI layer |
| [Library format](spec/library-format.md) | Every file of a library on disk and who may write it |
| [Research planning](spec/research-planning.md) | The spec for plans, outlines and insights |
| [Decisions](decisions/README.md) | The decision records behind the design |
| [Licenses](licenses.md) | Licenses of the third-party components |

## Contributing

| Page | What it covers |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to propose a change and what a pull request needs |
| [Development](development.md) | Repository layout, running from source, tests, evals, releases |
| [Maintainers](maintainers.md) | Maintainer-owned files, review and merge, agent models |

# citegeist architecture

citegeist is a macOS research library app. PDFs, notes, quote cards and citations live as plain files in one folder. A local index and AI agents work on top of those files. The core is TypeScript on Node, conversion runs in a Python worker, and the UI ships in Electron. This page is the reference for how the parts fit together: processes, library folder, data model, ingest, AI layer, agent interfaces, search, sync and security.

- [spec/library-format.md](spec/library-format.md): which file lives where and who may write it
- [spec/research-planning.md](spec/research-planning.md): plans, outlines and insights
- [agents.md](agents.md): connecting agents to citegeist
- [webhooks.md](webhooks.md): connectors, signatures and tunnels
- [security-model.md](security-model.md): threat model and security details
- [licenses.md](licenses.md): license of the project and of its dependencies
- [development.md](development.md): running the app from source, tests and releases

Decisions are recorded as ADRs in `docs/decisions/`. This page links to the relevant ones inline.

## Overview

```
 ┌──────────────── citegeist.app (Electron 45) ────────────────┐
 │  Renderer (React): Library · Reader · Notes · Graph ·       │
 │  Projects · Inbox · Concepts · Literature search ·          │
 │  Agent chat sidebar · Settings                              │
 │  Main: windows, menu, global hotkey (quick insert),         │
 │  clipboard, update check                                    │
 └───────────────┬─────────────────────────────────────────────┘
                 │ oRPC over 127.0.0.1 (HTTP + WebSocket)
 ┌───────────────▼────────── citegeist core (Node) ────────────┐
 │  Operations registry ──► RPC (UI) · MCP (agents) · CLI (cg) │
 │  Services: items · ingest · documents · quote cards ·       │
 │   notes/graph · concepts · matrix · projects/planning ·     │
 │   texts · citations · search · jobs · chat · alerts ·          │
 │   literature search · import · sync · webhooks · usage      │
 │  Storage: library folder (truth) + SQLite (index, state)    │
 └──┬─────────────┬──────────────────┬──────────────┬──────────┘
    │ JSON-RPC    │ subprocess       │ subprocess   │ HTTPS
    ▼ stdio       ▼ stdio/ACP        ▼              ▼
 Python workers   Claude Code,       Pandoc         Crossref, OpenAlex,
 convert:         Codex, Cursor      (export)       arXiv, PubMed, DNB,
 Docling, GROBID, (own subscription)                K10plus, Unpaywall,
 OCR; research:                                     Semantic Scholar,
 literature search                                  API providers
```

Three rules shape the architecture. The core is a process of its own and belongs to no client exclusively: the app, the CLI and MCP clients are peers ([core process and operations](decisions/0007-core-process-and-operations.md)). Files in the library folder are the truth, and SQLite is an index that can be rebuilt at any time ([files as source of truth](decisions/0008-files-as-source-of-truth.md)). Every capability is defined once as an operation and appears on all three access paths.

The UI is available in English (default) and German and follows the system language.

## Processes

| Process | Role | Lifetime |
|---|---|---|
| Core (`packages/server`) | Owns the library, is the only writer of the index, runs jobs, serves RPC, events, library files, MCP over HTTP and webhooks | Started by the app as an Electron `utilityProcess`, or by `cg mcp`. Stops with its starter |
| Electron app (`apps/desktop`) | UI. Starts the core or attaches to a running one | While the window is open |
| `cg` (`apps/cli`) | CLI. Talks to the running core. Opens the library in-process when no core runs | Per call |
| `cg mcp` | stdio MCP server for local clients, or Streamable HTTP with `--http` | Per MCP client |
| Convert worker (`workers/convert`) | Python 3.12 under `uv`: Docling, GROBID, Apple Vision OCR, arXiv HTML, web pages. Environment in `<local base>/worker/venv`, models downloaded on first use | Started by the core, exits after 600 seconds idle |
| Research worker (`workers/research`) | Python scripts for the literature search (OpenAlex, arXiv, Semantic Scholar, DBLP, OpenReview, Unpaywall, ORCID). Environment in `<local base>/research/venv` | One process per run or check |
| Pandoc | Export of texts to Word, LaTeX, PDF and Markdown ([Markdown with Pandoc](decisions/0002-writing-in-markdown-with-pandoc.md)). GPL-2.0, so it runs only as a separate process. Found in `PATH` and Homebrew, or downloaded as a pinned release by `pandoc.setup` | Per export |
| Agent CLIs | `claude`, `codex` and `agent` (Cursor) installed by the user. Inference runs on the user's subscription ([open source and own subscription](decisions/0001-open-source-and-own-subscription.md)) | Per AI call, or per chat session through an ACP adapter |

One core runs per library. `<local base>/<library-id>/core.lock` holds PID and port, and `core.token` (mode 0600) holds the token for the HTTP endpoint. `<local base>` is `~/Library/Application Support/citegeist`. A starting process checks the lock first and attaches to a running core.

The core reads the caller from the header `x-citegeist-actor` (`human`, `system` or `agent:<name>`). Without the header a call acts as `human`, which is how the app's UI talks. An invalid value is rejected with 400. `GET /health` reports `actors: true` when the core knows the header, and `cg` forwards writes by agents only to a core that reports it. When no app runs, `cg mcp` opens the library as a core: it takes `core.lock` and serves the same HTTP endpoint, and an app that starts later attaches to it. One-shot `cg` commands do not take the lock. A library that a core serves is also reachable under `/files/` for the reader and under `/events` (WebSocket) for change events.

## Operations registry

Every capability is an operation with a name, Zod schemas for input and output, an access class and a handler. Contracts live in `packages/ops/src/contracts`, handlers in `packages/core`.

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

From one definition the registry produces the oRPC procedure for the UI, the CLI command (`cg items add`, with `--json`) and, for a curated subset, an MCP tool. `ctx.actor` carries the caller (`human`, `agent:<name>`, `system`) and is written as provenance on every object the call writes.

Operations are grouped in namespaces:

| Namespace | Operations |
|---|---|
| `library`, `items`, `inbox` | status, reindex; add, attach, get, list, update, resolve, rename, trash, restore; accept, reject |
| `documents`, `cards` | read, convert, confirmPages, assets; create, update, list, regenerate, export |
| `notes`, `links`, `graph` | create, update, get, list, backlinks; create, propose, decide; neighbors, references, citing, related, addCandidates (plus `items.checkRetractions`) |
| `concepts`, `matrix` | list, get, create, update, merge, describe, propose; create, list, get, update, fillCell, fill, export |
| `projects`, `plans`, `outline`, `plan.docs`, `insights` | create, get, update, list, context; create, list; get, apply; get, update; note, find, list |
| `texts`, `pandoc` | list, get, create, update, export; status, setup |
| `search`, `cite` | query; format |
| `jobs`, `research`, `chat` | get, list; start; backends, start, send, cancel, list, get, revertTurn, save |
| `litsearch`, `alerts` | suggest, start, resume, cancel, runs, get, compare, report, export, toInbox, preprints, preprintsImport, preprintsCheck; list, create, update, delete, runNow |
| `import`, `sync` | preview, run; status, configure, now, resolveConflict |
| `webhooks`, `settings`, `ai`, `worker`, `usage` | list, create, setAuth, setInboundToken, rotateSecret, delete, test, send, setMcpAccess; get, update; testBackend; setup; summary |

Errors follow the gstack contract for agent-readable errors. An error names what failed with which values, carries a safe fix on its first or last line, describes retryability and side effects, and has a stable code. On the MCP channel that means `isError: true`, on the CLI a distinct exit code with a `--json` shape.

## Library folder

The format is specified in [spec/library-format.md](spec/library-format.md). The layout:

```
~/Citegeist/                              library, syncable (iCloud, Dropbox, git)
  AGENTS.md                               rules for agents, generated and maintained by citegeist
  CLAUDE.md                               pointer to AGENTS.md
  citegeist.json                          manifest: format version, library id, shared settings
  alerts.yaml                             alerts without a project
  items/
    luhmann1984soziale/                   one folder per source, named by citekey
      luhmann1984soziale.md               frontmatter: metadata (CSL-compatible). Body: literature note
      sources/3f9a1c2e7b4d.pdf            originals, named by the first 12 hex digits of the SHA-256, immutable
      derived/3f9a1c2e7b4d/               per source file
        manifest.json                     pipeline, tool and model versions, quality flags
        pages.json                        PDF index, printed page label, where the label came from, OCR yes/no
        blocks.jsonl                      canonical block model, one line per block
        idmap.json                        redirects of old block ids after reconversion
        header.json                       header data the worker found (only if it found any)
        refs.jsonl                        the paper's bibliography, linked to blocks
        doc.md                            agent view with page marks and ^block ids
        doc.html                          reading view
        assets/                           figures, named by block id
      cards/
        c_01JB8Z3Q.md                     one quote card per file
  notes/
    autopoiesis-erklaert-stabilitaet.md   note with frontmatter and wiki links
    concepts/
      autopoiesis.md                      concept (type: concept) with aliases, cards and one entry per source
  projects/
    phd-proposal/
      project.md                          project brief, research questions, reading list
      alerts.yaml                         alerts of the project
      plans/<plan>/plan.md, outline.yaml  plans and outlines (see spec/research-planning.md)
      insights.md                         insights without a fixed place
      matrices/                           literature matrices
      texts/kapitel-2.md                  text with Pandoc citations
      exports/phd-proposal.bib            updated automatically
      exports/phd-proposal.json           CSL-JSON, updated automatically
      exports/kapitel-2.docx              export of the text through Pandoc
  research/runs/<run-id>/                 literature search runs
  chats/                                  saved agent conversations
  .trash/                                 items removed with items.trash
```

Machine-local data lives under `~/Library/Application Support/citegeist/<library-id>/`: `index.sqlite` (search, graph, vectors), `state.sqlite` (jobs, the usage ledger of AI calls), `sync.json`, logs, caches and a separate git directory when the library sits in a synced folder. `settings.json`, the Python environments and the models sit one level up in `<local base>`. None of this belongs in a synced folder.

The folder is a valid Obsidian vault ([Obsidian-compatible notes](decisions/0006-obsidian-compatible-notes.md)). The literature note is named like the citekey, so `[[luhmann1984soziale]]` points to the same file in Obsidian and in citegeist. `[[luhmann1984soziale#^b7f3k2q]]` links a paragraph of the full text, and `![[c_01JB8Z3Q]]` embeds a quote card.

### Writing to the folder

The core writes atomically (temporary file, then `rename`) and updates the index immediately. A watcher (`@parcel/watcher`) detects outside changes, for example when an agent edits a note directly or iCloud delivers a file. It validates the file against the schema and reindexes it. The core recognizes its own writes by hash. Invalid files go to a problem list that the UI and MCP show. iCloud placeholders (evicted files) are downloaded on demand, and iCloud and Dropbox conflict copies are reported as problems.

Only the core writes under `derived/`. `AGENTS.md` tells agents to leave `derived/`, `sources/`, `exports/` and the quote of a card alone.

## Data model

All schemas are Zod 4 definitions in `packages/schema` and are exported as JSON Schema for agents and the Python worker.

### Item

Frontmatter of the literature note. Field names follow CSL-JSON in the YAML form that Pandoc also reads. The 37 Zotero item types map onto CSL 1.0.2 types, and the original Zotero type stays in `zotero_type`.

```yaml
id: 01JB8Z3QK7...            # ULID, immutable
citekey: luhmann1984soziale  # stable, changed only by explicit rename
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
status: read                 # unread | reading | read
provenance:                  # per field: source and time
  title: crossref@2026-10-23
  abstract: openalex@2026-10-23
created: {at: 2026-10-23T10:12:00Z, by: human}
```

Citekeys follow a formula in the style of Better BibTeX (default: last name, year, first title word). A key is created once and never silently recomputed. A rename rewrites all wiki links and card references. One exception covers placeholders: when the key came from a missing author or year (`anonnddemos`), the core replaces it after a successful conversion with the key from the better data, as long as no card or link refers to the item.

An item whose import fails stays in the library with an `incomplete` field in the frontmatter (code, message, time, job). `items.get`, `items.list`, the problem list, the UI and MCP show it. Attaching or re-adding a working file, `documents.convert` or deletion clears the state, and a successful conversion removes the field.

Two more states are typed frontmatter fields. `fulltext` (`status: found | missing`, `tried` with the sources checked, `checked_at`) records whether the full-text lookup after adding by DOI found a file. `items.list` reports it as a flag, and the table shows "no full text" for `missing`. `proposal` (`status`, `source`, `reason`, `candidates`) marks metadata that was only guessed (first page, file name, web page) and awaits review. Older files that carry `fulltext` as `status: none` with `at` are read in the new form and rewritten on the next save.

### Document

`blocks.jsonl` is the canonical form of a converted document ([block model](decisions/0009-block-model.md)). Every block carries an id assigned once, a type, a section, text and spans with PDF page, printed page, character range and coordinates in the coordinate system of the original PDF:

```json
{"id":"b7f3k2q","type":"paragraph","sec":"2.1","flow":"body",
 "text":"...","spans":[{"page":4,"label":"215","start":0,"end":812,"bbox":[72.0,310.2,290.1,520.7]}],
 "src":{"engine":"docling@2.142.1","native":"#/texts/57"}}
```

On reconversion the core matches new blocks to old ones by page overlap, coordinates and text similarity and keeps the old ids. The mapping lands in `idmap.json` so links and cards keep resolving. `doc.md` and `doc.html` are derived from the blocks.

Printed page numbers come from, in this order: `/PageLabels` in the PDF, detected headers and footers (longest ascending number sequence, as Zotero does it), and the page range from Crossref as an offset. The user can confirm or correct the mapping once per PDF, and all cards of that PDF follow (`documents.confirmPages`).

### Quote card

One Markdown file per card, so two machines can highlight at the same time without git or iCloud conflicts, and so Obsidian can embed cards ([quote cards](decisions/0010-quote-cards.md)).

```markdown
---
id: c_01JB8Z3Q
item: luhmann1984soziale
source: 3f9a1c2e7b4d
kind: definition             # optional: thesis | finding | method | definition | example | critique
locator: {label: page, start: "31", end: "32"}   # unpaginated sources: {label: paragraph, start: "4"}
anchor:
  pdf: {page: 42, quads: [[72.0, 310.2, 290.1, 330.0]], file: 3f9a1c2e7b4d}
  text: {block: b7f3k2q, exact: "…", prefix: "…", suffix: "…"}
quote_sha256: 9c1d…         # hash of the wording, deviations are flagged
paraphrase: {by: "claude-code/haiku", at: 2026-10-23T11:02:00Z, checked: false}
tags: [kommunikation]
projects: [phd-proposal]
created: {at: 2026-10-23T11:01:40Z, by: human}
---
> Exact wording of the marked passage …

## Paraphrase
…

## Note
…
```

The wording sits in the quote block and stays unchanged. Omissions such as "[…]" are explicit edits. The card carries one AI text, the paraphrase of one to three sentences, and the paraphrase carries its provenance. The kind comes from the same request as the paraphrase: the AI assigns a kind when the card is created, the user can change it at any time, and a kind that is set is never overwritten when the paraphrase is regenerated. The section "Note" is a free field of the user. The sections have fixed headings that a strict parser reads, and unknown sections are preserved. A per-project setting decides which parts go into an export. The rule `own-else-ai` takes the note for indirect quotes and the paraphrase otherwise.

Cards from earlier versions stay readable. The parser reads the sections "In my words" and "Comment" as the note (own words, blank line, comment) and writes only "Note" on the next save. The kinds `quote` and `comment` count as unset, the other old kinds apply unchanged. A stored section "Core statement" with its stamp `core` survives a rewrite, is shown nowhere in the UI and is not read by search.

The card in the UI consists of a header (kind and locator), the wording, the paraphrase block, the note and two actions. A third cell of the same bar opens a short menu with "Connect" (a popover with a search over items, cards and notes, a relation and an optional reason) and "To the agent" (the card becomes a context chip of the chat). A card shows one line for its connections and one line for an open suggestion, and nothing when it has neither. The paraphrase block carries a star and a title, model and time appear in a tooltip, and the small action "Regenerate" with a language choice sits in its header. "Quote verbatim" copies the quote with its citation, "Quote indirectly" copies the note or the paraphrase with a "cf." citation.

Selections in the reader snap to word boundaries. `packages/anchoring` moves both edges of a selection outward until neither sits inside a word (`snapToWordBoundaries`; an apostrophe between letters belongs to the word, a hyphen does not), and the text anchor is built from the widened range (`createSelectionAnchor`). The PDF viewer and the text viewer set the visible selection to the same range once the pointer is released, and the quads of the PDF anchor follow the widened range.

A card has two anchors: a PDF anchor (page, quads, file hash) in the position format that Zotero uses, and a W3C text anchor (exact text, context before and after, block id as a hint). When an anchor is missing after reconversion, the core searches for the passage with fuzzy matching, as the Hypothesis client does.

### Note and link

```yaml
id: n_01JB9...
type: permanent              # permanent | literature | question | claim | project | daily | concept
title: Autopoiesis erklärt die Stabilität sozialer Systeme
links:
  - to: "[[luhmann1984soziale]]"
    rel: supports
    why: Kap. 1 begründet …
    evidence: "[[c_01JB8Z3Q]]"
    by: agent:claude-code
    status: proposed         # proposed | accepted | rejected
```

A connection can also start at a quote card ([ADR 0028](decisions/0028-connections-from-cards.md)). It is stored in the literature note of the card's item (the note of type `literature` with the line `Item: [[citekey]]`, created when it is missing) as a link with `from: c_...`, `evidence: "[[c_...]]"` and a target that is an item, a card or a note. The index treats such a link as an edge that starts at the card.

Links may stay untyped. A type is proposed and accepted by the user. A rejected link stays in the file with `status: rejected` so that `links.propose` does not suggest it again. The index does not know it, and it appears neither in backlinks nor in the graph. The vocabulary is small and maps onto the citation ontology CiTO:

| Group | Relations |
|---|---|
| Argument | `supports`, `opposes`, `qualifies`, `addresses` (refers to a research question) |
| Origin | `extends`, `uses-method-of`, `uses-data-from` |
| Structure | `elaborates` (Luhmann's Folgezettel), `related` as fallback |
| Automatic | `cites`, `excerpt-of`, `derived-from` |

The graph is the union of the links in notes, the wiki links, and the citation relations from `refs.jsonl` and OpenAlex. The index holds it as an edge table, and queries use recursive CTEs in SQLite. The UI draws it with sigma.js and graphology.

### Concept

A concept is a note of type `concept` in `notes/concepts/` with aliases in its frontmatter ([concept register](decisions/0021-concept-register.md)). It collects quote cards and holds, per source, an AI-written entry on how that source defines or uses the term. The entries sit in a generated block between `<!-- concept:entries` and `<!-- /concept:entries -->` and are verified against the card quotes. Concepts are managed with `cg concepts` and in the concept view of the UI. Agents reach them through the CLI, not through MCP tools.

### Matrix

A literature matrix belongs to a project (`projects/<slug>/matrices/`). Rows are items, columns are questions, and cells are answers with evidence. `matrix.fillCell` and `matrix.fill` let the AI fill cells from the passages of the sources, and `matrix.export` writes the table out.

### Project

`project.md` carries title, status, research questions with ids and the citation style in its frontmatter, and the project brief as body. Membership of a source is stored in the item (`projects:`), so an agent sees it with a single read. Agents receive the brief as context for every project task.

Plans, outlines, plan documents and insights are specified in [spec/research-planning.md](spec/research-planning.md) ([multiple plans and templates](decisions/0019-multiple-plans-and-templates.md), [outline and section files](decisions/0017-outline-and-section-files.md)).

### Texts

A text is a Markdown file under `projects/<slug>/texts/` ([Markdown with Pandoc](decisions/0002-writing-in-markdown-with-pandoc.md)). The format is in [spec/library-format.md](spec/library-format.md). The core reads citations with the scanner in `packages/schema` (`scanCitations`), which the editor (`packages/editor`, CodeMirror 6) also uses for its markers. `texts.export` writes the text, the CSL file of the style and the cited sources as CSL-JSON and as `.bib` into a working folder, calls Pandoc and puts the result into `exports/`. Word, PDF and Markdown use `--citeproc`. LaTeX keeps the citations as biblatex commands and comes as a ZIP with `references.bib`. For PDF the core looks for xelatex, lualatex, tectonic, pdflatex or Typst. It finds Pandoc in `PATH`, in Homebrew or in `<local base>/pandoc/<version>/`, where `pandoc.setup` downloads the pinned release (3.12.1).

## Ingest

```
Input ──► Detect ──► Metadata ──► Fetch source ──► Convert ──► Enrich ──► Index
```

- **Input:** PDF, DOI, arXiv ID or link, ISBN, PMID, URL, BibTeX snippet, Zotero Connector, MCP, importers.
- **Detect:** DOI, arXiv ID and ISBN by regex on the first pages and from XMP. Then GROBID header data with a title comparison, accepted only when title similarity, first author, year (plus or minus one) and type agree. A search score alone is not enough. Last, an AI task (`metadata.fromFirstPage`) reads the first page and proposes CSL fields, which stay marked as a proposal.
- **Metadata:** For citation fields (DOI, year, type, pages, title, author order) the record of the registration agency wins (Crossref, DataCite through doi.org). OpenAlex adds ORCIDs, institutions, topics and references, and abstracts come from whichever source has one. PubMed serves PMIDs. Books come from DNB and K10plus, with Open Library as fallback. Input from the user always wins. All lookups go through a shared client with a cache and a rate limit per source.
- **Fetch source:** open-access PDFs through Unpaywall, OpenAlex locations and arXiv, the `citation_pdf_url` tag of the publisher page, and arXiv HTML where it exists.
- **Convert:** Python worker, see below. After a successful conversion the core rereads the first page of the PDF for guessed metadata (placeholder title, missing author, review flag): identifiers first, then `metadata.fromFirstPage` with a title comparison. Confirmed values replace the guessed ones, and values from users and registration agencies stay untouched.
- **Enrich:** references (`refs.jsonl`), citation graph through OpenAlex (`graph.*`, including retraction checks through Crossref and OpenAlex) and, when semantic search is on, embeddings.

A URL is fetched like a browser would (redirects, browser headers) and judged by its content: a response that starts with `%PDF` is treated like a local PDF, whatever the address or content type says. When an address that points to a file returns a web page (login, cookie or bot wall), the call fails with `URL_RETURNED_HTML` and asks to download the file and pass its path.

A duplicate is a hit on DOI, ISBN, arXiv ID, PMID, URL or file hash, or else on full title with year and first author. When the matched item has no working source, the core attaches the new file and converts it instead of discarding it.

What an agent adds lands in the inbox first, where the user accepts or discards it. With `target: "library"` an agent puts a paper directly into the library. What the user adds lands directly in the library ([agent content goes to the inbox](decisions/0014-agent-content-goes-to-inbox.md)).

Every step is a job in `state.sqlite` with status, progress and retry. The job kinds are `ingest`, `resolve-metadata`, `fetch-source`, `convert`, `enrich`, `embed`, `ai-task`, `research`, `import`, `export`, `alerts`, `worker-setup`, `litsearch.run`, `litsearch.preprints` and `pandoc-setup`. Slow work returns a job handle at once over MCP, and `jobs_get` reports the status.

### Importers

`packages/import` reads Zotero (the `zotero.sqlite` file, which is copied before it is read, or the Zotero 10 local API on port 23119 while Zotero runs), BibTeX/BibLaTeX, RIS and CSL-JSON, optionally with a folder of PDFs ([importers](decisions/0003-importers.md)). `import.preview` reports what a run would do without writing anything, and `import.run` executes the plan as a job. Zotero annotations become quote cards, notes become notes, and duplicates are detected against the existing library.

### Conversion

The scope of conversion is described in [conversion scope](decisions/0004-conversion-scope.md). The worker (`workers/convert`) speaks JSON-RPC 2.0 over stdio with the methods `health` and `convert`.

| Path | When | Tools |
|---|---|---|
| arXiv | arXiv HTML exists | clean up LaTeXML HTML, map pages through the jump targets in the arXiv PDF |
| Digital | PDF with a text layer that passes the dictionary check | Docling (MIT) for layout and blocks, GROBID (native on Apple Silicon) for header data and references, optional formula enrichment |
| Scan | no or poor text layer, or `ocr: "force"` | Docling with Apple Vision OCR. Pages below the quality gate are flagged |
| Web | articles, grey literature | trafilatura, then the same block model without pages |

## AI layer

### Backends

AI tasks run through the interface `InferenceBackend` (`packages/ai`): `complete` returns structured output validated against a Zod schema, and `resolveModel` turns a model class (`fast` or `smart`) into a model name. The interface has a `session` method for agentic work, but no inference backend implements it. Agentic work runs in the chat (see below).

| Backend id | Route | Notes |
|---|---|---|
| `claude-code-cli` | `claude -p` per call with `--json-schema`, no tools, no user settings, isolated working directory | pinned minimum CLI version |
| `codex-exec` | `codex exec --output-schema --ephemeral` per call | models default to the account default |
| `cursor-cli` | `agent -p --mode ask` per call (read-only mode) | |
| `openai`, `anthropic`, `openrouter`, `xai` | OpenAI-compatible HTTP endpoints, API key in the macOS Keychain | optional per task |
| `ollama` | OpenAI-compatible endpoint on `localhost:11434` | optional per task |

`claude -p --bare` reads only API keys and ignores the subscription login, so citegeist does not use `--bare` and pins the minimum Claude Code version. Routing (which backend serves which task) is a setting, with `*` as the fallback entry. Every call is recorded in the usage ledger ([cancellation, limits and usage ledger](decisions/0025-cancellation-limits-and-usage-ledger.md)): tokens, cache tokens, list price where the backend reports one, duration and result, per task and backend, in `state.sqlite`. `usage.summary` reads it.

Background: [inference backends](decisions/0012-inference-backends.md), [agent interfaces](decisions/0013-agent-interfaces.md).

### Chat agents

The chat sidebar and research jobs (`packages/chat`) talk to an agent over the Agent Client Protocol (ACP). citegeist is the ACP client. It ships the adapters `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp` as pinned dependencies, which run the `claude` and `codex` programs that the user installed. Cursor starts with `agent acp`. When the Claude adapter cannot start, a fallback streams through `claude -p`. Every session receives the citegeist MCP server with its own token.

Chat sessions use the environment of the user instead of isolation ([chat agents use the user's environment](decisions/0020-chat-agents-use-the-users-environment.md)). The agent of the sidebar gets the same environment as the user's own Claude Code:

| | Default | Setting "Isolated agent" |
|---|---|---|
| Claude Code (ACP adapter) | `settingSources: ["user", "project"]`, shell allowed, MCP servers of the user loaded | `settingSources: []`, `strictMcpConfig`, shell blocked |
| Claude Code (fallback `claude -p`) | `--setting-sources user,project`, `Bash` allowed | `--strict-mcp-config`, no settings, `Bash` blocked |
| Codex | Codex configuration of the user | same configuration, permission rule below |
| Permission rule | shell, other tools and changes outside the library allowed | shell and changes outside library text and working folder rejected |

The library keeps its protected areas (`derived`, `sources`, `exports`, `citegeist.json`) in every mode. Research jobs always run isolated. The setting is `chat.isolated` in `settings.json` and takes effect from the next message of a session. Agent edits in a chat are written directly, and every turn is journaled so that `chat.revertTurn` restores all files of the turn ([direct agent edits with undo](decisions/0018-direct-agent-edits-with-undo.md)).

Research jobs (`research.start`) run an agent with the web search, the read tools and `add_item`. Found papers land in the inbox with a reason. A job has limits for time (20 minutes), tokens (2,000,000) and tool calls (200) by default, and a loop of identical calls ends it.

### Tasks

Each AI task is an entry in `packages/ai/src/tasks/` with input and output schema, versioned prompt, default model class and eval fixtures. The tasks: `card.paraphrase`, `card.verify`, `card.suggestLinks`, `note.proposeLinks`, `metadata.fromFirstPage`, `matrix.fillCell`, `concept.describe`, `concept.name` and `litsearch.suggestQueries`.

The language of all AI texts (paraphrase, concept entries) follows a chain: dropdown on the source being read, then the project setting, then the library default ([AI text language](decisions/0016-ai-text-language.md)). The dropdown is reachable in the reader at any time.

Every agent answer with a quote goes through a check: a quote that matches no stored passage is flagged.

### Embeddings

Subscriptions offer no embeddings, so embeddings run locally with Transformers.js on quantized ONNX weights with pinned revisions (`packages/embed`). Semantic search is optional and off by default. The settings offer two models:

| Model | Key | Vectors | License |
|---|---|---|---|
| EmbeddingGemma 300M (default) | `embeddinggemma-300m` | 512 dimensions | Gemma Terms of Use |
| Qwen3-Embedding 0.6B | `qwen3-embedding-0.6b` | 512 dimensions | Apache-2.0 |

An optional local cross-encoder reranker (`bge-reranker-v2-m3` by default) re-sorts the best fused candidates and is off by default. The choice of the default model follows the retrieval check in `packages/embed/RETRIEVAL.md` ([retrieval benchmark](decisions/0026-retrieval-benchmark.md)); `pnpm eval:retrieval` runs it.

Sections of converted documents are embedded together with the path of their headings.

## Agent interfaces

### MCP server

- TypeScript SDK v2 (`@modelcontextprotocol/server`), spec revision 2026-07-28.
- `cg mcp` is a stdio server for local clients. `cg mcp --http` serves Streamable HTTP on `127.0.0.1` with bearer tokens and Origin and Host validation. For Claude Desktop there is a `.mcpb` bundle (`skills/citegeist/mcpb`).
- Twenty tools, derived from the operations that declare an `mcp` entry. Tools sort by name so the tool list stays byte-identical between calls.

| Scope | Tools |
|---|---|
| `read` (read-only hint) | `search`, `get_item`, `read_document` (by page, section or block), `list_cards`, `list_projects`, `get_project` (project, plans and outline in one call), `related_works` (cited and citing works of an item, `direction`), `cite`, `jobs_get`, `find_insights` |
| `write` (all tools) | the `read` tools plus `add_item`, `attach_file` (attach a local file to an existing item and convert it), `trash_item` (inbox items, incomplete items and items an agent added, as long as no card or link refers to them; the trash folder records who deleted), `create_card`, `create_note`, `link`, `create_project`, `edit_outline`, `edit_plan_doc`, `note_insight` |
| `research` | the `read` tools plus `add_item`, without local files and only for addresses on scholarly hosts |

Every response has a short text plus `structuredContent`, and full texts come as `resource_link`. `admin` operations are never exposed.

- Server instructions stay under 4,096 characters because Claude Code loads only tool names and instructions at startup.
- Error texts name operations once under their operation name (`items.trash`). The MCP server rewrites them to the tool name (`trash_item`), the CLI to the command (`cg items trash`). An operation without a tool on the connection appears as a `cg` command with a note that the user has to run it. A test makes sure every operation name in the sources exists.
- Concepts, matrices, literature search, alerts, texts, import, sync and webhooks have no MCP tools. Agents with a shell reach them through `cg`.

### CLI

`cg` covers all operations, with `--json` for agents with a shell. For bulk work (importing 50 DOIs) it is cheaper than MCP, because the agent can filter the output before reading it. The library comes from `--library <folder>`, then `CITEGEIST_LIBRARY`, then `~/Citegeist`.

### Skill and plugin

A portable skill at `skills/citegeist/SKILL.md` follows the Agent Skills specification and is built like a gstack skill: frontmatter with description and triggers, clear flows (add a paper, create a quote card, link a note, produce a citation) and agent-readable errors. It tells the agent to use MCP when connected and the CLI otherwise. `.claude-plugin/plugin.json` packages the skill and the stdio server as a Claude Code plugin.

### AGENTS.md in the library folder

citegeist generates and maintains an `AGENTS.md` that explains the folder format and states the rules: write through `cg` or MCP, note text may be edited directly, `derived/` and card wordings stay untouched, new content carries `by: agent:<name>`.

### Webhooks and external agents

See [webhooks.md](webhooks.md) for the operational details ([webhooks](decisions/0015-webhooks.md)). Outbound, citegeist sends a job with context and a callback address by HTTP POST, signed with HMAC and, on request, with the agent platform's own key in an auth header (the value sits in the Keychain). Inbound, an endpoint accepts papers and notes and treats them like input over MCP: inbox by default, directly into the library with `target: "library"`. Besides the HMAC signature, a per-connector bearer token can be enabled for agents that cannot compute a signature.

The core listens on a random private port. For calls from the internet it opens, as long as a connector exists, a second listener on `127.0.0.1` and a fixed port (default 47321, configurable). That listener serves only `/hooks/<name>` and `/mcp`, and a tunnel (Tailscale Funnel, Cloudflare Tunnel) points at it. The public tunnel address is a setting and is used for all callback addresses.

`/mcp` carries the MCP server of the core over Streamable HTTP, with the same tool set and implementation as `cg mcp --http`. Only connectors for which the user enables it get access, with their own token in the Keychain. The actor is `agent:<connector>`, new content lands in the inbox, and `admin` operations and local file access are excluded ([remote MCP through a tunnel](decisions/0023-remote-mcp-through-a-tunnel.md)).

### Zotero Connector

The core can speak the Zotero Connector protocol on a configurable port (default 23119, off by default), so the official Zotero browser extension saves directly into citegeist. The translators run in the browser, so citegeist receives finished records and downloads PDFs with the user's cookies. Only browser extensions may call the listener. When Zotero itself runs, it uses the same default port.

### Quick insert

A global hotkey (default `CommandOrControl+Shift+K`) opens a palette that searches quote cards in any app and pastes the chosen citation into the frontmost app. Pasting needs the macOS accessibility permission.

## Search and index

`index.sqlite` (better-sqlite3) holds tables for items, creators, identifiers, blocks, cards, notes, links, projects and tags. Full text runs over two FTS5 tables: one with `unicode61` tokenizing and diacritic removal (stemmed in JS before indexing, German and English) and a trigram table for partial words. Vectors live in sqlite-vec (`vec0`, cosine distance). Search combines full text, vectors and filters by reciprocal rank fusion, optionally with a local reranker. Every query names its scope: project, collection or the whole library.

A full rebuild reads only the library folder (`library.reindex`).

## Sync and versioning

Exactly one sync transport is active at a time ([sync and versioning](decisions/0005-sync-and-versioning.md)): `none`, a synced folder (`icloud`, `dropbox`) or a `git` remote. `sync.configure` selects it, and a git remote is refused while the library sits in iCloud or Dropbox. Independent of the transport, the core can keep a git history of the library with one commit per actor after quiet periods, so changes by agents show up as their own commits. When the library sits in a synced folder, the `.git` directory lives machine-local. PDFs can go to git LFS. A background timer runs `sync.now`: git pull with rebase and push, or downloading evicted iCloud files and looking for conflicts.

Because every card and every note is its own file, conflicts arise only when two machines change the same file. The core lists conflict copies (`sync.status`), and `sync.resolveConflict` keeps version a, version b or both.

## Alerts and literature search

Alerts are saved watches that look for new works on a schedule and put the best ones into the inbox with the reason `Alert: <name>`. Definitions are plain YAML files (`projects/<slug>/alerts.yaml`, `alerts.yaml` at the library root). Source kinds are `arxiv-category`, `arxiv-query`, `openalex-topic`, `openalex-search`, `author`, `cites` and `pipeline`. The last run and the already-seen list stay machine-local.

The literature search ([literature search](decisions/0022-literature-search.md)) runs the pipeline of `workers/research` as a `litsearch.run` job. A run searches OpenAlex, arXiv and Semantic Scholar, optionally DBLP, OpenReview, Unpaywall and ORCID, ranks every paper with a score from 0 to 100, verifies each DOI and writes the result to `research/runs/<id>/`. Selected papers go to the inbox. A `pipeline` alert repeats a saved search and sends only new papers to the inbox. The preprint check (`litsearch.preprints`) looks for published versions of preprints.

## Security

Details are in [security-model.md](security-model.md). The facts that the code enforces:

- All local servers bind to `127.0.0.1` and validate Origin and Host against DNS rebinding. The MCP HTTP server refuses to bind to any other address.
- The token of the HTTP endpoint is in `core.token` with mode 0600. MCP HTTP tokens have scopes (`read`, `write`, `research`) and are compared in constant time. Each chat session gets its own token, which is revoked when the session ends.
- The access class `admin` (settings, deleting without trash, webhook management) is not reachable over MCP, and the registry refuses it for non-human actors.
- API keys and webhook secrets are stored in the macOS Keychain, never in `settings.json` or logs.
- Foreign text (PDF and web content, metadata, texts from agents and webhooks) enters the prompts of AI tasks only datamarked, see `packages/ai/src/untrusted.ts` ([untrusted text and the rule of two](decisions/0024-untrusted-text-and-rule-of-two.md)).
- The MCP token of a research job has the scope `research`: the read tools and `add_item`, no local files, and no address outside the scholarly hosts.
- Inference calls and isolated or research chat sessions run without the personal agent configuration of the user. Sessions in the default chat mode use it on purpose.
- The webhook listener limits the body size to 1 MiB, rejects replayed delivery ids and rate-limits repeated authentication failures.

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron 45 (`apps/desktop`), electron-vite, electron-builder; unsigned arm64 build |
| Core | Node 22 or newer (`engines`), TypeScript; the packaged app runs the core on Electron's Node |
| UI | React 19, Base UI, Tailwind v4, TanStack Router and Query |
| RPC | oRPC |
| Schemas | Zod 4, JSON Schema export |
| PDF | pdfjs-dist 6 with a custom highlight layer, Floating UI (`packages/reader`) |
| Editor | CodeMirror 6 with live preview (`packages/editor`) |
| Index | SQLite (better-sqlite3), FTS5, sqlite-vec |
| Watcher | @parcel/watcher |
| Embeddings | Transformers.js |
| Graph | sigma.js with graphology |
| Citing | citation-js with CSL styles (APA, Chicago author-date, DGP are bundled), @retorquere/bibtex-parser |
| Conversion | Python 3.12 with uv, Docling, GROBID, Apple Vision OCR (ocrmac), trafilatura |
| Agent protocols | MCP TypeScript SDK v2, Agent Client Protocol SDK |
| Monorepo | pnpm, Turborepo, Vitest, Playwright, Biome |

## Packages

| Path | Purpose |
|---|---|
| `packages/schema` | Zod schemas, JSON Schema export |
| `packages/ops` | Operations registry and contracts |
| `packages/core` | Store, index, watcher, jobs and the services behind the operations |
| `packages/metadata` | Resolvers and merge |
| `packages/cite` | CSL, BibTeX, RIS, citekeys, citation export |
| `packages/ai` | Inference backends, tasks, evals |
| `packages/embed` | Local embedding models and rerankers |
| `packages/import` | Importers (Zotero, BibTeX, RIS, CSL-JSON) |
| `packages/mcp` | MCP server built on the registry |
| `packages/chat` | Agent chat over ACP, turn undo, research jobs |
| `packages/webhooks` | Connectors, signatures, inbound and outbound requests |
| `packages/server` | Core process: HTTP/oRPC/WebSocket, lockfile, chat wiring, Zotero Connector, hooks listener |
| `packages/anchoring` | Anchor library (pure TypeScript) |
| `packages/reader` | PDF and text view with highlight layer |
| `packages/editor` | Markdown editor with citation support |
| `apps/cli` | `cg` command, including `cg mcp` |
| `apps/ui` | React renderer, also runs in a browser against a mock core |
| `apps/desktop` | Electron main and preload, quick insert |
| `workers/convert` | Python conversion worker |
| `workers/research` | Python literature search pipeline |

## Risks and assumptions

- Conversion quality depends on Docling and GROBID. Page assignment and reading order are checked against the fixture PDFs in `fixtures/` by the worker tests, and a printed page number can be confirmed per PDF.
- The inference backends depend on the command line interfaces of Claude Code, Codex and Cursor, which change quickly. citegeist pins minimum versions and checks login state with the CLIs' own status commands.
- Files as the truth tolerate concurrent writes from the app and from agents because the core writes atomically and the watcher revalidates outside changes. Conflicts between machines are resolved at file level.
- Semantic search quality was measured on a small German and English retrieval set ([retrieval benchmark](decisions/0026-retrieval-benchmark.md)).

## License

The project is licensed under Apache-2.0. Zotero code that is licensed under AGPL runs only as a separate process or in the user's browser, and citegeist reads its records through the Connector protocol. Details on dependencies, bundled CSL styles and models are in [licenses.md](licenses.md).

# Landscape: reference managers, reading tools, AI research tools and Zettelkasten practice

Research date: 2026-10-23. This document covers what existing tools do well or badly and which ideas citegeist should adopt or avoid. Zotero and Citavi knowledge items are covered in depth by other research docs, so they appear here only briefly.

## Verification legend and limits

Every factual claim carries one of these markers:

- **[V]** I read the first-party source (vendor page, official docs, repo README, forum post, peer-reviewed paper) in this session.
- **[R]** A third-party or aggregator source reports it, and I did not confirm it at the source.
- **[K]** It comes from my prior knowledge and I did not re-verify it in this session.
- **[I]** It is my inference or recommendation.

Limits of this research:

- Reddit refused my crawler (HTTP 400 for reddit.com), so the complaints in section 7 come from the Zotero forums, the Obsidian forum, the Zettelkasten forum, MobileRead, LWN, vendor blogs and studies. I found no relevant Hacker News threads.
- The shared WebSearch budget ran out near the end of the session. I could not run a dedicated search for notable 2026 entrants beyond those listed, and I could not re-check the current status of Khoj, Kortex, Readest's AI features, Litmaps' AI features or the Hypothesis service in 2026.
- Many 2026 feature claims for commercial tools come from aggregator sites. They are marked [R].

---

## 1. Open-source reference managers and readers

### Summary table

| Tool | What it is | Status in 2026 | The one idea worth stealing |
|---|---|---|---|
| Zotero | The default open-source reference manager | Zotero 8 added a native citation-key field; Zotero 10 beta adds write support to the local API [V] | Browser connector plus translators as an ecosystem asset (Wren reuses it) |
| JabRef | Java desktop manager whose database is a BibTeX/BibLaTeX file | 6.0 in pre-release: alpha 6 (May 2026) [V]; the blog lists a post on a beta release from 2026-09-21 that I did not read [R]; 4.8k stars [V] | The `.bib` file is the database, so the library is plain text and git-diffable |
| Paperlib | Electron paper manager for CS/ML papers | Release 3.1.12 is the latest, the maintainer is looking for a collaborator [V] | Pluggable metadata scrapers for papers without DOIs (NeurIPS, ICLR) |
| Papis | Python CLI manager, one folder plus `info.yaml` per document | Packaged on AUR in June 2026 [R], 1.8k stars [V] | One human-editable YAML file per document inside its own folder |
| Zettlr | Markdown editor for academic writing with citations | 4.0 (Dec 2025) to 4.8.0 (Sep 2026) [R], 13.8k stars [V] | Pandoc citekeys in plain Markdown with live citation preview |
| Readest | Tauri v2 ebook reader, Foliate rewrite | Active, AGPL, AI summarization listed as "building" [R] | Tauri cross-platform shell for a reader |
| KOReader | E-ink document reader | Highlights live in `.sdr` sidecar folders; community Obsidian importers exist [R] | Sidecar metadata that travels with the document |
| Calibre | Ebook library manager | 8.16.0 (Dec 2025) added "Discuss with AI", with strong backlash [V] | Library folders on disk that let the database be rebuilt |
| Hypothesis | Open web annotation layer on W3C standards | 2026 status not verified; Anno PBC spin-off since 2022 [R] | Multi-selector anchoring that survives document changes |
| Wren (new) | Local-first Tauri/Rust Zotero alternative | v0.1.0, macOS only, 7 stars [V] | Zotero-connector compatibility plus a local REST API and deep-link URL scheme |
| Hypernomicon | JavaFX research database for debates, positions, arguments | Active, Apache 2.0, 188 stars [V] | Typed research records (debate, position, argument, term) linked to works |

### Zotero (brief)

- Zotero 8 introduced a native citation-key field that replaced Better BibTeX's own field. The migration broke citekey-based workflows for weeks; Zettlr's maintainer published a recovery guide on 2026-03-07 and recommends to "double-check each citation key before submitting papers or theses" ([Zettlr blog](https://zettlr.com/post/on-the-recent-issues-with-zotero-8-and-better-bibtex)) [V]. Better BibTeX v9 now targets Zotero 8 and 9 ([BBT changelog](https://retorque.re/zotero-better-bibtex/changelog/index.html)) [R].
- On 2026-07-29 Zotero developer dstillman wrote: "Write requests are supported in Zotero 10, currently in beta" ([Zotero forum](https://forums.zotero.org/discussion/132977/)) [V]. Until then the local API was read-only, which is why most Zotero MCP servers wrote through the web API.
- A community reply in June 2026 states that Zotero ships no generative AI unless a plugin adds it ([Zotero forum](https://forums.zotero.org/discussion/comment/514896/)) [R]. Users in the same forums ask Zotero to keep a version free of generative AI.

### JabRef

- JabRef 6.0-alpha (2024-12-23) added opt-in AI summaries and an AI chat over linked PDFs, a Markdown export, and a search backend on embedded PostgreSQL ([JabRef blog](https://blog.jabref.org/2024/12/23/JabRef6-0-alpha/)) [V]. The AI docs describe chunking linked PDFs, embedding each chunk and retrieving by vector similarity before calling an external provider; a page on running a local model exists ([JabRef docs](https://docs.jabref.org/ai)) [V].
- Alpha 5 (2026-02-22) focused on a citations tab with fetchers based on OpenCitations and OpenAlex ([alpha 5 post](https://blog.jabref.org/2026/02/22/JabRef6-0-alpha5/)) [R]. Alpha 6 (2026-05-14) lets the user choose the fetcher for citation counts and drag entries out of the citation tab ([alpha 6 post](https://blog.jabref.org/2026/05/14/JabRef6-0-alpha6/)) [V]. A Google Summer of Code project works on OCR and AI for older documents, and the CLI is called JabKit [V].
- Idea for citegeist [I]: a "citation relations" panel inside the entry view (cites and cited-by from open data) makes snowballing a side effect of reading the metadata.

### Paperlib

- Paperlib is a GPL-3.0 Electron app for Mac, Windows and Linux with metadata scraping through many scrapers (custom ones supported), RSS feeds for new publications, Markdown notes, and Word plus macOS citation plugins ([GitHub](https://github.com/Future-Scholars/paperlib)) [V]. Extensions add LLM summaries, LLM auto-tagging, semantic search and an AI chat extension [V].
- The README says: "I'm looking for someone to work with me on developing Paperlib" [V]. The latest release on GitHub is `release-electron-3.1.12` dated 28 Sep, and the releases page does not show the year ([releases](https://github.com/Future-Scholars/paperlib/releases)) [V]. I could not determine whether that means 2025 or 2026.
- The README names the real pain it solves: conference papers without DOIs (NeurIPS, ICLR) are hard to look up [V]. That matters for Jonny's technical AI reading.

### Papis

- Papis stores each entry's bibliographic data in "a human-readable and easily hackable `.yaml` file", is driven from the command line, and lists `papis-ask` ("AI for Papis", maintained by Julian Hauser) in its ecosystem ([GitHub](https://github.com/papis/papis)) [V]. A separate plugin, papisqa, wires PaperQA into Papis ([GitHub](https://github.com/isaksamsten/papisqa)) [R].
- Idea for citegeist [I]: a document is a folder (`paper.pdf`, `paper.md`, `info.yaml`, `annotations.json`). An agent can read and edit that with plain file tools, and a user can recover everything without the app.

### Zettlr

- Zettlr 4.0 shipped on 2025-12-26 with a rewritten citation parser that shows how a citation will be parsed while typing, pandoc-crossref support, a new table editor and a built-in PDF viewer ([Zettlr 4.0 post](https://zettlr.com/post/zettlr-400-released)) [R]. Version 4.8.0 followed on 2026-09-18 ([Wikipedia](https://en.wikipedia.org/wiki/Zettlr)) [R].
- The README advertises integration with Zotero and JabRef, Zettelkasten link and tag management, and export through Pandoc and LaTeX ([GitHub](https://github.com/Zettlr/Zettlr)) [V]. Zettlr reads an exported CSL-JSON or BibTeX file, so it depends on the reference manager keeping citekeys stable [V, via the Zotero 8 post].

### Readest and KOReader (brief)

- Readest describes itself as a rewrite of Foliate on Next.js and Tauri v2 for desktop, mobile and web, AGPL, with highlights, bookmarks, notes and account sync; AI summarization appears under "Building" ([itsfoss](https://news.itsfoss.com/readest-app), [Korben](https://korben.info/en/readest-open-source-ebook-reader.html)) [R].
- KOReader keeps annotations in `.sdr` sidecar folders next to each document. Several community Obsidian plugins (KOHi, KOReader Highlight Importer) parse them into Markdown notes ([KOHi](https://community.obsidian.md/plugins/kohi), [importer](https://community.obsidian.md/plugins/koreader-highlights-importer)) [R].

### Calibre (brief)

- Calibre 8.16.0 (2025-12-04) added "Discuss with AI". Each LLM provider is a plugin, local models run through LM Studio or Ollama, and the feature itself cannot be removed ([LWN, 2025-12-15](https://lwn.net/Articles/1049886)) [V]. Users called it "morally repugnant", a "remove slop" pull request was rejected, forks appeared, and maintainer Kovid Goyal answered: "It's not going to be scrapped, so good bye, I guess" [V]. A tweak to hide the menu entries was accepted later [V].
- Calibre's FAQ explains that each book folder carries the database id so that calibre can "regenerate the database with all metadata if the database file gets corrupted" ([FAQ](https://manual.calibre-ebook.com/faq.html)) [V].

### Hypothesis

- Hypothesis builds on the W3C Web Annotation standards. Its anchoring stores several selectors per annotation: a RangeSelector (XPaths plus offsets), a TextPositionSelector (character offsets in the full text) and a TextQuoteSelector (exact text plus 32 characters of prefix and suffix). On reload it tries them in order and ends with fuzzy matching via diff-match-patch ([Fuzzy Anchoring, 2013-04-22](https://web.hypothes.is/blog/fuzzy-anchoring/)) [V].
- In 2022 Hypothesis formed Anno, a public benefit corporation, and reported over a million users with nearly 40 million annotations ([Say Hello to Anno](https://web.hypothes.is/?p=22099), [40 million annotations](https://web.hypothes.is/blog/category/science/)) [R]. I found no 2026 news.
- Idea for citegeist [I]: store every highlight with at least a quote selector (exact plus prefix and suffix) and a position selector, in addition to PDF coordinates. A re-OCRed or replaced PDF version can then be re-anchored instead of losing the highlight.

### Newer open-source entrants (2025-2026)

- **Wren** is the closest existing project to citegeist ([GitHub](https://github.com/thewrenapp/wren)) [V]: Tauri 2 with a Rust backend, React 19, SQLite, Tantivy full-text search, LanceDB vectors, pdfium plus on-device layout analysis, OCR and table recognition that turn PDFs into Markdown, optional providers (OpenAI, Anthropic, Gemini, Ollama, oMLX), a REST API on 127.0.0.1, a `wren://` URL scheme that deep-links to a PDF page or annotation, and bring-your-own-cloud sync by symlinking the library into iCloud or Dropbox while indexes and keys stay per device. It states that it is "Zotero-_compatible_ enough that the standard Zotero browser connector works against it". It has no MCP server yet, and its AI features (summaries, knowledge graph, "Ask your library") are planned. Status: v0.1.0, macOS only, 7 stars.
- **Hypernomicon** tracks terms, debates, theories, positions, arguments and counterarguments, authors and works, and generates semantic hyperlinks between them; it integrates with Zotero and Mendeley ([GitHub](https://github.com/jasonwinning/hypernomicon)) [V]. It shows that philosophers already want argument-level records next to bibliographic records.
- **OneCite** turns DOIs, PMIDs, arXiv IDs and BibTeX fragments into verified records and leaves ambiguous references unresolved with reason codes instead of emitting clean-looking citations ([GitHub](https://github.com/HzaCode/OneCite)) [V].
- The GitHub `reference-manager` topic (checked 2026-10-23) shows most new activity around agent access to existing libraries: `omabib` (Rust, built-in MCP), `labshelf` (local-first, VS Code and terminal interfaces), `zotero-agent` (CLI, MCP and bridge plugin), `cli-anything-zotero` (70+ commands for Zotero 7/8/9, 139 stars), `docsagent` (MCP search over Zotero, Obsidian and Apple Notes, 577 stars), and `Lattice` (Swift literature manager for macOS, 162 stars) ([topic by stars](https://github.com/topics/reference-manager?o=desc&s=stars), [topic by update](https://github.com/topics/reference-manager?o=desc&s=updated)) [V].
- **Qiqqa** went open source around 2019/2020; its last stable release listed on Wikipedia is v82 (October 2020) and the commercial cloud is gone ([Wikipedia](https://en.wikipedia.org/wiki/Qiqqa), [GitHub issue](https://github.com/jimmejardine/qiqqa-open-source/issues/358)) [R]. I treat it as dormant [I].

Inference [I]: in 2026 the open-source energy goes into bolting agents onto Zotero. Nobody has shipped a mature local-first manager that was designed for agent access and citable excerpts from the start. Wren is the only serious attempt I found, and it is at v0.1.0.

---

## 2. Commercial reference managers

| Tool | 2026 state | Worth adopting | Worth avoiding |
|---|---|---|---|
| Citavi (Lumivero) | AI Assistant since 2024; AI output labelled "AI:" in the UI; Windows desktop plus Citavi Web | Persistent visible label on AI-generated text | Windows-only desktop; Mac users rely on the web client |
| Paperpile | "Ask AI" hands PDFs to external assistants (May 2026); free Citation Checker (May 2026) | Hand-off to the user's own assistant; deterministic citation checking | Browser and Google-centric storage |
| Mendeley | Reading Assistant, Compare Experiments, Ask My Library (reported Dec 2025) | Nothing new | Opaque RAG limits; 2018 database encryption |
| EndNote 2025 | Quote and Cite from PDF; Research Assistant (chat, selection summary, translation) | One click from PDF selection to quoted citation in the manuscript | Subscription gating of AI features |
| ReadCube Papers | Papers Pro and ReadCube AI Assistant (2024); literature monitoring | Answers that show where in the document they came from | No visible 2026 progress |
| Bookends (Mac) | MCP server (15.4.2, 2026-07-16); Apple on-device model as metadata fallback (15.2.2) | Native MCP plus on-device model fallback | Mac-only proprietary library |

### Citavi (brief, see the dedicated Citavi research)

- Citavi belongs to Lumivero (QSR International, Palisade and Addinsoft merged in 2022) ([Wikipedia](https://en.wikipedia.org/wiki/Citavi)) [R]. Lumivero markets AI key insights per article and AI passage summaries, and a 2026 Lumivero post says AI-generated summaries carry a clear "AI:" label in the interface ([Lumivero](https://lumivero.com/products/citavi/)) [R]. A promotion from 2026-08-18 to 2026-09-15 bundled AI including a new "AI Paper Search" [R].
- Citavi Web is the route for Mac users [R].

### Paperpile

- On 2026-05-06 Paperpile launched "Ask AI" (beta): "Paperpile will send your full-text PDF and selected prompt to the AI assistant". It supports ChatGPT, Gemini, Claude and Copilot with up to 10 PDFs per thread, NotebookLM with 50 PDFs per notebook on free plans and 600 on the top tier, and it plans to connect "agent-based tools like Claude Code" ([Paperpile blog](https://paperpile.com/blog/pdf-ai-assistant/)) [V].
- On 2026-05-27 Paperpile released a free Citation Checker that verifies every entry of a BibTeX file and flags likely hallucinations; the post cites Zhao et al. (2026) estimating "~0.4% of all citations" in recent arXiv submissions as hallucinated and concludes "using AI to generate a bibliography is not worth the risk" ([Paperpile blog](https://paperpile.com/blog/citation-checker-hallucinations/)) [V].
- Inference [I]: Paperpile's bet matches citegeist's premise. The reference manager owns the clean data and hands it to the assistant the user already pays for.

### Mendeley

- Elsevier's support pages describe Ask My Library as RAG over the user's PDFs that sends only the top twenty snippets to the LLM, limits each query to 500 characters, and does not yet support filtering by collection or document ([Elsevier support](https://www.elsevier.support/mendeley/answer/mendeley-ai-ask-my-library-frequently-asked-questions-)) [R, official page seen only as a search excerpt]. The December 2025 launch date of the AI suite comes from an aggregator ([yespress](https://yespress.io/elsevier-mendeley)) [R].
- In 2018 "Elsevier began encrypting the local Mendeley database, making it unreadable by Zotero and other standard database tools"; Mendeley's export formats lack folders, several metadata fields and PDF annotations ([Zotero KB](https://www.zotero.org/support/kb/mendeley_import)) [R, official page seen only as a search excerpt].

### EndNote

- EndNote 2025 (press release 2025-04-23) added Key Takeaway, a journal matcher and Cite from PDF; the docs describe selecting text in the PDF viewer and pressing "Quote and Cite", which inserts the selection in quotation marks followed by a formatted citation into Word ([EndNote docs](https://docs.endnote.com/docs/endnote/2025/macos/v1/content/03editref/inserting_quotations-pdfs.htm), [Nasdaq press release](https://www.nasdaq.com/press-release/clarivate-releases-endnote-2025-ai-powered-research-tools-2025-04-23)) [R]. Whether the page number is inserted automatically was not documented in what I found.
- The Research Assistant (blog post 2025-09-23) offers chat with an attached PDF, Key Takeaway, summaries of a highlighted selection and translation; Clarivate states it "does not share or pass any user data to LLMs for any purpose" ([EndNote blog](https://endnote.com/blog/introducing-endnote-research-assistant-ai-powered-document-chat-and-translation/)) [R].

### ReadCube Papers

- Digital Science launched Papers Pro with an AI Assistant in September 2024 and a ReadCube AI Assistant with literature monitoring aimed at pharma ([Digital Science](https://www.digital-science.com/press-releases/papers-pro-scholarly-research-ai-powered-features/)) [R]. A G2 reviewer notes the assistant shows where in the document it found each answer ([G2](https://g2.com/products/readcube/reviews?page=4)) [R]. I found no 2026 announcements.
- ReadCube's "enhanced PDF" with clickable inline references has been its signature for years [K].

### Bookends (Mac)

- Bookends 15.4.2 (TidBITS, 2026-07-16) introduced an MCP server so that assistants can "fetch information from your libraries" and bring in or modify citations, organize groups and folders, and fetch and annotate PDFs ([TidBITS](https://talk.tidbits.com/t/bookends-15-4-2/33820)) [V]. Version 15.2.2 used Apple Intelligence's on-device model as a fallback for metadata extraction when no identifier was found ([TidBITS](https://talk.tidbits.com/t/bookends-15-2-2/32330)) [R]. Bookends 16 added a browser extension that scans web pages for references and a federated ISBN search across Library of Congress, K10plus and Google Books [R].
- The features page describes floating citations that "work in any application" and a "note stream" where PDF selections become annotations, notes and deep links ([Sonny Software](https://www.sonnysoftware.com/bookends-for-mac/features)) [V].
- Inference [I]: Bookends is the closest commercial analogue to citegeist on macOS. A small Mac app already treats MCP as a first-class interface and uses an on-device model for metadata extraction.

---

## 3. Reading and note tools: highlight-to-note flows

### Obsidian with Zotero Integration, Zotlit, PDF++, Citations and Discourse Graphs

- **Zotero Integration** (mgmeyers, now under obsidian-community) imports annotations through templates. Users map highlight colours to callouts and headings and emit `zotero://open-pdf` links with page and annotation id, so each quote jumps back to its spot ([Obsidian forum templates thread](https://forum.obsidian.md/t/zotero-integration-import-templates/36310)) [R]. On 2026-02-19 a user wrote that "the integration hasn't been updated in over two years, despite over 200 open issues" ([Obsidian forum](https://forum.obsidian.md/t/zotero-plugin/111390)) [V]. Its last release dates to August 2024 ([note](https://notes.dsebastien.net/30+Areas/33+Permanent+notes/33.02+Content/Zotero+Integration+plugin+for+Obsidian)) [R].
- **Zotlit** reads the Zotero database directly, uses Eta templates for literature notes and single annotations, and offers a live annotation sidebar ([Obsidian forum](https://forum.obsidian.md/t/zotlit-previously-obsidian-zotero-import-templates/56901)) [R].
- **PDF++** turns backlinks to a PDF selection into highlights: the Markdown link is the source of truth and the highlight is rendered from it. Hovering a highlight highlights the backlink and the reverse, and double-clicking a highlight opens the note ([plugin page](https://community.obsidian.md/plugins/pdf-plus)) [R]. It has about 544k downloads, a v1.0.0 refactor is in progress, and it depends on private Obsidian APIs, which users worry about [R].
- **Citations** (hans) reads a static `.bib` or CSL-JSON export and creates one literature note per citekey ([plugin page](https://community.obsidian.md/plugins/obsidian-citation-plugin)) [R]. Its weakness is staleness: it is "only as current as your last export" [R].
- **Discourse Graphs** came out of beta in July 2026 (forum post 2026-07-24) and ships Question, Claim, Evidence and Source node types with configurable relations; it depends on Datacore ([Obsidian forum](https://forum.obsidian.md/t/discourse-graphs-plugin-for-knowledge-management/116432), [plugin](https://community.obsidian.md/plugins/discourse-graphs)) [V/R].

### Logseq

- The database version entered public beta as 2.0.1 on 2026-07-13: notes move from Markdown files to a canonical local SQLite database, a read-only "Markdown Mirror" projects the graph to disk, and a growing CLI supports queries ([Logseq changelog](https://discuss.logseq.com/t/logseq-db-changelog/30013/37), [news](https://kompozy.io/news/logseq-2-0-db-version-beta)) [R].
- In file-based Logseq each PDF highlight becomes a block with a UUID on an `hls__` page, so a highlight can be referenced or embedded anywhere by block reference [K].

### Heptabase

- Highlights in a PDF become cards that stay linked to their passage and can be arranged on whiteboards ([review](https://aiindigo.com/blog/heptabase-review-2026-the-visual-knowledge-base-for-deep-thinkers)) [R].
- The official roadmap lists Heptabase MCP (2025-12-11), a Zotero integration (2026-02-23), an AI agent that edits cards (2026-05-20), support for OpenRouter and open-source models (2026-07-24), MCP read, search and create access to cards, PDF pages and whiteboards (2026-08-24), a Claude plugin (2026-10-09), MCP download of original PDFs (2026-10-16) and a CLI ([roadmap](https://wiki.heptabase.com/roadmap)) [V].
- Inference [I]: Heptabase's agent edits the same cards, journals and whiteboards that the human uses, so its work lands in the knowledge base itself.

### MarginNote 4

- One excerpt is simultaneously a document highlight, a mind-map node and a flashcard. AI features since 4.2 (book breakdown, Q&A, flashcard generation) save every suggestion "as your own thinking node" ([App Store](https://apps.apple.com/us/app/marginnote-4-ai-notes-mindmap/id1531657269)) [R].

### LiquidText

- The user drags a selection into a workspace to create an excerpt; an arrow on the excerpt reopens the exact source location, ink links connect excerpts, notes and regions across documents, and a project can hold several workspaces ([Digital Orientalist, 2022](https://digitalorientalist.com/2022/03/18/streamlining-your-academic-digital-workflow-1-reading-and-annotating-with-liquidtext/)) [R]. I found no AI features.

### Highlights.app

- Highlights exports annotations to Markdown, HTML or PDF and sends them to Obsidian, DEVONthink, Bear and others; with Pro it can keep a sidecar Markdown file next to each PDF ([FileHorse](https://mac.filehorse.com/es/download-highlights-pdf-reader/), [MPU forum](https://talk.macpowerusers.com/t/pdf-annotation-workflow-using-highlights-app-and-hazel/34333)) [R]. A 2021 user called it "entirely and frustratingly unscriptable" ([MPU forum](https://talk.macpowerusers.com/t/batch-process-annotations-from-pdfs-out-to-obsidian/24470)) [R].

### Readwise Reader (Ghostreader)

- Reader Public Beta Update #14 (2026-08-06) introduced Global Ghostreader, which chats with the whole library, cites the referenced passages and can tag, move and edit documents; Mobile Chat "links directly to the cited text"; and an MCP and CLI that let agents search the library and highlights and create highlights ([Readwise](https://readwise.io/reader/update-aug2026)) [V].
- Readwise's core product resurfaces highlights through daily review and spaced repetition ([readwise.io](https://readwise.io)) [R]. Ghostreader's per-selection prompts (define, simplify, custom prompts) predate 2026 [K].

### Skim

- Skim stores notes in the file's extended attributes rather than inside the PDF, and these attributes get lost through common archiving and email paths; the manual offers embedding on export or a `.skim` sidecar file ([Skim manual](https://skim-app.sourceforge.io/manual/SkimHelp_45.html), [Zotero forum](https://forums.zotero.org/discussion/comment/413026)) [R]. Anchored notes do not survive embedding for other viewers [R].

### The highlight-to-note patterns behind these tools

| Pattern | Examples | Strength | Weakness |
|---|---|---|---|
| Templated import on demand | Zotero Integration, Citations, Zotero "Add note from annotations" | Fits any Markdown tool | Re-import overwrites or duplicates; links get lost |
| Highlight rendered from a backlink | PDF++ | The note is the source of truth; true bidirectional navigation | Coupled to one app's private APIs |
| Highlight as addressable block | Logseq | Reuse a highlight anywhere by reference | Requires the outliner model |
| Highlight as spatial object | Heptabase, LiquidText, MarginNote | Synthesis by arrangement | Proprietary formats; weak export |
| Sidecar file next to the PDF | Highlights.app, Skim `.skim`, KOReader `.sdr` | Survives the app | One-way, little structure |

Recommendation [I]: citegeist should use the "addressable object" pattern internally (every highlight is an Excerpt with a stable id), render highlights from those objects as PDF++ does, and write a sidecar export as a durability guarantee.

---

## 4. AI research tools

### Commercial and hosted tools

| Tool | Core capability (2026) | Transferable to a local-first personal library [I] |
|---|---|---|
| Elicit | Paper search (up to 1,000 papers), research reports modeled on systematic reviews, screening and extraction tables, Library "for researchers and AI agents", Routines, API and MCP since 2026-07-15 ([elicit.com](https://elicit.com/)) [V] | The extraction matrix over a project's sources, with every cell tied to an anchored quote |
| Consensus | Search over about 220M papers with a "Consensus Meter" showing agree/disagree/mixed on yes/no questions; Deep Search ([guide](https://pasqualepillitteri.it/en/news/1291/consensus-ai-search-engine-220-million-scientific-papers-guide-2026)) [R] | Little; yes/no tallies flatten social-science debates |
| SciSpace | Literature Review, Deep Review, chat with PDF, extraction, agent with templates, credit-metered tasks that pause when credits run out ([review](https://www.educatorstechnology.com/2026/09/scispace-review.html)) [R] | Agent task templates ("skills") a user can reuse |
| scite | Smart Citations classify citing statements as supporting, contrasting or mentioning, with links to the citing passage; MCP server (Feb 2026) and a Claude connector (2026-04-29); index of 250M+ articles ([press release](https://researchsolutions.investorroom.com/2026-04-29-Research-Solutions-Scite-Launches-Claude-Connector-For-Citation-Backed-Research)) [V] | "How do later papers cite this source" as context on every source; optional scite lookup via its MCP |
| Semantic Scholar, Semantic Reader, Asta | TLDRs; Semantic Reader shows citation cards and AI skimming highlights; Asta (2025-08-26) bundles agents, AstaBench and an MCP corpus tool over the S2 index ([Ai2 Asta](https://allenai.org/blog/asta)) [R] | Inline citation cards in the reader; facet highlights (goal, method, result) as dismissable suggestions |
| alphaXiv | Comments on arXiv papers, AI chat, blog-style overviews; $7M seed (Nov 2025); moving toward a research workbench ([SiliconANGLE](https://siliconangle.com/2025/11/19/alphaxiv-raises-7m-funding-become-github-ai-research/)) [R] | A "discussion" layer per paper for agent and human comments |
| ResearchRabbit | 2025 relaunch (2025-10-20) with configurable citation graph axes and embedding search; acquired by or partnered with Litmaps ([release](https://www.researchrabbit.ai/releases/welcome-to-the-new-researchrabbit), [Aaron Tay](https://aarontay.substack.com/p/researchrabbits-2025-revamp-iterative)) [R] | Iterative chaining from a seed set |
| Connected Papers | Similarity graph from co-citation and bibliographic coupling over about 50,000 candidates; proximity means shared citation patterns, not agreement ([about](https://www.connectedpapers.com/about), [CASRAI](https://casrai.org/guides/connected-papers)) [R] | Compute co-citation and coupling locally over the library plus open citation data |
| Litmaps | Seed maps, discovery, visual maps, monitoring for new papers ([litmaps.com](https://www.litmaps.com/)) [V] | Saved searches that alert on new papers related to a project |
| Inciteful | Paper Discovery plus Literature Connector (citation paths between two papers) on OpenAlex, S2, Crossref, OpenCitations ([ISTL 2026](https://journals.library.ualberta.ca/istl/index.php/istl/article/view/2974)) [R] | Literature Connector for interdisciplinary bridging between two fields |
| Undermind | Iterative agent search with LLM relevance classification and a convergence check; its whitepaper claims that a typical search retrieves more than 85% of its final results within the first 150 papers explored ([whitepaper](https://www.undermind.ai:443/whitepaper.pdf), [Aaron Tay](https://aarontay.substack.com/p/undermindai-different-type-of-ai-agent?open=false)) [R] | Report an estimate of search completeness with every literature search |
| NotebookLM | Chat grounded in uploaded sources; citations jump to the quoted passage; Deep Research, mind maps, audio and video overviews ([Google help](https://support.google.com/notebooklm/answer/14276569?hl=en)) [R] | Source-grounded answers whose citations open the exact passage |
| Google Scholar Labs | Launched 2025-11-18; decomposes a question into aspects, runs several searches and explains per paper how it answers; ignores citation counts ([Google blog](https://blog.google/outreach-initiatives/education/google-scholar-labs/), [Aaron Tay](https://aarontay.substack.com/p/scholar-labs-early-review-google)) [R] | Query decomposition with a one-line "why this paper" for each hit |
| Anara (ex-Unriddle) | Chat across files with source highlighting per claim; rebranded March 2025 ([CASRAI](https://www.casrai.org/guides/anara-ai)) [R] | Every generated sentence links to its passage |
| Paperguide | Search, chat with PDF, reference manager, AI writer; reviewers flag missing bibliography export ([unite.ai](https://www.unite.ai/paperguide-review/)) [R] | Little |
| Kortex | Two products share the name: a NotebookLM companion extension and a notes-and-writing app ([AppSumo](https://appsumo.com/products/kortex/), [review](https://aiindigo.com/blog/kortex-review-2026-a-unified-workspace-for-the-modern-knowledge-worker)) [R] | Little; I could not pin down which product the brief meant |
| Recall | Saves and summarizes articles, videos and PDFs, links related items into a knowledge graph, quizzes with spaced repetition, model choice; Recall 2.0 on 2026-04-14 ([about](https://www.recall.it/about), [Product Hunt](https://www.producthunt.com/products/recall-6/launches/recall-2-0)) [R] | Automatic "related" suggestions plus resurfacing |
| FutureHouse platform | Agents Crow (literature QA), Falcon (deep review), Owl ("has anyone done this"), Phoenix (chemistry) via web and API ([unite.ai](https://www.unite.ai/?p=216853)) [R] | An "Owl" check: has this question been studied already |

Evidence on reliability:

- A 2026 feasibility study in *Research Synthesis Methods* (Lagisz et al., doi:10.1017/rsm.2026.10080) found that Elicit can support extraction in systematic reviews "with human oversight". The preprint reports that re-running extractions from different accounts gave 90% agreement on values, but supporting quotes matched in only 46% of cases and reasoning in 30% ([Cambridge](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/C97DAEC70C3173A260F0B12E729E7250), [EcoEvoRxiv preprint](https://ecoevorxiv.org/repository/view/9909/)) [R, figures from search summaries of the paper and preprint].
- Reviewers report SciSpace's literature review breaking a user's inclusion and exclusion criteria ([Capterra](https://www.capterra.ae/software/178127/Scispace)) [R].

### Open-source tools

| Tool | Core capability | Transferable to citegeist [I] |
|---|---|---|
| PaperQA2 (FutureHouse) | Agentic RAG: an LLM writes keyword searches, chunks are embedded, then "re-ranking and contextual summarization" scores evidence before answering; answers cite passages with page ranges (e.g. "Qian2011Neural pages 1-2"); any LiteLLM model including local ones; Docling or nemotron-parse PDF readers; metadata from Semantic Scholar, Crossref, Unpaywall, OpenAlex including retraction checks; Apache-2.0, about 9.5k stars; calendar versioning since Dec 2025 ([GitHub](https://github.com/Future-House/paper-qa)) [V] | The evidence-gathering loop is reusable as a library or as a pattern; its contextual summaries per chunk are a natural "Excerpt plus paraphrase" |
| OpenScholar (Ai2/UW) | Retrieval over 45M open-access papers with a trained 8B model; published in *Nature* (2026, doi:10.1038/s41586-025-10072-4); experts preferred its answers over human-written ones 51% of the time; GPT-4o "fabricated 78-90% of its research citations" in the same study; model, index and data are public ([Ai2](https://allenai.org/blog/openscholar-nature), [UW News](https://www.washington.edu/news/2026/02/04/in-a-study-ai-model-openscholar-synthesizes-scientific-research-and-cites-sources-as-accurately-as-human-experts/)) [V] | An 8B model can run on a Mac; retrieval quality and citation handling matter more than model size |
| STORM and Co-STORM (Stanford OVAL) | Outline-first, multi-perspective research writing; Co-STORM adds a human in the loop with a shared mind map; 30.8k stars; Fall 2026 course material calls them the basis of current deep-research agents ([CS224V 2026](https://web.stanford.edu/class/cs224v/lectures_2026/I-DeepResearch.pdf), [GitHub](https://github.com/stanford-oval/storm)) [R] | Generating a related-work outline from the user's own library, with the user steering |
| GPT Researcher | Deep research over web plus a local document folder; MCP retriever; also packaged as a Claude skill ([mcp.so](https://mcp.so/servers/gpt-researcher)) [R] | Mixed local plus web research in one report |
| Open Notebook | MIT, self-hosted NotebookLM alternative with many providers including Ollama and LM Studio, podcasts, REST API; reviewers say setup is not plug-and-play ([GitHub](https://github.com/lfnovo/open-notebook), [Android Authority](https://www.androidauthority.com/notebooklm-alternative-open-notebook-hands-on-3677932/)) [R] | Proof that NotebookLM features run on local models |
| Khoj | Self-hostable "AI second brain" with any online or local LLM, agents, automations, deep research and an Obsidian plugin ([GitHub](https://github.com/ai-khoj/khoj)) [R] | Scheduled research automations ("every Monday, new papers on X") |
| ORKG | Papers described as research contributions in RDF triples; expert-written templates per research problem; comparisons tabulate contributions with similar properties; ORKG Ask (launched 2024-05-16) answers questions with RAG over about 76-80M CORE-based publications ([arXiv 2308.12981](https://arxiv.org/pdf/2308.12981), [L3S](https://www.l3s.de/new-orkg-ask-service-launched/)) [R] | The contribution model as columns of the extraction matrix (problem, method, data, result) |

Inference [I]: the hosted tools compete on corpus size, which citegeist cannot match. A personal library wins on what the hosted tools cannot see: the user's own excerpts, notes, typed links and project questions. citegeist should call out to corpus tools (OpenAlex, Semantic Scholar, scite, Elicit MCP) for discovery and keep synthesis local.

---

## 5. Zotero AI plugins and Zotero MCP servers

| Name | What it does | Why people use it | Caveat |
|---|---|---|---|
| zotero-mcp (54yyyu) | MCP server: search by title, tag, full text or meaning (local, OpenAI, Gemini or Ollama embeddings); read metadata, BibTeX, full text and page ranges with page images for math and tables; create highlights and notes; add items by DOI, URL, ISBN or file; merge duplicates; optional scite tallies and retraction alerts; a chat panel inside Zotero; 5.5k stars, MIT ([GitHub](https://github.com/54yyyu/zotero-mcp)) [V] | Gives Claude Desktop, Claude Code or Cursor full access to an existing library | Reads `zotero.sqlite` directly; writes need Zotero 10+ or the web API |
| zotero-gpt (MuiseDestiny) | Plugin with GPT "command tags" for summaries and PDF Q&A; 7.5k stars; states compatibility with Zotero 6 and 7 ([GitHub](https://github.com/MuiseDestiny/zotero-gpt)) [V] | Early, popular, one-click prompts | No stated Zotero 8 support; 242 open issues |
| llm-for-zotero, Beaver, PapersGPT, ARIA, ZotAI | Side-panel chat with the open PDF or the whole library; Beaver adds agentic search and metadata cleanup ([CASRAI comparison](https://casrai.org/compare/best-zotero-ai-plugins), [Zotero forum](https://forums.zotero.org/discussion/comment/509159)) [R] | Chat while reading without leaving Zotero | Most need API keys; llm-for-zotero sends a paper's full text by default [R] |
| zotero-native-mcp, zotero-api-mcp, Zotero MCP Lite, kujenga/zotero-mcp | Smaller MCP servers; native-mcp writes through the Zotero 10 local API offline; api-mcp needs a web API key for writes ([Glama](https://glama.ai/mcp/servers/integrations/zotero)) [R] | Simpler setups | Young projects with few stars |
| cli-anything-zotero, zotero-agent | CLI servers with dozens of commands for agents; zotero-agent bundles a bridge plugin ([topic](https://github.com/topics/reference-manager?o=desc&s=stars)) [V] | Agents prefer CLIs and MCP to GUIs | Hobby-scale |

What people actually use and why [I, based on star counts and forum threads]:

- The MCP route won. Users with a Claude or ChatGPT subscription connect it to the library they already have instead of paying for an AI reference manager. On the Zotero forum users asked for an official agent API (2026-02-22) and for PaperQA2 integration (2026-03-19), and the answer was that the web and local APIs already exist ([thread](https://forums.zotero.org/discussion/129924/zotero-in-the-era-of-ai-agent-openclaw), [thread](https://forums.zotero.org/discussion/comment/509533/)) [V].
- The recurring gaps are write access (solved only in Zotero 10 beta), semantic search over full text, and page-accurate annotation access. zotero-mcp's feature list grew exactly along those lines [V].
- Plugin chat is popular for reading, and most plugins keep the answers in a chat panel. Turning an answer into a linked note or excerpt is left to the user [I].

---

## 6. Zettelkasten practice and typed links

### 6.1 Luhmann's original method

From Johannes F.K. Schmidt, "Niklas Luhmann's Card Index: The Fabrication of Serendipity", *Sociologica* 12(1), 2018 ([PDF](https://sociologica.unibo.it/article/download/8350/8272)) [V], and Luhmann's "Communicating with Slip Boxes" (1981, English translation by Manfred Kuehn, [luhmann.surge.sh](http://luhmann.surge.sh/communicating-with-slip-boxes)) [V]:

- **Scale.** About 90,000 handwritten A6 cards in two collections. Collection I (about 1951-1962) has about 23,000 cards in 108 numbered sections, two bibliographies with about 2,000 titles and a keyword index of about 1,250 entries. Collection II (1963-1997) has about 67,000 cards in eleven top-level sections with about 100 subsections, a bibliographical apparatus of about 15,000 references and a keyword index of 3,200 entries.
- **Reading notes were raw material.** Luhmann wrote that when reading he always asked "how the books can be integrated into the filing system". He did not file his reading notes directly; in the evening he transferred the often rudimentary records of the day into new cards.
- **Placement by local fit.** A new card only had to connect to the card it followed. There is "no top and no bottom", and a topic could be filed in several places ("multiple storage").
- **Fixed numbers and branching.** Each card received a number and "a fixed position in the file that does not change over time": 1/1 is followed by 1/2; a later card that pursues an aspect of 1/1 becomes 1/1a, then 1/1a1, and so on. Numbers grew up to 13 digits and letters (21/3a1p5c4fB1a). Luhmann's own text says a new note can attach anywhere, even to a single word in the middle of a running text. Schmidt adds that "the number on its own does not really inform about the relations between different notes".
- **Links.** Schmidt estimates about 20,000 references in collection I and 30,000 in collection II. He distinguishes outline references (capital letters pointing to cards that develop an outline), collective references (hub cards listing up to 25 related cards, usually far away) and single references at a particular place in a note. Luhmann added references to old cards as new cards arrived, and he recommended recording back links. Poorly linked regions behaved like "black holes": they tended to stay isolated, and some seem untouched since he wrote them.
- **Keyword index as entry point.** The register listed only one to four places per term, because the links would lead to everything else. Collection II contains four versions of the index, because Luhmann started a fresh one whenever the alphabetical order became too messy.
- **Bibliography.** Works actually read went onto separate bibliographic slips in a separate box, which also let him distinguish what he had read from what he had only noted for later.
- **Revisions.** Original cards stayed in the file; corrections arrived as new cards, so the file records the evolution of his thinking including dead ends.
- **Communication partner.** Luhmann describes the box as "a kind of secondary memory", "an alter ego with who we can constantly communicate", and says the partners must be able to surprise each other, which requires "internal possibilities for linkings which result in the unexpected".

### 6.2 How modern tools translate it

- **IDs.** Digital tools use timestamp IDs (Zettlr, The Archive) or plain wikilinks to titles [K]. The "Folgezettel debate" on the Zettelkasten forum argues over whether a note's position in a branching sequence still matters once links and backlinks exist ([forum](https://forum.zettelkasten.de/discussion/2350/folgezettel-is-not-an-outline-luhmanns-playful-appreciation-of-dys-function)) [R].
- **Links and backlinks.** Obsidian, Logseq and Zettlr compute backlinks automatically, which removes Luhmann's manual back-linking and reduces "black holes" [K]. All of them leave links untyped. One Obsidian user gave up on an IBIS system because "it would require support for link types from Obsidian" ([forum](https://forum.obsidian.md/t/tips-for-making-an-issue-based-information-system/31353)) [R].
- **Hubs.** Structure notes or "maps of content" [K] play the role of Luhmann's collective-reference cards ([zettelkasten.de on hubs](https://zettelkasten.de/posts/zettelkasten-hubs/)) [R].
- **Register.** Tags usually replace the register, but tags tend to be exhaustive labels, while Luhmann's register held a few deliberate entry points [I].
- **Literature notes versus permanent notes.** The Zettelkasten community names the failure mode of collecting without processing the "collector's fallacy" ([zettelkasten.de](https://zettelkasten.de/posts/collectors-fallacy/)) [R].

Inference [I]: three Luhmann properties survive translation badly and matter for citegeist. Stable addresses get lost when notes are identified by renameable titles. Entry points get lost when tags become exhaustive labels. The evening rewrite gets lost when a highlight import produces a "note" that is only a pile of quotes. An AI makes the third problem worse if it writes the permanent note for the user.

### 6.3 Models for typed links

**Discourse graphs (Joel Chan and collaborators).** The Roam extension's base grammar lists the node types QUE (Question), CLM (Claim), EVD (Evidence) and Source, and the relations "EVD Informs QUE", "EVD Supports CLM" and "EVD Opposes CLM" ([OASIS Lab GitBook](https://oasis-lab.gitbook.io/roamresearch-discourse-graph-extension/fundamentals/what-is-a-discourse-graph/the-base-grammar-questions-claims-and-evidence)) [V]. The model treats "discourse moves" rather than papers as the main units ([GitBook](https://oasis-lab.gitbook.io/roamresearch-discourse-graph-extension/fundamentals/what-is-a-discourse-graph)) [V]. The Obsidian plugin's docs give examples such as Claim supports Question, Evidence supports Claim, Evidence contradicts Claim and Source informs Question, with each relation carrying a primary and a complement label ([docs](https://discoursegraphs.com/docs/obsidian/relationship-types)) [V]. Chan et al. (2024) report three years of research through design with hypertext-notebook users and argue that the bottleneck is the lack of local systems that integrate discourse-centric models ([arXiv 2407.20666](https://arxiv.org/abs/2407.20666v1)) [V]. The project site lists a Roam plugin, an Obsidian plugin and a tool-agnostic protocol in development ([discoursegraphs.com](https://discoursegraphs.com/)) [V].

**Argument mapping.** IBIS (Rittel, 1970) uses issues, positions and arguments; positions respond to issues ([IdeaScale](https://ideascale.com/blog/conversation-mapping/)) [R]. Toulmin's model adds warrant, backing, qualifier and rebuttal to claim and data [K]. Kialo builds pro and con trees under a thesis, and Argdown writes argument maps as text [R]. A Zettelkasten forum thread compares Chan's model with IBIS and Toulmin and notes that "the application of the note-as-claim model lives on a spectrum": coding notes, people notes or structure notes do not fit it ([forum](https://forum.zettelkasten.de/discussion/comment/17420/)) [V].

**CiTO, the Citation Typing Ontology.** I downloaded the ontology from purl.org: version 2.9.0, modified 2026-09-03, with more than 40 citation properties plus inverses ([CiTO](http://purl.org/spar/cito)) [V]. Definitions relevant to citegeist [V]:

- `supports`: the citing entity "provides intellectual or factual support for statements, ideas or conclusions presented in the cited entity".
- `disagreesWith`, `disputes`, `critiques`, `refutes`: separate negative relations; CiTO defines each one and does not rank them.
- `qualifies`: the citing entity "qualifies or places conditions or restrictions upon statements, ideas or conclusions presented in the cited entity".
- `extends`: "extends facts, ideas or understandings presented in the cited entity".
- `usesMethodIn`, `usesDataFrom`, `usesConclusionsFrom`: reuse of method, data or conclusions.
- `citesAsEvidence`, `citesAsAuthority`, `obtainsBackgroundFrom`, `discusses`, `citesAsRelated`, `includesQuotationFrom`.

**scite** collapses citation typing to three labels: supporting, contrasting and mentioning ([press release](https://researchsolutions.investorroom.com/2026-04-29-Research-Solutions-Scite-Launches-Claude-Connector-For-Citation-Backed-Research)) [V]. Inference [I]: ordinary users can apply this vocabulary consistently. Most citation statements in scite's data are classified as mentioning [K].

**ORKG contribution model.** A paper has one or more research contributions expressed as triples; templates written by domain experts fix the properties for a research problem; comparisons align contributions with similar properties into a table ([arXiv 2308.12981](https://arxiv.org/pdf/2308.12981)) [R]. Papers about ORKG concede that manual annotation "cannot effectively scale" and that users struggle to find the right existing property among many similarly named ones [R].

### 6.4 Recommended relation vocabulary for citegeist

Design rules [I]:

- Links may stay untyped. A type is an optional upgrade, proposed by the agent or the user and accepted by the user.
- Every typed link carries a one-sentence reason, an actor (human or agent plus model), a status (proposed, accepted, rejected) and, where possible, the Excerpt that justifies it.
- Each relation has an inverse label so that both endpoints read naturally.
- The vocabulary is small enough to memorize, and each term maps to CiTO and to discourse graphs for export.

Node kinds the relations operate on: **Source** (a work), **Excerpt** (an anchored passage with locator and optional paraphrase), **Note** with a role (Claim, Question, Concept or free), and **Project** items (research question, outline section).

| Relation | Inverse label | Typical endpoints | Meaning | CiTO export | Discourse graph |
|---|---|---|---|---|---|
| `supports` | supported by | Excerpt or Note to Claim; Source to Source | Gives evidence or reasons for | `cito:supports` / `citesAsEvidence` | Supports |
| `opposes` | opposed by | Excerpt or Note to Claim; Source to Source | Gives evidence or reasons against | `cito:disputes` (or `refutes` when flagged strong) | Opposes |
| `qualifies` | qualified by | Excerpt or Note to Claim | Limits the scope or adds conditions | `cito:qualifies` | (extension) |
| `addresses` | addressed by | Claim, Excerpt or Source to Question | Bears on a research question | `cito:discusses` | Informs |
| `extends` | extended by | Source or Note to Source or Note | Builds on and develops further | `cito:extends` | (extension) |
| `uses-method-of` | method used by | Source or Note to Source | Applies a method described there | `cito:usesMethodIn` | (extension) |
| `uses-data-from` | data used by | Source or Note to Source | Uses data, a corpus or a benchmark from there | `cito:usesDataFrom` | (extension) |
| `elaborates` | elaborated by | Note to Note | Continues or branches a line of thought (Luhmann's sequence) | `cito:citesAsRelated` | (none) |
| `related` | related | anything to anything | Connected, type not decided yet | `cito:citesAsRelated` | (none) |

System relations that citegeist maintains automatically and the user never picks:

| Relation | Meaning | Export |
|---|---|---|
| `excerpt-of` | Excerpt belongs to a Source at a locator (page label, PDF page index, selectors) | W3C Web Annotation target |
| `derived-from` | Note was written from these Excerpts | `cito:includesQuotationFrom` when it quotes |
| `cites` | Bibliographic citation between Sources from OpenAlex, OpenCitations or Crossref | `cito:cites` |

Why this set [I]: `supports`, `opposes` and `addresses` give the discourse-graph core that structures a proposal around its questions. `qualifies` earns its place because social-science findings are usually contested through scope conditions rather than refuted. `uses-method-of` and `uses-data-from` carry most of the value for technical AI papers, where lineage runs through methods and benchmarks. `elaborates` preserves Luhmann's sequences without forcing his numbering. `related` keeps the threshold for linking low, which protects against Luhmann's "black holes". A user who wants more can add custom relations, but the agent should only propose from this list so that its proposals stay comparable across the library.

---

## 7. Common complaints from academics

Reddit was not reachable; these come from other forums, blogs and studies.

### Notes inside Zotero

- "As the collections and subcollections get into the hundreds and beyond, it's difficult to find things that might only be findable with the collection labels included in the search." ([Zotero forum](https://forums.zotero.org/discussion/comment/357634/)) [R]
- After Zotero 7, notes embedded in attachments became read-only and had to be converted to child or standalone notes ([Zotero forum](https://forums.zotero.org/discussion/116897/can-no-longer-edit-the-note-section-within-the-item-pane)) [R].
- The zoResearch tool exists because Zotero "when it comes to note-taking, it's lacking" ([GitHub](https://github.com/dlw-github/zoresearch)) [R].

### Annotation export into Obsidian

- "Since the import deletes/overrides the note, this is not feasible." And: "A drag and drop of the zotero annotation into obsidian creates a text with the structure (author, page x)", where "there is no link to the annotation." (Hunzen, 2023-11-04, [Zotero forum](https://forums.zotero.org/discussion/comment/447809/)) [V]
- Re-running "Add note from annotations" creates a new note each time instead of updating the old one ([Zotero forum](https://forums.zotero.org/discussion/comment/415253/)) [R].
- "I have pretty much scourged every forum I know of, including Reddit, and have only ended up more confused." (baratharjun, 2023-05-18, [Obsidian forum](https://forum.obsidian.md/t/help-with-my-zotero-obsidian-workflow/59959)) [V]
- "the integration hasn't been updated in over two years, despite over 200 open issues." (koberulz, 2026-02-19, [Obsidian forum](https://forum.obsidian.md/t/zotero-plugin/111390)) [V]
- "the filename on export is no longer using the Better BibTeX citation key in Obsidian" after Zotero 8; another user noticed that "the Quick Copy export (drag and drop) from Zotero no longer includes the citekey" (2026-02-20 and 2026-02-27, [Zotero forum](https://forums.zotero.org/discussion/comment/508298)) [V]

### Citation insertion and citation keys

- Zotero 8's key migration broke autocomplete and lost keys for some Zettlr users; Zettlr warned that same-author, same-year keys can swap suffixes (`Erz2025` and `Erz2025a`) and that users should "double-check each citation key before submitting papers or theses" (2026-03-07, [Zettlr](https://zettlr.com/post/on-the-recent-issues-with-zotero-8-and-better-bibtex)) [V].
- Large documents slow the Word plugin down. A Zotero team member wrote: "It should be fine on Windows until you hit about 500 citations in a document." (2019-02-12, [Zotero forum](https://forums.zotero.org/discussion/75917/very-slow-response-of-zotero-word-plugin)) [V]. A thesis writer with a 75,000-word document and about 490 footnotes reported the same problem in 2020 ([Zotero forum](https://forums.zotero.org/discussion/comment/346826/)) [V].

### PDF-to-notes friction and page numbers

- Notes from annotations got page numbers wrong: "Often just one page out, but sometimes it clearly does not know the page numbers and just starts at 1." The fix is to edit the page number in the sidebar and apply it to later pages (2022-08-29, [Zotero forum](https://forums.zotero.org/discussion/comment/415965)) [V].
- The collector's fallacy describes the deeper problem: collected highlights feel like knowledge and are not, until they are processed into one's own notes ([zettelkasten.de](https://zettelkasten.de/posts/collectors-fallacy/)) [R].

### AI tools that hallucinate citations, quotes or locators

- GPTZero scanned 4,841 of 5,290 NeurIPS 2025 papers and reported 100 hallucinated citations in 51 accepted papers, including placeholder authors "John Doe and Jane Smith" and DOIs that resolve nowhere ([GPTZero](https://gptzero.me/news/neurips/), [The Decoder](https://the-decoder.com/over-100-fake-citations-slip-through-peer-review-at-top-ai-conference/)) [R]. NeurIPS responded that about 1.1% of papers with incorrect references do not necessarily invalidate the content, because authors "may have given an LLM a partial description of a citation and asked the LLM to produce bibtex" ([Fortune, 2026-01-21](https://www.fortune.com/2026/01/21/neurips-ai-conferences-research-papers-hallucinations)) [R]. A follow-up analysis of the same 100 citations counts 53 affected papers ([arXiv 2602.05930](https://arxiv.org/html/2602.05930v1)) [R].
- In the OpenScholar study GPT-4o "fabricated 78-90% of its research citations" ([UW News](https://www.washington.edu/news/2026/02/04/in-a-study-ai-model-openscholar-synthesizes-scientific-research-and-cites-sources-as-accurately-as-human-experts/)) [V].
- Paperpile: "using AI to generate a bibliography is not worth the risk" ([Paperpile](https://paperpile.com/blog/citation-checker-hallucinations/)) [V].
- Elicit's supporting quotes matched across re-runs in only 46% of cases ([preprint](https://ecoevorxiv.org/repository/view/9909/)) [R].
- A research guide warns that NotebookLM's passage links are "not a substitute for a citation you can put in a manuscript" ([CASRAI](https://www.casrai.org/guides/notebooklm-for-research-workflows)) [R]. I found no documented case of NotebookLM inventing page numbers.

### Lock-in and fragile storage

- Mendeley's 2018 database encryption made local libraries unreadable for other tools ([Zotero KB](https://www.zotero.org/support/kb/mendeley_import)) [R].
- Skim's notes live in extended attributes that common archive and email paths drop ([Skim manual](https://skim-app.sourceforge.io/manual/SkimHelp_37.html)) [R].
- PDF++ relies on "many private APIs of Obsidian", and users fear losing their highlights if it breaks ([plugin listing](https://www.obsidianstats.com/plugins/pdf-plus)) [R].
- Static exports go stale: the Citations plugin is "only as current as your last export" [R].

### AI forced on users

- Calibre's "Discuss with AI" drew users who called it "morally repugnant" and refused to update; the maintainer would only accept a tweak that hides the menu entries ([LWN](https://lwn.net/Articles/1049886)) [V]. Zotero forum users ask for a version free of generative AI ([Zotero forum](https://forums.zotero.org/discussion/comment/514896/)) [R].

---

## 8. Idea bank for citegeist

Ranked by value for a PhD-proposal workflow plus a library-wide second brain [I].

| Rank | Idea | Inspired by | Rationale |
|---|---|---|---|
| 1 | Excerpt as the atomic citable object: verbatim quote from the text layer, locator (printed page label, PDF page index, quote and position selectors, coordinates), optional paraphrase with author and model recorded | Citavi knowledge items, Hypothesis anchoring, EndNote Quote and Cite | Every sentence in the proposal can be traced to a page, and the AI highlighter becomes a writer of Excerpts |
| 2 | Locators come only from the document, never from a model; every AI-produced quote must string-match a stored Excerpt or is flagged | Elicit quote study, OneCite, Paperpile Citation Checker | This removes the hallucinated-page and hallucinated-quote failure class by construction |
| 3 | Per-document page-label mapping (printed page = PDF page plus offset, editable once) | Zotero page-number complaints | Citations need journal page numbers, which often differ from PDF indices |
| 4 | Plain files as the canonical store (Markdown notes with frontmatter, CSL-JSON, one folder per Source) with SQLite and vector indexes as rebuildable caches | Papis, Calibre, Zettlr, Wren | Agents work best on files, and the library stays readable and versionable without citegeist |
| 5 | citegeist owns citation keys, never regenerates them silently, and auto-exports BibTeX and CSL-JSON | Zotero 8 and Better BibTeX breakage | Key churn broke Zettlr and Obsidian pipelines for weeks in 2026 |
| 6 | One API for UI, CLI and MCP, with read and write; every object records whether a human or an agent (and which model) created or changed it | zotero-mcp, Bookends MCP, Heptabase agent, Readwise MCP | Agent and human become equal users of the same objects, and the provenance stays auditable |
| 7 | Bring-your-own-assistant inference: hand Excerpts, notes and tools to Claude Code, Codex or Cursor through MCP instead of embedding an API key | Paperpile Ask AI, scite connector, Heptabase Claude plugin | Users already pay for these subscriptions, and the 2026 market is converging on this pattern |
| 8 | Typed links from the vocabulary in section 6.4, proposed by the agent with a reason and accepted by the user | Discourse graphs, CiTO, scite | A proposal is an argument structure, and typed links make gaps and contradictions queryable |
| 9 | Question-centric project view: research questions as nodes, with supporting, opposing and qualifying material attached and gaps shown | Discourse graphs, IBIS, FutureHouse Owl | A PhD proposal is organized around its questions, and empty questions reveal what to read next |
| 10 | Extraction matrix per project (sources by dimensions such as problem, method, data, finding), every cell backed by an Excerpt | Elicit tables, ORKG comparisons | The literature-review chapter is essentially this matrix written out |
| 11 | Explicit retrieval scope on every agent query: this project, a collection, or the whole library | Mendeley Ask My Library limits, NotebookLM notebooks, Readwise Global Ghostreader | "Through all my readings" must be a deliberate switch, and answers must say which scope they used |
| 12 | Literature notes and permanent notes as separate states, with a processing inbox; the agent drafts, the user rewrites | Luhmann's evening transfer, collector's fallacy | This keeps the second brain in the user's own words and avoids highlight hoarding |
| 13 | PDF and HTML to Markdown conversion with a span map back to page coordinates | Wren extraction, PaperQA2 with Docling | Agents read the Markdown, and the span map lets the user verify any passage on the original page |
| 14 | Highlights rendered from notes and Excerpts (backlink highlights), with hover sync both ways | PDF++ | Navigation between page and note works in both directions |
| 15 | Seed-set discovery using open citation data: co-citation, bibliographic coupling, citation paths between two papers, alerts for new related work | Connected Papers, Inciteful, Litmaps, JabRef citations tab | An interdisciplinary proposal needs bridges between fields, and OpenAlex and OpenCitations are free |
| 16 | Citation context per Source: how later papers cite it, retraction status | scite, PaperQA2 metadata | It warns before the proposal builds on contested or retracted work |
| 17 | Stable note IDs, optional `elaborates` sequences, a small keyword register of entry points, and hub notes | Luhmann | Stable addresses serve both agents and humans, and entry points beat exhaustive tags |
| 18 | Semantic highlight types (colour means role: claim, method, finding, definition), with AI pre-highlighting only as dismissable suggestions | Semantic Reader skimming, Zotero colour templates | Consistent semantics let the agent query "all findings on X" across the library |
| 19 | Inline citation cards in the reader: click a reference inside a PDF, see the work, add it to the library | Semantic Reader, ReadCube | Snowballing happens while reading |
| 20 | Cite-while-writing through Pandoc citekeys plus a Word or Google Docs bridge later; one-click "quote and cite" and "paraphrase and cite" from an Excerpt | Zettlr, EndNote, Bookends floating citations | The proposal will likely end up in Word, and the Markdown path keeps the canonical text plain |
| 21 | Search completeness estimate and per-hit "why this paper" for agent literature searches | Undermind, Google Scholar Labs, Asta Find Papers | The user needs to know how complete a search is before writing a state-of-the-art section |
| 22 | Persistent visible label on AI-written text until a human edits or accepts it | Citavi "AI:" label | It keeps provenance visible in exports and supports disclosure rules at universities |
| 23 | Resurfacing of the user's own Excerpts and notes (daily review, related-item suggestions) | Readwise, Recall, MarginNote | Re-encounter is where a second brain pays off, but it can wait until after the proposal |
| 24 | Canvas view for arranging Excerpts and notes into a chapter outline | Heptabase, LiquidText | Spatial synthesis helps structuring, but it is a later feature |
| 25 | Outline drafting from the user's own library with a human-steered, multi-perspective agent | STORM and Co-STORM | It speeds up related-work drafts, and it only works once ideas 1 to 10 exist |

### Things to avoid

- AI that the user cannot switch off or remove. Calibre showed how fast that alienates users [V].
- Bibliographic metadata, quotes or page numbers produced by a model. Metadata must come from Crossref, OpenAlex, DOIs or the document, and quotes from the text layer [I, backed by section 7].
- Silent regeneration of citation keys or IDs [V, Zotero 8 episode].
- Re-imports that overwrite or duplicate notes. Imports must be idempotent and merge [V, Zotero forum].
- Annotation storage in fragile places: extended attributes, another app's private APIs, encrypted or undocumented databases [V/R].
- Chat answers that vanish in a panel. Anything worth keeping should become an Excerpt, Note or Link with provenance [I].
- Opaque scores presented as findings, such as yes/no consensus meters or undisclosed similarity metrics [R/I].
- Hidden RAG limits (snippet caps, no scope filters) that the user cannot see [R, Mendeley].
- Up-front ontology work. ORKG-style manual property modelling does not scale, so typing must stay optional and lazy [R].
- Credit-metered agent runs that stop halfway. With the user's own subscription citegeist should checkpoint long tasks and resume them [R, SciSpace].
- Workflows that depend on one unmaintained plugin chain (Zotero to Better BibTeX to Obsidian template) [V].

---

## Open questions and unverified items

- Paperlib's latest release date (28 Sep, year not shown) and whether the project is still maintained.
- Mendeley's AI suite launch date (December 2025) and EndNote Research Assistant details come from aggregator or press-release mirrors.
- Google's help center titles the product "Gemini Notebook" on pages I fetched on 2026-10-23; I could not verify whether NotebookLM was officially renamed.
- The exact relation definitions in the discourse-graph base grammar beyond the relation list, and whether the Obsidian plugin stores relations in frontmatter.
- Khoj, Kortex, Readest AI and Hypothesis 2026 status could not be re-checked after the search budget ran out.
- Logseq's `hls__` highlight blocks, Toulmin's elements, ReadCube's enhanced PDF and Ghostreader's custom prompts are marked [K] and were not re-verified.

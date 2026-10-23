# Zotero parity research for citegeist

Research date: 2026-10-23. Baseline versions: Zotero 10.0.6 (2026-10-07), zotero-schema `master` (schema version 45, last commit 2026-08-19), Zotero Connector `main` (pushed 2026-10-22), zotero/translators commit `8fdb26b` (2026-10-19), Better BibTeX 9.0.71 (2026-10-07).

Method: I read Zotero source code and schema files directly (GitHub raw files, GitHub API, a shallow clone of zotero/translators), plus official Zotero docs, blog posts and changelogs. Statements marked **Inference** are my own reasoning. Statements marked **Unverified** I could not confirm (the web search budget ran out late in the session; nothing after that point was searched).

---

## 0. Key facts

- Zotero ships fast now: 8.0 (2026-01-22), 9.0 (2026-04-10), 10.0 (2026-08-17), new major release every 6 to 10 weeks ([Zotero 8 blog](https://www.zotero.org/blog/zotero-8/), [9.0 changelog](https://www.zotero.org/support/9.0_changelog), [changelog](https://www.zotero.org/support/changelog)).
- The data model has 40 item types (37 regular plus `attachment`, `note`, `annotation`), 121 distinct fields, 13 base fields with 58 mapped type-specific fields, and 37 creator types ([schema.json](https://github.com/zotero/zotero-schema/blob/master/schema.json)).
- Zotero 10 added **write support to the local API** on port 23119, with a user-approved key ([Local API docs](https://www.zotero.org/support/dev/web_api/v3/local_api)).
- The official Zotero Connector can save into a third-party app. At least four projects do this today ([papis-zotero](https://github.com/papis/papis-zotero), [cl-zotero-connector](https://zff.dev/lou/cl-zotero-connector), [zoro](https://github.com/ruihanglix/zoro), [Agentero](https://github.com/poco-ai/Agentero)). Translators run inside the extension, so the app receives finished item JSON.
- Nearly all Zotero code is AGPL-3.0. zotero-schema has no license file. CSL styles and locales are CC BY-SA 3.0. Better BibTeX is MIT.
- The "reverse engineer anything" repo is **REA**, [github.com/morluto/rea](https://github.com/morluto/rea) (MIT, about 370k stars). Its own skill says to skip it when the source is available, and Zotero's source is available.

---

## 1. Data model

### 1.1 schema.json

Source: [zotero/zotero-schema](https://github.com/zotero/zotero-schema). The top-level keys are `version`, `itemTypes`, `meta`, `csl` and `locales` (48 locales). The file is also served at `https://api.zotero.org/schema`, and clients should fetch it with ETag caching ([README](https://github.com/zotero/zotero-schema/blob/master/README.md)). On 2026-10-23 that endpoint served version 42, while repo master was at version 45. The schema is therefore versioned data that Zotero updates independently of app releases. For example, Zotero 7.0.32 already carried schema v40.

**Item types (40):** annotation, artwork, attachment, audioRecording, bill, blogPost, book, bookSection, case, computerProgram, conferencePaper, dataset, dictionaryEntry, document, email, encyclopediaArticle, film, forumPost, hearing, instantMessage, interview, journalArticle, letter, magazineArticle, manuscript, map, newspaperArticle, note, patent, podcast, preprint, presentation, radioBroadcast, report, standard, statute, thesis, tvBroadcast, videoRecording, webpage.

`annotation` and `note` have no schema fields; their data lives in dedicated tables. `attachment` has 3 fields: title, accessDate and url.

**Fields:** 121 distinct names, made up of 63 base or standalone fields and 58 type-specific fields mapped to a base field. Eight fields are common to all 37 regular types: `DOI, abstractNote, accessDate, citationKey, extra, rights, shortTitle, url`. `title` is not universal, because `case` uses caseName, `email` uses subject and `statute` uses nameOfAct. Field counts per type range from 11 (email, instantMessage) to 31 (journalArticle). `meta.fields` marks three date fields: `date`, `filingDate` and `originalDate`.

**Base-field mappings (13 base fields):**

| Base field | Type-specific fields (item type) |
|---|---|
| publicationTitle | bookTitle (bookSection), proceedingsTitle (conferencePaper), websiteTitle (webpage), blogTitle, forumTitle, encyclopediaTitle, dictionaryTitle, programTitle (radio/tv), sessionTitle (presentation) |
| publisher | university (thesis), institution (report, manuscript), repository (preprint, dataset), company (computerProgram), label, distributor, network, studio |
| number | reportNumber, billNumber, docketNumber, patentNumber, episodeNumber, publicLawNumber, documentNumber, archiveID (preprint), identifier (dataset) |
| type | thesisType, reportType, genre (film, preprint), websiteType, postType, letterType, manuscriptType, mapType, presentationType |
| title | caseName, subject (email), nameOfAct |
| date | dateDecided, issueDate, dateEnacted |
| authority | court, legislativeBody, issuingAuthority, organization (standard) |
| medium | format, artworkMedium, audioRecordingFormat, videoRecordingFormat, interviewMedium, audioFileType |
| volume, pages, place, status, originalDate | codeVolume/reporterVolume, codePages/firstPage, repositoryLocation, legalStatus, priorityDate |

`authority` and `medium` are abstract: no item type uses them directly. Zotero stores values under the type-specific field and resolves base fields through `baseFieldMappings` tables. Search, CSL export and item-type changes all go through the base field. **Inference** on storage detail: the tables exist; I did not trace every getter.

**Creator types (37):** artist, attorneyAgent, author, bookAuthor, cartographer, castMember, chair, commenter, composer, contributor, cosponsor, counsel, creator, director, editor, executiveProducer, guest, host, interviewee, interviewer, inventor, narrator, organizer, originalCreator, performer, podcaster, presenter, producer, programmer, recipient, reviewedAuthor, scriptwriter, seriesCreator, seriesEditor, sponsor, translator, wordsBy.

Each item type declares one primary creator. It is `author` for most types; the exceptions include artwork=artist, computerProgram=programmer, patent=inventor, film=director, map=cartographer, presentation=presenter, podcast=podcaster, bill=sponsor and hearing=contributor. Creators are stored either as `{firstName, lastName}` or as single-field `{name}`, controlled by `fieldMode` in the creators table.

**CSL-JSON mappings in `csl`:**
- `csl.types`: 32 CSL types cover the 40 Zotero types, several many-to-one. Examples: broadcast covers podcast, tvBroadcast and radioBroadcast; personal_communication covers letter, email and instantMessage; document covers document, attachment and note; preprint maps to `article`.
- `csl.fields.text`: 47 CSL variables. Examples: container-title comes from publicationTitle, reporter or code; `note` comes from extra; `license` comes from rights; `citation-key` comes from citationKey.
- `csl.fields.date`: issued from date, accessed from accessDate, submitted from filingDate, original-date from originalDate.
- `csl.names`: 24 creator mappings. Examples: bookAuthor becomes container-author, seriesEditor becomes collection-editor, podcaster becomes host. The other 13 creator types (artist, inventor, programmer, etc.) have no CSL mapping. When such a type is the primary creator, it falls back to CSL `author` ([utilities_item.js](https://github.com/zotero/utilities/blob/master/utilities_item.js), verified).
- Fields with no CSL variable at all: assignee, country, seriesText.

**Schema evolution (verified by diffing schema versions):**
- v32 (Jan 2025): 111 fields, 29 creator types, DOI on only 5 types.
- Zotero 8.0.0 (schema v41): DOI and citationKey on all types, PMID/PMCID added, original publication fields added, 8 new creator types added ([PR #2](https://github.com/zotero/zotero-schema/pull/2), merged 2025-12-20). An `arXiv ID` field was added and then removed on 2025-12-26.

**License of zotero-schema:** the repo has no LICENSE file, and GitHub reports none. The repo is a git submodule of the AGPL Zotero client. **Inference:** field and type names are facts and probably not copyrightable, but the 48 locale string sets may be. **Unverified:** whether Zotero intends a license. The safe route is to generate citegeist's own schema file from these facts, with attribution, and not redistribute the locales verbatim.

### 1.2 How Zotero stores data

**Data directory** (macOS default `~/Zotero`, [docs](https://www.zotero.org/support/zotero_data)):
- `zotero.sqlite`, plus `-wal` and `-shm` files since Zotero 10, which enabled WAL mode.
- `zotero.sqlite.bak` backups (`backup.numBackups` = 2).
- `fulltext.sqlite`, new in Zotero 10: contentless FTS5 index tables (plus CJK variants), attached as `ftindex` ([fulltext.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/fulltext.js)).
- `storage/<KEY>/` holds the file itself, `.zotero-ft-cache` (extracted plain text) and `.zotero-reader-state` (reading position).
- `cache/<library>/<annotationKey>.png` holds renders of image and ink annotations.
- `styles/`, `translators/`, `locate/`, `logs/`, `pipes/`.

**Main tables** (`userdata.sql`, schema 130, [source](https://github.com/zotero/zotero/blob/main/resource/schema/userdata.sql)):
- `items` (itemID, itemTypeID, libraryID, `key`, version, synced, dates) is the core table. Field values are entity-attribute-value: `itemData` (itemID, fieldID, valueID) points into `itemDataValues`, which stores each distinct value once.
- Type metadata: `itemTypes`, `fields`, `itemTypeFields`, `baseFieldMappings`, plus `*Combined` variants and `custom*` tables.
- `creators` (firstName, lastName, fieldMode) joins items through `itemCreators` (creatorTypeID, orderIndex).
- `itemNotes` (parentItemID, note HTML, title).
- `itemAttachments` (parentItemID, linkMode, contentType, path, syncState, storageHash, lastRead).
- `itemAnnotations` (parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal).
- `tags` and `itemTags` (type 0 = manual, 1 = automatic).
- `collections` (parentCollectionID) and `collectionItems`.
- `itemRelations` (predicate, object URI) with `relationPredicates`. Three predicates are in use: `dc:relation` for related items, `owl:sameAs` for cross-library links and `dc:replaces` for merged items ([relations.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/relations.js)).
- `savedSearches` and `savedSearchConditions`.
- `deletedItems`, `deletedCollections`, `deletedSearches` implement the trash; it auto-empties after 30 days.
- `libraries`, `groups`, `feeds`, `feedItems`, `retractedItems`, `fulltextItems`.
- Sync tables: `syncCache`, `syncDeleteLog`, `syncQueue`, `storageDeleteLog`.
- `settings` and `syncedSettings`. Tag colors live here as `tagColors`, with a maximum of 9 colored tags.

**Keys:** 8 characters from the alphabet `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`, unique per library ([utilities.js](https://github.com/zotero/utilities/blob/master/utilities.js)). The same key is used in URIs, in sync and as the `storage/` folder name.

**Attachments** ([attachments.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/attachments.js), [docs](https://www.zotero.org/support/attaching_files)):
- linkMode values: 0 imported_file (stored copy), 1 imported_url (downloaded or snapshot), 2 linked_file (pointer only, no sync), 3 linked_url, 4 embedded_image (images inside notes).
- `path` is `storage:<filename>` for stored files and `attachments:<relative>` relative to the linked-attachment base directory. Otherwise it is an absolute path.
- **Snapshots** are single-file HTML produced by SingleFile inside the browser, posted to `/connector/saveSingleFile` and stored as imported_url text/html. Since Zotero 7 they can be annotated in the reader.

**Notes** are HTML produced by the ProseMirror-based [note-editor](https://github.com/zotero/note-editor). The wrapper is `div[data-schema-version]`. Embedded citations and annotations carry JSON in `data-citation` and `data-annotation` attributes, and images reference embedded_image attachments.

Since Zotero 10, the project discourages reading `zotero.sqlite` directly because of WAL mode, and recommends the local API instead ([Zotero 10 for developers](https://www.zotero.org/support/dev/zotero_10_for_developers)).

---

## 2. Feature inventory (Zotero 7 to 10)

| Version | Date | Headline features |
|---|---|---|
| 7.0 | 2024-08-09 | Redesign; EPUB and snapshot reader; ink, underline and text annotations; restartless plugins; rename templates; read-only local API ([blog](https://www.zotero.org/blog/zotero-7/)) |
| 8.0 | 2026-01-22 | Unified citation dialog; annotations in items list (searchable, taggable); reader themes; note tabs; continuous file renaming; Connector tag autocomplete and note field; local API returns annotations, adds `/fulltext` ([changelog](https://www.zotero.org/support/8.0_changelog)) |
| 9.0 | 2026-04-10 | Read Aloud; Recently Read; "Add Annotation" in Word; Citation Key column and search; group Added By/Modified By |
| 10.0 | 2026-08-17 | Advanced search above the items list with nested groups and result levels; accent-insensitive search; FTS5 full text; multi-collection selection; batch edit; undo/redo; PDF Reading Mode (reflow); local API writes ([blog](https://www.zotero.org/blog/zotero-10/)) |

- **Collections:** hierarchical; one item can sit in many collections without duplication. Virtual views include Unfiled, Duplicate Items, My Publications and Recently Read (9.0). Zotero 10 adds multi-collection selection ([docs](https://www.zotero.org/support/collections_and_tags)).
- **Tags:**
  - Manual tags (blue icon) and automatic tags (red icon, added by translators). Automatic tags can be hidden or bulk-deleted.
  - Up to 9 colored tags, toggled with keys 1 to 9. Emoji tags display in the items list.
  - Selecting several tags in the tag selector filters with AND. Renaming a tag to an existing name merges the two.
- **Related items:** `dc:relation` is written on both items (the UI calls `addRelatedItem` in both directions). Related items are untyped.
- **Saved searches:** condition lists. Since Zotero 10 they support nested groups (`groupStart`/`groupEnd`, `joinMode`) and `resultLevel` (item, attachment, note, annotation).
- **Duplicates** ([docs](https://www.zotero.org/support/duplicate_detection)):
  - Detection matches title, DOI and ISBN. If those match or are absent, it then checks the year (within ±1) and creators (one last name plus first initial).
  - Detection works within one library only. False positives cannot be marked as non-duplicates.
  - Merging: you pick a master item and then a value per field. Collections and tags are combined. Attachments are deduplicated by MD5. Losing items go to the trash with a `dc:replaces` relation, so citations in documents keep resolving ([mergeItems.mjs](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/mergeItems.mjs)).
- **Trash:** items, collections and searches (the last two since 7.0). Auto-empty after 30 days.
- **Notes:** child or standalone notes, rich text, embedded citations and annotations, "Add Note from Annotations". Zotero 8 added note tabs and word count.
- **Attachments:**
  - Auto-rename from parent metadata, applied to PDF and EPUB by default and re-applied when metadata changes (8.0).
  - "Find Available PDF" tries four resolver methods in order: `doi` (landing page), `url`, `oa` (Zotero's open-access lookup) and `custom` resolvers (hidden pref `findPDFs.resolvers`).
- **Reader and annotations** (data model verified in [reader types.ts](https://github.com/zotero/reader/blob/master/src/common/types.ts), [annotations.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/annotations.js)):
  - Types: highlight=1, note=2, image=3, ink=4, underline=5, text=6. Ink and text are PDF-only.
  - Each annotation is its own item: a child of the attachment with its own key, tags and relations.
  - `position` is a JSON string, up to 65,000 characters:
    - PDF: `{pageIndex, rects:[[x1,y1,x2,y2],...], nextPageRects?}` in PDF page coordinates. Ink adds `paths` and `width`. Text annotations add `fontSize` and `rotation`.
    - EPUB: a W3C Web Annotation `FragmentSelector` holding an `epubcfi(...)` value.
    - Snapshots: `CssSelector` refined by `TextPositionSelector`.
    - Zotero 10 Reading Mode adds `SDTPosition {start, end}`, which addresses a Structured Document Text tree.
  - `sortIndex` formats:
    - PDF: `PPPPP|OOOOOO|TTTTT` (page index, character offset, distance from page top).
    - EPUB: `SSSSS|CCCCCCCC` (section index, character offset).
    - Snapshot: 7-digit character offset.
  - Other fields: `pageLabel` (the printed page label, which is what citations need), `color` (hex), `authorName` (for groups), `isExternal` (read-only annotations imported from the PDF file itself).
  - Zotero stores annotations in the database, not in the PDF.
- **Add Item by Identifier:** accepts ISBN, DOI, PMID, arXiv ID and ADS Bibcode, and several at once separated by spaces, commas or newlines ([docs](https://www.zotero.org/support/adding_items_to_zotero)). Lookups go through the 19 search translators, including DOI Content Negotiation, Crossref REST, arXiv.org, PubMed, OpenAlex, mEDRA, several ISBN catalogs (LoC, K10plus, BnF, LIBRIS) and ADS.
- **Retrieve Metadata for PDF/EPUB** ([recognizeDocument.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/recognizeDocument.js)):
  - PDF: the local document-worker extracts layout text from the first pages. The client POSTs this JSON to `https://services.zotero.org/recognizer/recognize` without an API key. The service returns an arXiv ID, DOI or ISBN, which the client resolves through search translators. Failing that, it returns title, authors, abstract and year, which become a journalArticle or bookSection. The recognizer server is not public (`zotero/recognizer` returns 404).
  - EPUB: the client reads OPF/RDF metadata and scans the first 5 sections, including the copyright page, for a DOI or ISBN.
- **Full-text indexing:** text extraction by document-worker, limited to 500,000 characters and 100 PDF pages by default. Text is cached in `.zotero-ft-cache`. Zotero 10 rebuilt search on FTS5 in a separate database. Full-text content can sync.
- **Retractions:** data comes from Retraction Watch, now hosted by Crossref ([blog](https://www.zotero.org/blog/retracted-item-notifications/), [Crossref](https://www.crossref.org/blog/news-crossref-and-retraction-watch/)). The check is privacy-preserving: the client downloads a list of SHA-1 DOI-hash prefixes and PMID prefixes from `api.zotero.org/retractions/list`, then queries `/search` only for prefixes that match ([retractions.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/retractions.js)). Only items with a DOI or PMID can be checked. Matches show a banner and trigger a warning when citing.
- **Feeds:** RSS feeds become separate read-only feed libraries. OPML import is supported. Read state does not sync. Items can be saved into a library ([docs](https://www.zotero.org/support/feeds)).
- **CSL styles:** citeproc-js renders citations. The CSL repo has 2,863 independent and 8,005 dependent styles and 63 locale files; CSL 1.0.2 is the latest spec. Other features: Quick Copy, Create Bibliography, and installing a style by clicking a link (via the Connector's `installStyle`).
- **Word processor integration** (brief): Word, LibreOffice, and Google Docs via the Connector. Word field codes are `ZOTERO_ITEM CSL_CITATION {json}`, with item URIs and embedded CSL-JSON `itemData`. The bibliography is `ZOTERO_BIBL {...} CSL_BIBLIOGRAPHY`, and document prefs use `data-version` 3 ([integration.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/integration.js)). Another agent covers this in depth.
- **Translators and translation-server:**
  - 752 translators: 704 web, 25 import, 22 export, 19 search. The repo now contains `AGENTS.md` and `CLAUDE.md` for AI-assisted translator work.
  - [translation-server](https://github.com/zotero/translation-server) is a Node service on port 1969 (Docker image `zotero/translation-server`) with endpoints `/web` (URL), `/search` (identifier), `/import` and `/export?format=`.
- **Import formats:** BibTeX, RIS, CSL JSON, Endnote XML, Citavi 5 XML, MODS, MARC/MARCXML, PubMed XML, MEDLINE/nbib, Crossref Unixref, Datacite JSON, OpenAlex JSON, Zotero RDF and RefWorks, among others.
- **Export formats:** BibTeX, BibLaTeX, RIS, CSL JSON, Zotero RDF, MODS, CSV, Endnote XML, Note Markdown/HTML, CFF, TEI, Wikidata QuickStatements, Wikipedia templates, COinS, Refer, Bookmarks.
- **Sync** ([docs](https://www.zotero.org/support/sync), [storage](https://www.zotero.org/storage)): data sync is free and unlimited. File sync uses Zotero Storage (300 MB free; 2 GB for $20/yr; 6 GB for $60/yr; unlimited for $120/yr) or WebDAV, which works for My Library only. A self-hosted sync server exists: [altero](https://github.com/eseifert/altero) (AGPL).
- **Groups:** private, public closed or public open. Roles are owner, admin and member. File storage counts against the owner's quota ([docs](https://www.zotero.org/support/groups)).

### 2.1 Local HTTP API (port 23119)

History:
- Announced 2024-06-15 for Zotero 7 beta 88 as a read-only clone of Web API v3 ([zotero-dev](https://groups.google.com/g/zotero-dev/c/ElvHhIFAXrY/m/fA7SKKwsAgAJ)).
- Zotero 8 added annotations and `/fulltext`.
- Zotero 10 added writes ([docs](https://www.zotero.org/support/dev/web_api/v3/local_api)).

How it works:
- Off by default (`httpServer.localAPI.enabled` = false). Base URL `http://localhost:23119/api/`; user ID 0.
- Reads are unauthenticated, so any local process can read the library.
- Writes: POST/PUT/PATCH/DELETE on items, collections and searches, plus tag deletion, full-text writes and file uploads (3-step flow, imported files only, under 4 GB).
- Write authorization: `POST /api/local/authorize` opens an Allow / Always Allow / Deny dialog and returns a 32-character key, sent as the `Zotero-API-Key` header.
- Every response carries `Zotero-Server-ID`. Sending it back is optional on reads (412 on mismatch) and required on writes (428 if missing).
- Object versions are local counters.
- Hardening in Zotero 10: the Host header must be `localhost`, `127.0.0.1` or `[::1]`. Browser-like requests (`Mozilla/` user agent, or any `Origin` header) are dropped unless they carry `Zotero-Allowed-Request` or the Connector header.
- Local-only extras: `/searches/<key>/items` (saved search results) and `/items/<key>/file/view/url`.

### 2.2 Connector HTTP endpoints

The Zotero server (`httpServer.port` 23119, ASCII "ZO") registers 19 endpoints in [server_connector.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/server/server_connector.js): ping, getTranslators, getTranslatorCode, detect, saveItems, saveSnapshot, saveSingleFile, saveAttachment, saveStandaloneAttachment, getRecognizedItem, hasAttachmentResolvers, saveAttachmentFromResolver, updateSession, delaySync, import, installStyle, getSelectedCollection, getClientHostnames, proxies.

The current Connector calls 18 of them; it does not call `detect` (verified by grepping [zotero-connectors](https://github.com/zotero/zotero-connectors)).

Protocol (`CONNECTOR_API_VERSION = 3` on both sides):
- `GET /connector/ping` returns the HTML page "Zotero is running". `POST /connector/ping` returns `{prefs:{automaticSnapshots, downloadAssociatedFiles, supportsAttachmentUpload, translatorsHash, ...}}`.
- `saveItems` receives `{sessionID, uri, proxy, items:[Zotero translator JSON]}`. It answers 409 `SESSION_EXISTS` if the session is reused. Only linked attachments travel inside this payload.
- The Connector then calls `getSelectedCollection`, which returns `{libraryID, libraryName, editable, filesEditable, targets:[...], tags}`. If `filesEditable` is true, the browser downloads each PDF or EPUB itself, using the user's cookies, and POSTs the raw bytes to `saveAttachment?sessionID=` with an `X-Metadata` header (`parentItemID`, title, url).
- Snapshots go to `saveSingleFile` as SingleFile HTML.
- Pages with no translator go to `saveSnapshot`.
- PDF tabs go to `saveStandaloneAttachment`; the Connector then polls `getRecognizedItem`.
- Edits in the save popup (collection, tags, note) arrive later via `updateSession`.
- `import` handles clicked .bib or .ris links. `installStyle` handles clicked .csl links.
- Translators: when the desktop app answers, the Connector loads translators from it via `getTranslators` and `getTranslatorCode`. If those calls fail, it falls back to `repo.zotero.org` ([repo.js](https://github.com/zotero/zotero-connectors/blob/main/src/common/repo.js)).
- Target URL: the Connector reads it from the pref `connector.url`, default `http://127.0.0.1:23119/`. Users can edit it in Connector Preferences, Advanced, Config Editor.

**Assessment: can a third-party app receive saves from the official Connector?** Yes. Prior art:

| Project | Stack, license | Coverage |
|---|---|---|
| [papis-zotero](https://github.com/papis/papis-zotero) `serve` | Python, GPL-3.0 | ping, getSelectedCollection, saveItems, saveSnapshot. Claims API v2 and Zotero 5.0.75. **Inference:** with the current Connector it receives no PDFs, because it omits `filesEditable` and `saveAttachment`. |
| [cl-zotero-connector](https://zff.dev/lou/cl-zotero-connector) | Common Lisp, WIP (May 2026) | Modern flow including saveAttachment, saveSingleFile, updateSession |
| [zoro](https://github.com/ruihanglix/zoro) | Tauri/Rust, AGPL-3.0 | Full flow; documented "cannot run alongside Zotero" |
| [Agentero](https://github.com/poco-ai/Agentero) | Tauri/Rust, MIT, about 1k stars | Full flow including OA resolvers; port configurable; [docs](https://github.com/poco-ai/Agentero/blob/main/docs/backend/connector.md) state `filesEditable: true` is required |

JabRef took a different route: it bundles Zotero translators in its own extension and talks to JabRef over HTTP since extension v3.0 (March 2026).

Pitfalls:
1. **Port conflict.** Only one process can bind 127.0.0.1:23119. Options:
   - Bind 23119 only when Zotero is not running.
   - Have the user point `connector.url` at a citegeist port (per browser, by hand). Zotero then stops receiving saves.
   - **Inference:** a forwarding proxy on 23119, with Zotero moved to another `httpServer.port`. This is untested.
2. **Headers.** Every response, including errors, must carry `X-Zotero-Version`. Otherwise the Connector decides Zotero is offline and may save to zotero.org instead, if the user linked an account.
3. **`filesEditable: true`** must be returned from `getSelectedCollection`, or attachments are silently skipped.
4. **Translators.** Do not send `translatorsHash`, and return errors from `getTranslators`/`getTranslatorCode`. The extension then uses repo.zotero.org, and citegeist never ships AGPL translators.
5. **Undocumented, unversioned protocol.** The [docs page](https://www.zotero.org/support/dev/client_coding/connector_http_server) gives no stability promise. Zotero now ships a major release every 6 to 10 weeks, so the protocol needs contract tests from captured traffic.
6. **Security.** Bind to loopback only. Validate the Host header (DNS rebinding). Reject `Origin` or `Mozilla/` requests that lack `X-Zotero-Connector-API-Version`. Never send permissive CORS headers.
7. **Branding.** The UI still says "Save to Zotero" and error messages mention Zotero. Connector features that need Zotero itself (Google Docs integration, PDF recognition via `getRecognizedItem`) need citegeist equivalents or must be stubbed (`canRecognize:false`).
8. **Safari.** The Safari Connector is bundled inside Zotero.app and needs Safari 18 on macOS 13+ ([kb](https://www.zotero.org/support/kb/zotero_connector_and_safari)). Safari users therefore need Zotero installed, though not running. Chrome and Firefox Connectors install on their own.
9. **Payload format.** Items arrive in Zotero translator JSON, which is another argument for adopting the Zotero schema natively.

---

## 3. Better BibTeX

[retorquere/zotero-better-bibtex](https://github.com/retorquere/zotero-better-bibtex): MIT, about 7.2k stars, v9.0.71. BBT 8.0.26 dropped Zotero 7 support. The v9 release notes still say "compatible with Zotero 8 and Zotero 9 beta". **Unverified:** official Zotero 10 compatibility.

**Citation keys** ([docs](https://retorque.re/zotero-better-bibtex/citing/)):
- Default formula: `auth.lower + shorttitle(3,3) + year`, with a letter postfix (a, b, ...) on clashes.
- Clash resolution is deterministic across the whole library.
- Formula language: functions start lowercase (`auth`, `title`, `shorttitle`, `year`), field access starts uppercase, and filters chain (`.lower`, `.clean`, `.transliterate`, `.select(...)`).
- Operators: `+` concatenates, `||` takes the first non-empty alternative, `;` or `|` separates fallback formulas.
- With Zotero 8, keys moved into the native `citationKey` field. They now sync, and pinning is obsolete because every key is effectively pinned. Some users reported migration problems in a February 2026 forum thread.

**Auto-export** ([docs](https://retorque.re/zotero-better-bibtex/exporting/auto/)):
- An export with "Keep updated" re-exports a library, group or collection on change, on idle, or not at all while paused.
- Git push integration; Overleaf via a shared-folder URL.
- BBT ships these translators: Better BibTeX, Better BibLaTeX, Better CSL JSON, Better CSL YAML, Better Hayagriva (Typst), BetterBibTeX JSON, Citation graph. **Unverified:** whether all of them support auto-export.

**HTTP endpoints on 23119:**
- `/better-bibtex/cayw`: a citation picker with output formats pandoc, natbib/latex, biblatex, mmd, typst, asciidoctor-bibtex, scannable-cite, formatted citation or bibliography, and json ([docs](https://retorque.re/zotero-better-bibtex/citing/cayw/)).
- Pull export.
- JSON-RPC.

**Why academics rely on it (synthesis):**
- Citation keys are stable and readable, so they work as permanent handles in `.tex` and `.md` files.
- An always-current `.bib` file feeds LaTeX, Overleaf, Pandoc, Quarto and Typst without manual export.
- LaTeX-safe Unicode and markup conversion, and BibLaTeX field fidelity.
- Editor integrations (VS Code, Emacs, Vim) through CAYW.

---

## 4. AI plugins and MCP servers (October 2026)

I found no first-party AI in Zotero and no official AI strategy statement ([forum thread](https://forums.zotero.org/discussion/132016/)). Star counts were taken from the GitHub API on 2026-10-23.

| Project | Stars | License | What it does |
|---|---|---|---|
| [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) | 5,538 | MIT | MCP server, CLI plus agent skill (98 tokens instead of about 17k), and an in-Zotero agent. Reads `zotero.sqlite` directly; writes via the Zotero 10 local API or the Web API. Semantic search, annotations. |
| [yilewang/llm-for-zotero](https://github.com/yilewang/llm-for-zotero) | 3,392 | AGPL | Agent inside Zotero. Can run through the user's own **Codex App Server** (ChatGPT login) or **Claude Code** login. Skills, notes. |
| [papersgpt-for-zotero](https://github.com/papersgpt/papersgpt-for-zotero) | 2,679 | AGPL | PDF chat, library search, local models |
| [zotero-gpt](https://github.com/MuiseDestiny/zotero-gpt) | 7,495 | AGPL | GPT in Zotero; last push 2026-05 |
| [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) | 12,134 | AGPL | Translation including LLM engines |
| [zotero-AI-Butler](https://github.com/steven-jianhao-li/zotero-AI-Butler) | 1,827 | AGPL | Auto-reads papers into notes |
| [Aria](https://github.com/lifan0127/ai-research-assistant) | 1,730 | AGPL | Stale (last push 2025-04) |
| [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) | 1,252 | MIT | Zotero plugin with an embedded Streamable-HTTP MCP server; writes |
| [beaver-zotero](https://github.com/jlegewie/beaver-zotero) | 271 | AGPL | Commercial assistant, credit-based (pricing per a third-party roundup, unverified) |
| [ZotSeek](https://github.com/introfini/ZotSeek) | 232 | none | Semantic search plus MCP |
| [kujenga/zotero-mcp](https://github.com/kujenga/zotero-mcp) | 162 | MIT | Lightweight Web API MCP |
| [openai/plugins: zotero](https://github.com/openai/plugins/tree/main/plugins/zotero) | n/a | n/a | **OpenAI's first-party Codex plugin**: local API search, BibTeX export, import via `/connector/import` |

I did not find an Anthropic first-party Zotero plugin.

**Inference about the trend:**
- Tools converge on the Zotero 10 local API for writes, PDF-to-Markdown plus embeddings, CLI or skills instead of MCP for token efficiency, and the user's own Codex or Claude Code login for inference.
- "Chat with PDF" is commoditized and free.
- Two projects are close to citegeist's whole concept: **Agentero** (ACP to local agents, built-in MCP, CLI, plain-folder vault with a `metadata.json` sidecar and `marks/annotations.json`, Zotero import) and **zoro** ("the filesystem is the API").

---

## 5. Licenses

| Component | License (verified in repo) |
|---|---|
| zotero/zotero (client) | AGPL-3.0, plus registered trademark "Zotero" |
| zotero/translators | No repo license. Per-file headers: 619 AGPL, 29 GPL, 1 Apache-2.0, 2 CC/public domain, 101 without a header |
| zotero/translation-server, zotero/translate, zotero/utilities | AGPL-3.0 |
| zotero/reader | AGPL-3.0 |
| zotero/pdf-worker, now renamed [zotero/document-worker](https://github.com/zotero/document-worker) | AGPL-3.0. It now includes structured text extraction from PDF, EPUB and HTML, with ONNX block-segmentation, reference and table models |
| zotero/note-editor, zotero/zotero-connectors | AGPL-3.0 |
| zotero-schema | No license file |
| citeproc-js | CPAL-1.0 **or** AGPL-3.0 (dual) |
| CSL styles, CSL locales | CC BY-SA 3.0. Must credit the CSL project with a link to citationstyles.org and keep author lists |
| CSL schema | MIT |
| Better BibTeX | MIT |
| SingleFile (used by the Connector) | AGPL-3.0 |
| Permissive alternatives | pdf.js (Apache-2.0), hayagriva (Apache-2.0), jgm/citeproc (BSD-2), citeproc-java (Apache-2.0) |

Implications (**Inference, not legal advice**):

**(a) Purely personal tool.** AGPL obligations start when you convey the software or offer a modified version to other users over a network. Personal use carries no obligations, so citegeist could even embed zotero/reader. Zotero's [Terms of Service](https://www.zotero.org/support/terms/terms_of_service) still apply to its online services: §6(e) forbids reverse engineering the Services and §6(h) forbids bots. So do not script services.zotero.org or api.zotero.org beyond normal client use.

**(b) Later open source under MIT or Apache.**
- No AGPL code may sit inside citegeist's own code or run in its process. Bundling zotero/reader, note-editor or citeproc-js (AGPL option) into the UI would make the combined work AGPL.
- AGPL tools can still be used as **separate programs** talking over HTTP/JSON or a CLI. The FSF generally treats sockets and pipes as an aggregate unless the programs exchange intimate internal data structures. Examples: translation-server in its own process or container, document-worker as a separate Node process. If you distribute them, include their license and source. Simpler: let the user install them (Docker pull, or the browser store for the Connector).
- The user's own Connector running translators triggers nothing for citegeist.
- CSL styles can be bundled with attribution.
- citeproc-js under its CPAL option is file-level copyleft plus attribution. **Unverified:** what attribution the CPAL Exhibit B requires here, since the LICENSE file does not specify it. A permissive processor such as hayagriva avoids the question.
- Implement the Connector and local API protocols clean-room. Interface behaviour is interoperability; do not copy code.

**(c) Commercial product.**
- AGPL permits commercial use, but a closed product cannot include AGPL code.
- Running unmodified AGPL services as separate processes is the common pattern. The legal line is not settled; the conservative path is permissive components plus clean-room code.
- Do not use Zotero's online services (recognizer, retractions, OA lookup) commercially without written permission (ToS §6). Get Retraction Watch data directly from Crossref. **Unverified:** the license of the Retraction Watch dataset.
- Keep "Zotero" out of the product name. "Works with the Zotero Connector" is probably nominative use. **Unverified:** check [zotero.org/trademark](http://zotero.org/trademark).

---

## 6. "Reverse engineer anything"

**Found, with high confidence: REA (Reverse Engineer Anything).**
- [github.com/morluto/rea](https://github.com/morluto/rea): MIT, created 2026-04-14, about 370k stars and 92.6k forks on 2026-10-23.
- npm package `rea-agents`, website [rea.tools](https://rea.tools), skill `reverse-engineer-anything` on skills.sh. Covered by [InfoQ, Oct 2026](https://www.infoq.com/news/2026/10/reverse-engineer-anything/).
- It is an MCP server plus skill for Claude Code, Codex, Cursor and others. Capabilities: native binaries via Hopper, Ghidra or IDA; static JavaScript/Electron analysis; websites via Chrome; HAR network captures; **SQLite databases** (tables, indexes, triggers, rows, WAL snapshots); process-behaviour capture; inspection of installed desktop apps.
- The README warns that look-alike repos are not official. Example: `NabilRFG12/Reverse-Engineer-anything` copies the description.

**Applying it to Zotero:**
- REA's own skill says: "Skip REA for ordinary source-repository architecture analysis." Zotero's client, reader, Connector and translators are open source, so source reading (as in this document) is the primary method.
- Useful applications:
  1. SQLite inspection of a *copy* of your real `zotero.sqlite`, including WAL. This gives a ground-truth data dictionary and fixtures for citegeist's Zotero importer.
  2. HAR capture of Connector-to-Zotero traffic, to build golden request and response fixtures for citegeist's connector-compatibility tests.
  3. Comparing behaviour across Zotero versions (9 vs 10).
  4. Inventory of the Zotero.app bundle. **Unverified** whether this works: REA identifies Electron apps by their ASAR archive, but Zotero is a Gecko app packaged in `omni.ja`.
- Do not point it at zotero.org services (ToS §6(e)).
- Keep the result clean-room if citegeist goes MIT: derive a spec from REA's output, then implement from scratch.

**Related candidates:** [replica-skill](https://github.com/Jakeschincariol/replica-skill) (MIT, 4.9k stars; eleven Claude skills for clean-room app cloning, starting with `/replica-recon`), [blader/schematic](https://github.com/blader/schematic) (spec from a git branch), [HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything) (Apache-2.0, 56k stars, includes a Zotero agent harness).

---

## 7. Parity checklist for citegeist

Profile: one person, macOS, PhD proposal plus technical papers, no team features.

| Priority | Feature | Note |
|---|---|---|
| **Must** | Zotero item model imported as versioned data: types, fields, base mappings, creator types, CSL map | Lossless Zotero import and Connector payloads; generate citegeist's own schema file from these facts |
| **Must** | Native citation-key field with a BBT-style formula and stable keys | Default `auth.lower + shorttitle(3,3) + year` |
| **Must** | Add by DOI, arXiv ID, ISBN, PMID (batch paste) | Call Crossref, DataCite, arXiv, OpenAlex and PubMed APIs directly |
| **Must** | PDF import with metadata recognition | DOI/arXiv/ISBN regex on the first pages and XMP; fallback LLM extraction plus Crossref/OpenAlex match. Do not use services.zotero.org |
| **Must** | Zotero Connector compatibility, behind a toggle and with a configurable port | Brings 704 web translators and authenticated PDF downloads at low cost; follow pitfalls 1 to 9 |
| **Must** | Stored attachments in a readable folder layout, rename from metadata, extracted-text cache per file | Agent and human readable |
| **Must** | PDF reader with highlight, underline and note annotations; Zotero-compatible position, sortIndex and pageLabel | Basis for the AI highlighter. pageLabel gives the citable page |
| **Must** | Collections (hierarchy, multi-membership), manual and automatic tags, trash, undo | |
| **Must** | Full-text search over metadata, notes and text (SQLite FTS5) | |
| **Must** | Auto-export of BibTeX, BibLaTeX and CSL-JSON per project; formatted bibliography via CSL | |
| **Must** | Duplicate check on import (DOI, ISBN, title+year+creator) and merge | |
| **Must** | Zotero library import (Zotero 10 local API, or a read-only copy of the SQLite database plus storage) | Preserve keys, collections, tags, notes, annotations |
| Should | arXiv HTML and EPUB/snapshot reading with annotations (W3C selectors) | Technical papers |
| Should | Image (area) annotations for figures and equations | |
| Should | Saved searches | |
| Should | Find Available PDF (Unpaywall, arXiv) | |
| Should | Retraction warnings (Crossref/Retraction Watch) | |
| Should | Feeds (arXiv categories, journal RSS) | |
| Should | Quick Copy of citation or bibliography; CAYW-style picker endpoint | |
| Should | Import and export of RIS, BibTeX, CSL-JSON, Zotero RDF | |
| Should, if writing in Word | Word plugin with Zotero-style field codes | Otherwise use the Pandoc/Quarto/LaTeX path |
| Could | Zotero local-API-compatible read endpoints | Existing Zotero MCP servers and tools would work against citegeist |
| Could | Sync via a folder (iCloud, Dropbox) or WebDAV | |
| Could | Ink and text annotations; writing annotations into PDFs; reflow Reading Mode | |
| Could | Colored or emoji tags with number-key shortcuts | |
| Could | translation-server sidecar for URL import without a browser | AGPL kept separate |
| Skip | Groups, roles, My Publications, Zotero Storage or web library, mobile, proxies, Google Docs, RTF/ODF scan, style editor, Windows/Linux | |

Out of scope for parity, because they are citegeist's own features: typed graph links (a superset of `dc:relation`), quote objects, the MCP server and agent file layout. Agentero's vault layout is the closest prior art for that layout.

---

## 8. Open uncertainties

- Licensing intent of zotero-schema; the CPAL attribution terms for citeproc-js; the license of the Retraction Watch dataset; how Zotero's trademark policy treats "Connector-compatible" wording.
- Better BibTeX on Zotero 10: the release notes still name Zotero 8 and 9.
- Whether a 23119 forwarding proxy that lets citegeist and Zotero coexist actually works (untested).
- Whether papis-zotero really fails to receive PDFs with the current Connector (inferred from source, not tested).
- Whether REA supports Gecko apps such as Zotero.app.
- AI plugin popularity is measured by star counts only. Beaver pricing comes from a vendor roundup.
- A web search budget limit stopped further searches late in the session, so some secondary claims were not cross-checked.

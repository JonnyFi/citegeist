# Quote and citation workflow: from highlight to citable note

Research date: 2026-10-23. Scope: how a highlighted passage in citegeist should travel to a paper or PhD proposal so that it can be cited directly or indirectly with correct author, year and page.

Conventions in this document:

- **Verified** means I read it in the linked source on 2026-10-23.
- **Inference** means my own conclusion from verified facts.
- **Unverified** means I could not confirm it in this session. The shared web search budget ran out midway, so several points rest on direct fetches of known URLs only. The University of Vienna's main web servers (ctl.univie.ac.at, studienpraeses.univie.ac.at) redirected to a maintenance page during the session; studieren.univie.ac.at was reachable.

## 0. Short answer

A highlight should become a **quote card** that stores the verbatim text exactly once, together with a structured locator (item id, locator type, page label start and end) and a PDF anchor. All text that a model or the user writes about the passage lives in separate fields with provenance. Export never formats citations by string concatenation. It always emits a structured citation (CSL citation item: `id`, `locator`, `label`, `prefix`, `suffix`, `suppress-author`) and lets a CSL processor or the target system render it. Page numbers come from the PDF page label, which the user confirms once per document with an offset. German specifics such as "vgl.", "f." and "zit. n." are style decisions at render time and should not be baked into the stored data.

The v1 that saves time in a real proposal session: highlight, card with verbatim text and a confirmed page, AI comprehension note clearly marked as such, then one-keystroke copy of either the quote with its citation as rich text for Word or Google Docs, or the Pandoc form `[@key, S. 33]` for Markdown, both backed by a CSL-JSON export of the cited items.

## 1. Citation mechanics

### 1.1 CSL locators

Verified in the CSL-JSON citation schema ([csl-citation.json](https://raw.githubusercontent.com/citation-style-language/schema/master/schemas/input/csl-citation.json)): a citation item has `id`, `itemData`, `prefix`, `suffix`, `locator`, `label`, `suppress-author`, `author-only`, `uris`. `label` is an enum of 29 locator types:

`act, appendix, article-locator, book, canon, chapter, column, elocation, equation, figure, folio, issue, line, note, opus, page, paragraph, part, rule, scene, section, sub-verbo, supplement, table, timestamp, title-locator, verse, version, volume`

The citation object also carries `citationID` and `properties.noteIndex` (the footnote number, needed for note styles).

Verified in the [CSL 1.0.2 specification](https://docs.citationstyles.org/en/stable/specification.html):

- Position logic for note styles: `first`, `subsequent`, `ibid`, `ibid-with-locator`, `near-note`. If the preceding cite had the same locator, the position is `ibid`; if the locator differs it is `ibid-with-locator`. This is what produces "Ebd., S. 35." in German footnote styles.
- `page-range-format` supports `chicago` (alias of `chicago-15`), `chicago-16`, `expanded`, `minimal`, `minimal-two`. There is **no** format that produces "f." or "ff.". In CSL tools the user must type "33 f." as locator text.

Verified German locale terms ([locales-de-DE.xml](https://raw.githubusercontent.com/citation-style-language/locales/master/locales-de-DE.xml), updated 2026-09-10): `page` short form "S.", `paragraph` "Abs.", `chapter` "Kap.", `section` "Abschn.", `ibid` "ebd.", `et-al` "u. a.", `editor` "Hrsg.", `no date` "o. J.", quotation marks „…“ and ‚…‘. There is **no** term for "vgl." or "zitiert nach" in the locale. A [de-AT locale](https://raw.githubusercontent.com/citation-style-language/locales/master/locales-de-AT.xml) exists (for example "Jänner").

Consequence (inference): "vgl." must be a citation `prefix` and "zit. n." must be a prefix or suffix text. CSL has no structured "quoted in" relation between two items.

### 1.2 How citeproc renders in-text vs footnote

- Author-date style (APA): `(Müller, 2020, S. 33)` from `{id, locator:"33", label:"page"}`. The narrative form "Müller (2020, S. 33)" needs either `suppress-author` with the author typed manually, or citeproc-js's `composite` mode. Verified in [citeproc-js docs](https://citeproc-js.readthedocs.io/en/latest/running.html): flags are set via `properties.mode` (`suppress-author`, `author-only`, `composite`, with optional `infix`), fully supported only in `processCitationCluster()`, not in `makeCitationCluster()`.
- Note style (Chicago notes, German "Deutsche Zitierweise" styles): the processor needs `noteIndex` and the order of all citations to compute first, subsequent and ibid forms. Rendering a single citation in isolation (clipboard case) can only produce the "first" form. Inference: for footnote styles, clipboard export cannot give "ebd." correctly. A document-level renderer (Pandoc, Zotero plugin, own add-in) is needed.

### 1.3 Pandoc

Verified in the [Pandoc manual](https://pandoc.org/MANUAL.html) (current release 3.12.1, 2026-10-07 per [releases](https://pandoc.org/releases.html)):

- `[see @doe99, pp. 33-35 and *passim*]` gives prefix "see", locator "pp. 33-35", suffix. `[-@doe99]` suppresses the author. `@smith04 [p. 33] says` renders author in text.
- Locator parsing "is sensitive to the locator terms defined in the CSL locale files", abbreviated or full forms. Without a term, "page" is assumed. Curly braces force or prevent locator parsing: `[@smith{ii, A, D-Z}, with a suffix]`.
- In note styles, citations become footnotes automatically.
- The docx reader with `+citations` parses Zotero, Mendeley and EndNote citations into native Pandoc citations (since 3.10 it prefers `citation-key`).
- From [Citeproc.hs](https://raw.githubusercontent.com/jgm/pandoc/main/src/Text/Pandoc/Citeproc.hs): the locator map is built from the locale chosen by `lang` (or `locale`) metadata merged with the style locale. Inference, not tested: with `lang: de-DE`, `[vgl. @key, S. 33]` parses "S." as page. The safe export is `[vgl. @key, 33]` (no term, so "page" is assumed) or `[@key, S. 33 f.]` when f. is wanted.

### 1.4 biblatex

Verified in the biblatex manual (v3.22a, 2026-09-24) and [german.lbx](https://raw.githubusercontent.com/plk/biblatex/dev/tex/latex/biblatex/lbx/german.lbx):

- `\parencite[prenote][postnote]{key}`. With one optional argument it is the postnote: `\parencite[33]{key}` gives "S. 33" automatically. `\parencite[vgl.][33]{key}` adds the prenote.
- `\cite[27\psq]{key}` and `\cite[55\psqq]{key}` print the localisation strings `sequens` and `sequentes`, which are "f." and "ff." in German. The package option `citepagerange=2sq|3sqq|allsqq` converts real ranges (27-28) into "27 f." automatically.
- German strings: `confer` = "vgl.", `ibidem` = "ebd.", `quotedin` = "zit. nach", `page` = "S.".
- If the postnote contains non-numeric characters, no "S." prefix is added. Inference: citegeist should export the numeric range ("33-34") and let biblatex decide f./ff.

### 1.5 Typst

Verified ([cite docs](https://typst.app/docs/reference/model/cite/), [bibliography docs](https://typst.app/docs/reference/model/bibliography/), Typst 0.15.1):

- `@key[S. 33]` or `#cite(<key>, supplement: [S. 33], form: "prose")`. Forms: `normal`, `prose`, `full`, `author`, `year`, `none`.
- Bibliography sources are BibLaTeX `.bib` or Hayagriva `.yml`. CSL-JSON is not listed. Custom `.csl` files work.
- In the [Typst source](https://raw.githubusercontent.com/typst/typst/main/crates/typst-library/src/model/bibliography.rs) the supplement is passed as `Locator::Custom` with a transparent payload. There is no locator type detection, so "S." is not added or localized automatically. The user (or citegeist's exporter) must write "S. 33". There is no prefix parameter; "vgl." has to be typed before the citation as plain text or handled by a package. A bug where differing supplements still produced "ibid" ([hayagriva#280](https://github.com/typst/hayagriva/issues/280)) was closed on 2025-10-01.

Inference: Typst is the weakest target for German conventions. Export `vgl. @key[S. 33]` as text and a `.bib` file.

## 2. Word processor integration

### 2.1 How the Zotero Word plugin stores citations (verified)

From [Zotero integration.js](https://raw.githubusercontent.com/zotero/zotero/main/chrome/content/zotero/xpcom/integration.js) and the [fiduswriter format notes](https://raw.githubusercontent.com/fiduswriter/biblatex-csl-converter/HEAD/CITATIONS_IN_DOCS.md):

- Each citation in a .docx is a Word field whose code is `ADDIN ZOTERO_ITEM CSL_CITATION {json}`. The JSON follows the CSL citation schema: `citationID`, `properties` (`formattedCitation`, `plainCitation`, `noteIndex`), `citationItems[]` with `id`, `uris`, `itemData` (full CSL-JSON of the item), `locator`, `label`, `prefix`, `suffix`, `suppress-author`.
- The bibliography is a field `ADDIN ZOTERO_BIBL {…} CSL_BIBLIOGRAPHY`.
- Document preferences (style id, locale, field type) are XML stored in `docProps/custom.xml` as `ZOTERO_PREF_1`, `ZOTERO_PREF_2`, … (split for length). In ODT, citations are reference marks and prefs are in `meta.xml`.
- On refresh, Zotero resolves each item via its `uris`. If no library item matches but `itemData` is present, Zotero creates an **embedded item** from `itemData` and keeps working without prompting. Only if both are missing does it ask the user to reselect or throw `MissingItemException`.
- If the visible field text differs from what Zotero would produce, Zotero asks whether to keep the manual edit ([plugin usage](https://www.zotero.org/support/word_processor_plugin_usage), updated 2026-05-14). The Better BibTeX docs for the [zotero.lua Pandoc filter](https://retorque.re/zotero-better-bibtex/exporting/pandoc/) warn about one confirmation popup per citation unless the user opens Document Preferences and clicks OK before the first refresh.

**Can a third-party app write citations that the Zotero plugin later recognizes and refreshes?** Yes, with caveats (inference from the verified code): write `ADDIN ZOTERO_ITEM CSL_CITATION` fields with full `itemData`, a valid `ZOTERO_PREF` document property, and `plainCitation` equal to the visible text. Zotero will then treat the items as embedded (orphaned) items: they render and refresh with the chosen style, but metadata cannot be edited from Zotero and they show no "Open in My Library". This is a proven pattern: zotero.lua does it for Pandoc output. It ties citegeist's Word story to Zotero being installed, which conflicts with replacing Zotero.

### 2.2 Recent Zotero features that overlap with citegeist (verified)

- Zotero 8 (January 2026), Zotero 9 ([2026-04-10](https://www.zotero.org/blog/zotero-9/)), Zotero 10 ([2026-08-17](https://www.zotero.org/blog/zotero-10/)).
- Zotero 9 added an **Add Annotation** button in the word processor plugins: insert one or more annotations with live citations and the user's comments, with no intermediate note. Neither the blog nor the [forum announcement](https://forums.zotero.org/discussion/comment/510759/) says how page locators are filled; I assume from the annotation's page label (unverified).
- Annotations added to Zotero notes carry links to the PDF page and live citations ([PDF reader docs](https://www.zotero.org/support/pdf_reader), updated 2026-05-05).
- None of these posts mention AI features.

So the plain "highlight, then insert with page citation" loop is already solved in Zotero. citegeist's differentiation has to come from the card model (verbatim vs. own wording vs. AI note, core statement, verification), German-aware rendering and the AI layer.

### 2.3 Page labels (verified, forum level)

Zotero reads page labels from the PDF or detects them from page text, then falls back to the page index ([forum](https://forums.zotero.org/discussion/comment/449567)). Users report wrong labels for two-up scans and misdetected numbers (DOIs, letters) ([forum 2025-03-07](https://forums.zotero.org/discussion/comment/487243)). "Edit Page Number" exists for annotations and can apply to later pages, with reported gaps. Citavi says: "correct the page number for the first quotation you save", after which it applies the corrected numbering to later quotations from the same PDF ([Citavi 7 troubleshooting](https://www1.citavi.com/sub/manual7/en/solutions_annotations.html)). Inference: page confirmation with offset propagation is a must-have, and it should be stored per attachment, not per card.

### 2.4 Options with rough effort

Effort is an estimate for one experienced developer and is my inference.

| Option | How it works | Pros | Cons | Effort |
|---|---|---|---|---|
| A. Rich-text clipboard | citegeist renders quote + citation with a CSL processor (citeproc-js) and writes `public.html`, `public.rtf` and plain text to NSPasteboard | Works in Word (Mac/Win), Google Docs, Pages, Notion. No plugin. | Static text, no bibliography sync, no "ebd." in footnote styles, style change requires re-pasting | 2 to 4 days (citeproc-js integration is most of it) |
| B. Pandoc Markdown | Copy `„…“ [@key, S. 33]` or `[vgl. @key, 33]`; export CSL-JSON of all cited items | Fully live via Pandoc, docx output possible, footnote styles correct | User must write in Markdown or convert | 1 to 2 days |
| C. Zotero-compatible docx fields | citegeist writes `ADDIN ZOTERO_ITEM CSL_CITATION` fields with `itemData` (own docx writer or Pandoc + zotero.lua-like filter) | Live, refreshable, bibliography in Word, footnote styles | Requires Zotero installed; items become orphaned embedded items; exact `plainCitation` matching needed | 1 to 2 weeks |
| D. Zotero RTF/ODF Scan markers | Copy `{vgl. \| Müller, (2020) \| S. 33 \| \| zu:0:ITEMKEY}` | Simple text | Needs items **in the Zotero library** with known keys. ODF Scan was incompatible with Zotero 7 until a Zotero 7/8 release on 2026-01-14; ODF Scan 3.0 (2026-01-31) added docx and Pandoc-style conversion; users reported docx bugs fixed in 3.2.0 ([forum](https://forums.zotero.org/discussion/comment/499759)). Built-in RTF Scan does not produce live citations. | 1 to 2 days, but only useful if Zotero stays the library |
| E. Own Word add-in (Office.js) | Task pane add-in that inserts citations and quote cards, stores data in Addin fields or content controls, refreshes via citeproc-js | Full control, works on Word for Mac. Office.js `Range.insertField` (WordApi 1.5) supports the `Addin` field type on Windows and Mac; Word on the web treats fields as mostly read-only ([Range API](https://learn.microsoft.com/en-us/javascript/api/word/word.range?view=word-js-preview), [fields guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/word/fields-guidance), 2026-05-21) | Large surface: refresh, footnotes, bibliography, document prefs, hosting add-in assets, local API to citegeist. Unverified whether Office.js can write an Addin field code byte-identical to Zotero's | 6 to 10 weeks for a usable v1 |
| F. Google Docs add-on | Apps Script sidebar, citations as links plus named ranges (Zotero and Paperpile pattern) | Collaboration | Separate stack, Google OAuth verification, no offline | 4 to 8 weeks |

Reference points:

- **Citavi**: Desktop Word add-in on Windows. Citations in .docx are content controls tagged `CitaviPlaceholder#<uuid>` with base64 proprietary JSON including `PageRange` (start, end, numbering type), `Prefix`, `Suffix` ([fiduswriter notes](https://raw.githubusercontent.com/fiduswriter/biblatex-csl-converter/HEAD/CITATIONS_IN_DOCS.md)). For Citavi Web there is "Citavi Assistant", an Office add-in that requires Office for Mac 365 on Mac, or Windows 10 1903+ with Office 2019/365 ([Citavi Web manual](https://www1.citavi.com/sub/manual-citaviweb/en/installing_citavi_assistant.html), page dated 2021-05-04). This shows the Office.js route is viable on Mac.
- **Paperpile**: a free Google Docs sidebar add-on that co-authors can use without a subscription, with page or chapter numbers in the citation dialog ([Paperpile Google Docs](https://paperpile.com/features/google-docs-citations-bibliography/)). A Word plugin marked "Beta" has downloads for Windows and macOS ([Paperpile Word](https://paperpile.com/word-plugin/)). Storage format unverified.

Recommendation (inference): ship A and B in v1, keep C as an optional interop exporter later, defer E until the card model has proven itself. D is not worth it unless Jonny keeps Zotero as the library of record.

## 3. Citavi knowledge items in detail

Verified in the Citavi 7 manual ([quotations](https://www1.citavi.com/sub/manual7/en/quoting_a_text_passage.html), [direct](https://www1.citavi.com/sub/manual7/en/using_direct_quotations.html), [indirect](https://www1.citavi.com/sub/manual7/en/using_indirect_quotations.html), [red highlighter](https://www1.citavi.com/sub/manual7/en/highlighting_with_red_highlighters.html), [thoughts](https://www1.citavi.com/sub/manual7/en/adding_thoughts.html), [page ranges](https://www1.citavi.com/sub/manual7/en/no_suffixes_in_the_page_range_field.html), [secondary quotations](https://www1.citavi.com/sub/manual7/en/adding_secondary_quotations.html), [insert with options](https://www1.citavi.com/sub/manual7/en/inserting_knowledge_items_with_options.html), [Word add-in](https://www1.citavi.com/sub/manual7/en/wai_inserting_knowledge_items.html), [ordering](https://www1.citavi.com/sub/manual7/en/organizing_quotations_and_thoughts_manually.html), [categories into Word](https://www1.citavi.com/sub/manual7/en/inserting_categories_and_quotations.html), [AI key findings](https://www1.citavi.com/sub/manual7/en/ai_key_findings.html), [what's new](https://www1.citavi.com/sub/manual7/en/new_in_citavi_7.html)):

**Types** (each is linked to a reference, except thoughts):

| Type | Meaning | PDF highlight |
|---|---|---|
| Direct quotation | exact wording | blue; core statement auto-filled from the first words |
| Indirect quotation | paraphrase in own words, typed into the Text box; original terms must be in quotation marks | purple |
| Summary | condenses a chapter or section (whole works go into Abstract) | green |
| Comment | own thoughts on the author's statement; can be attached to an existing quotation | orange |
| Image quotation | snapshot region with caption (for publication) and description (private) | snapshot tool |
| File quotation | film or music, page range type "Other" for time spans | |
| Red highlight | creates an item that only contains a core statement, a placeholder for "decide later" | red |
| Yellow highlight | plain highlight | yellow |
| Thought | own idea with core statement, text, keywords, categories; can be placed in the knowledge organizer next to quotations | |

**Fields**: core statement (short title-like summary; if empty, Citavi uses the first words), text, page range with a numbering type (pages, columns, section numbers, margin numbers, other), keywords, categories, groups, modified (initials and date).

**Page handling**: page numbers come from PDF metadata if present; Citavi also infers from the reference's page range or other knowledge items from the same PDF. The manual says never to type "f." or "ff.": "always give the entire page range, e.g. 40-41", and the citation style abbreviates. Typing "f." makes Citavi stop treating it as page data.

**Secondary quotations**: stored on the cited (unavailable) work with an "as cited by" note naming the other work, plus a task "Verify bibliographic information and quotation". On insertion the secondary reference also goes into the bibliography. There is no dedicated structured link.

**Knowledge organizer**: categories form the outline of the paper. Items are ordered within categories with arrows; uncategorized thoughts sort alphabetically. "Insert categories and knowledge items > All Categories" with "Include knowledge items" sends the outline with quotations to Word.

**Insertion into Word**: double-click inserts the item with its citation; "Insert advanced" offers four variants: core statement + knowledge item + citation, text + citation, core statement + citation, citation only. For footnote styles the text goes into the body and the citation into a new footnote. The inserted text is **not linked** afterwards; edits on either side do not propagate.

**AI in Citavi 7**: "AI key findings" writes generated key findings into the reference's Evaluation field after accepting Lumivero AI terms. The manual page does not say that the output is labeled as AI. Lumivero's [product page](https://lumivero.com/products/citavi/) advertises "AI passage summaries" ("Summarize any paragraph or section with a single click"), and the what's-new page lists "Summarize texts in references and save them as knowledge items". I found no documentation on whether such summaries are flagged as AI in the knowledge item (unverified).

Takeaways for citegeist (inference):

- Keep Citavi's separation of verbatim text, own paraphrase, comment and core statement. It maps directly to German citation practice.
- Fix Citavi's gaps: AI output gets its own field with provenance, a verification state, and a link from the inserted text back to the card (Citavi loses it).
- Store full page ranges and numbering type; render f./ff. per style.

## 4. German academic conventions

Verified in the Leipzig communication studies guide based on APA 7 and DGPs ([IfKMW Leitfaden](https://sozphil.uni-leipzig.de/fileadmin/Fakult%C3%A4t_SozPhil/Institut_KMW/Dokumente/01_Studium/Pr%C3%BCfungsordnung_und_Studienorganisation/Leitfaden_zu_Zitation_und_Literaturverzeichnis_IfKMW.pdf), file dated 2024-03-04):

- Direct quotes: exact wording including errors and emphasis. Omissions are marked "[…]". Emphasis is labeled "Hervorhebung im Original" or the author's own emphasis is marked as such. Under 40 words inline, from 40 words a block quote.
- Indirect quotes: no quotation marks, usually Konjunktiv or "laut XY (1998)". Under APA/DGPuK **without "vgl."**: "(Pürer & Raabe, 2007, S. 81)". Some German guidelines use "(vgl. Pürer & Raabe, 2007, S. 81)". Exact pages are required for a defined passage.
- Secondary quotes: "(Müsse, 1995, S. 24; zitiert nach Pürer & Raabe, 2007, S. 81)", and both works go into the reference list.
- "ebd." is not used in APA; repeat the full citation instead.

Verified from biblatex and Citavi (sections 1.4 and 3): "f." means the page plus the next one, "ff." the following pages. Both tools prefer storing the true range and rendering f./ff.

From general knowledge (not re-verified this session): footnote-based "Deutsche Zitierweise" (common in history, law, parts of social science) uses full note at first mention, short form later, "Ebd." for immediate repeats and "Vgl." for indirect references. Harvard in German usually writes "(vgl. Müller 2020: 33)" or "(vgl. Müller 2020, S. 33)", varying by institute.

What CSL covers (inference from 1.1): page labels "S.", "ebd." via ibid position in note styles, German quotation marks, "u. a.". What CSL does not cover: automatic "vgl." for indirect quotes (it must be a prefix the tool adds depending on the card type and the chosen convention), automatic f./ff., structured "zit. n.". CSL style availability for specific German institutes was not checked this session (unverified); Typst ships a `deutsche-sprache` style.

Design consequence: the card stores `kind = direct | indirect | summary` and the export layer adds "vgl." only if the active convention says so (APA/DGPs: no, Harvard-German/footnote: yes). Direct quotes get „…“ from the locale; nested quotes inside the original become ‚…‘.

## 5. Academic integrity

### 5.1 Verified policies

- **University of Vienna** ([KI im Studium: Was ist erlaubt?](https://studieren.univie.ac.at/studieren-und-lernen/ki-im-studium/ki-im-studium-was-ist-erlaubt), [KI und Prüfungen](https://studieren.univie.ac.at/studieren-und-lernen/ki-im-studium/ki-und-pruefungen), [KI zitieren und kennzeichnen](https://studieren.univie.ac.at/studieren-und-lernen/ki-im-studium/ki-zitieren-und-kennzeichnen), [Eigenständigkeit wahren](https://studieren.univie.ac.at/studieren-und-lernen/ki-im-studium/ki-und-wissenschaftliches-arbeiten/eigenstaendigkeit-wahren), [Checkliste](https://studieren.univie.ac.at/studieren-und-lernen/ki-im-studium/ki-und-wissenschaftliches-arbeiten/checkliste-fuer-den-verantwortungsvollen-umgang-mit-ki); pages undated, fetched 2026-10-23):
  - "Im Zweifel gilt: KI ist nicht erlaubt, solange keine klare Erlaubnis vorliegt." Examiners decide; what u:find does not explicitly allow counts as forbidden.
  - "Die Nutzung nicht erlaubter KI-Tools gilt als wissenschaftliches Fehlverhalten." Consequences range up to exclusion from studies for up to two semesters in severe cases.
  - Allowed use must be disclosed fully. Verbatim or lightly edited AI text requires tool, model, year and the prompt. Collaborative use can be documented in a table or a one-time note, e.g. in the introduction; scope for qualification theses is agreed with the supervisor.
  - Checklist: "Verlassen Sie sich nicht auf KI-generierte Zusammenfassungen", "überprüfen Sie alle" AI content, document tools including version.
  - Taking AI text without substantial revision "gilt … nicht als eigenständige wissenschaftliche Leistung".
- **ÖAWI guideline 2026** ([Richtlinie](https://oeawi.at/wp-content/uploads/2026/07/OAWI-Richtlinie-2026.pdf), adopted 2026-06-18): 3.1 g: responsibility for AI-assisted steps stays with the user. 3.1 h: researchers disclose aids including AI per disciplinary standards. 4.1 b: plagiarism includes the "direkte, paraphrasierte oder übersetzte Übernehmen" without citation. 4.1 e: use of AI contrary to disciplinary standards is a violation.
- **ALLEA European Code of Conduct, revised 2023** ([PDF](https://allea.org/wp-content/uploads/2023/06/European-Code-of-Conduct-Revised-Edition-2023.pdf)): "Hiding the use of AI or automated tools in the creation of content or drafting of publications" is listed as an unacceptable practice.
- **DFG** ([Stellungnahme, Sept 2023](https://www.dfg.de/resource/blob/289674/ff57cf46c5ca109cb18533b21fba49bd/230921-stellungnahme-praesidium-ki-ai-data.pdf); revised by the Hauptausschuss in December 2025): researchers should disclose which generative models they used, for what purpose and to what extent; using them does not release them from responsibility; authors must ensure no plagiarism arises.
- **German universities overall** ([HFD Blickpunkt KI-Leitlinien 2026](https://hochschulforumdigitalisierung.de/wp-content/uploads/2026/05/Blickpunkt_KI-Leitlinien2026.pdf), 2026-05-19, 30 guidelines analyzed): concrete permissions and labeling duties are mostly delegated to individual lecturers or exam boards; labeling ranges "von Minimalangaben bis hin zu umfangreichen KI-Verzeichnissen mit Prompts und Outputs". CAU Kiel: "Die unerlaubte Nutzung generativer KI ist als ein Täuschungsversuch zu bewerten."
- **Unverified**: specific rules of the Uni Wien doctoral programs, other Austrian universities (Graz, Innsbruck, WU, TU Wien) and German universities' Eigenständigkeitserklärung templates. The plagiarism definitions in the Austrian Universitätsgesetz were restructured by BGBl. I Nr. 50/2024; I did not locate the current paragraph.

### 5.2 Implications for an auto-paraphrasing highlighter (inference)

1. An AI paraphrase that ends up in a thesis is AI-generated text about a source. It needs the source citation (otherwise plagiarism per ÖAWI 4.1 b) **and** AI disclosure (Uni Wien, ÖAWI 3.1 h, ALLEA). If it stays close to the original's structure, it can read as disguised copying even with a citation.
2. A summary that the student relies on without reading the original contradicts the Uni Wien checklist. The feature must push toward checking the source.
3. In Vienna the default is "not allowed unless permitted". The product must work fully with AI switched off, and AI output must never flow into exports silently.

### 5.3 Design that keeps the user on the safe side

- **Verbatim text is sacred**: stored exactly as extracted from the PDF text layer, with a hash. Any normalization (hyphenation, line breaks) is recorded as an edit; omissions "[…]" and insertions "[sic]" are explicit edits in the quote card, visible in a diff against the extracted text.
- **AI paraphrase is a comprehension note**, labeled as such in the UI ("KI-Notiz zum Verständnis"), stored in its own field with model, provider, prompt version and timestamp. Default export **excludes** it.
- **Own paraphrase field** for the user's wording. Export of an indirect quote uses only this field. If it is empty, export offers the verbatim quote or nothing.
- **Similarity guard**: if the own paraphrase is lexically too close to the verbatim text or to the AI note (n-gram overlap), show a warning. Threshold is a guess and needs tuning.
- **Provenance flag** on every text field: `human`, `ai`, `ai_edited_by_human`. An optional "AI usage log" export lists which cards had AI involvement, in a format usable for a KI-Verzeichnis.
- **Verification status** per card: `unverified` until the user has confirmed the page and looked at the passage; export of unverified cards shows a marker.
- **Per-project AI policy switch**: "AI allowed / comprehension only / off", set when creating a project for a course or thesis.

## 6. Data model: the quote card

Field names are proposals. Types are informal.

```text
QuoteCard
  id                     uuid
  item_id                -> Item (CSL-JSON record, has citation_key)
  attachment_id          -> Attachment (PDF/EPUB/web snapshot), nullable for manual cards
  kind                   direct | indirect | summary | comment | image | thought
  language               BCP 47 of the source passage, e.g. "de", "en"

  # text layers, each with provenance
  verbatim_text          exact extracted text (immutable original)
  verbatim_hash          sha256 of the original extraction
  quote_text             verbatim with user edits ([…], [sic], [Hervorh. d. Verf.])
  quote_edits            list of {type: omission|insertion|emphasis|normalize, range, note}
  own_paraphrase         user's wording, provenance human | ai_edited_by_human
  ai_note                model's comprehension paraphrase
  core_statement         short claim (Kernaussage), provenance human | ai
  comment                user's own thoughts

  # locator
  locator_label          CSL label enum, default "page"
  page_label_start       string as printed, e.g. "233", "xii"
  page_label_end         string, nullable
  pdf_page_index_start   0-based int
  pdf_page_index_end     0-based int
  page_confirmed         bool (user checked the label/offset)

  # anchors (W3C Web Annotation style)
  anchor.text_quote      {exact, prefix, suffix}
  anchor.text_position   {start, end} in the extracted text of the page
  anchor.pdf_rects       [{page_index, rects:[[x1,y1,x2,y2],...]}]
  anchor.epub_cfi        for EPUB, nullable

  # organization
  tags                   [string]
  category_ids           [-> Category]   (outline nodes, ordered)
  sort_key               position within category

  # citation hints
  secondary_via          {item_id, locator} nullable  (zit. n. / quoted in)
  citation_prefix        nullable, overrides convention (e.g. "vgl.", "siehe")
  citation_suffix        nullable

  # provenance and trust
  created_by             human | agent
  ai_provenance          [{field, model, provider, prompt_version, created_at}]
  verification           unverified | page_checked | text_checked
  created_at, updated_at
```

Per attachment, store `page_label_map`: PDF page labels read from the file, the detected printed numbers, and a user override as `{from_index, first_label, numbering: arabic|roman}` ranges. Cards derive `page_label_*` from it, and a correction re-labels all cards of that attachment.

Notes:

- The Zotero annotation model (`annotationPageLabel`, `annotationPosition` = `{"pageIndex": 8, "rects": [[…]]}`, sort index) is a close precedent ([forum example](https://forums.zotero.org/discussion/comment/458049)). Storing both page index and label avoids the off-by-offset bugs reported in Zotero.
- W3C Web Annotation selectors (TextQuote, TextPosition) are the standard way to re-anchor text if the PDF changes. I did not re-fetch the W3C spec this session.

### 6.1 Export formats (per card, and per selection of cards)

| Target | Direct quote | Indirect quote |
|---|---|---|
| Pandoc Markdown | `„Wirklichkeitsentwürfe der Medien sind […] das Ergebnis“ [@puerer2007, 81].` | `[vgl. @puerer2007, 81]` or `[@puerer2007, 81]` depending on convention |
| CSL-JSON bundle | `items.json` with all cited items, plus `citations.json` with CSL citation objects (`id`, `locator`, `label`, `prefix`) per card | same |
| BibTeX/BibLaTeX | `.bib` from items; LaTeX snippet `\enquote{…} \parencite[81]{puerer2007}` | `\parencite[vgl.][81--82]{puerer2007}` (with `citepagerange=2sq` this prints "81 f.") |
| Typst | `„…“ @puerer2007[S. 81]` plus `.bib` | `vgl. @puerer2007[S. 81]` as text (no prefix support) |
| Rich text clipboard (Word, Google Docs, Pages) | HTML + RTF + plain: `„…“ (Pürer & Raabe, 2007, S. 81)` rendered by citeproc-js with the project style and locale | `(vgl. Pürer & Raabe, 2007, S. 81)` per convention |
| Zotero-compatible docx (later) | Field `ADDIN ZOTERO_ITEM CSL_CITATION {…itemData…}` | same with prefix |

Secondary quotes: render as two cites in one cluster, `[@muesse1995, 24; zitiert nach @puerer2007, 81]` in Pandoc, so both land in the bibliography.

## 7. Recommended end-to-end flow and minimal v1

### 7.1 Flow

1. **Import** the item with metadata (DOI lookup) into a CSL-JSON record and a stable citation key.
2. **Open the PDF**. On first highlight, citegeist shows the detected page label ("Seite 233?") and asks for confirmation once. The answer sets the attachment's label map.
3. **Highlight** creates a card with `kind = direct`, verbatim text, anchors, page label. The model then fills `ai_note` and suggests a `core_statement`, both marked as AI. If the project's AI policy is off, nothing is sent.
4. **Triage** while reading: keep as direct quote, write an own paraphrase (switch to indirect), add comment, assign an outline category. The AI note helps comprehension and is never the paraphrase itself.
5. **Write**: in the proposal, search cards by category or text and press one shortcut. citegeist copies the chosen form (direct quote with citation, own paraphrase with citation, citation only) as rich text, or as Pandoc text. The project's style and convention decide "vgl." and "S.".
6. **Finish**: export the CSL-JSON or .bib of all cited items for the bibliography (Pandoc, LaTeX, Typst), or render a bibliography as rich text for Word. Optionally export the AI usage log for the KI-Verzeichnis.

### 7.2 Minimal v1 (time saver in one real proposal session)

- PDF reader with highlight to card (verbatim text, page index, page label with one-time confirmation and offset).
- Card fields: verbatim, quote edits ("[…]"), own paraphrase, AI note (labeled, excluded from export by default), core statement, tags, one level of categories.
- Item metadata as CSL-JSON with citation keys; DOI import.
- citeproc-js rendering with APA 7 (de-DE) and one German footnote or Harvard style chosen by Jonny's target institute; a per-project convention switch for "vgl.".
- Copy actions: "Zitat + Beleg" as rich text, "Beleg" only, Pandoc form; export CSL-JSON and .bib.
- Verification state and a list "cards cited but not verified".

Out of v1: Word add-in, Zotero field export, Google Docs add-on, footnote-correct "ebd." outside Pandoc and LaTeX, image quotes, Typst-specific handling beyond text.

Expected effect (inference, untested): the main saving is that page and author-year never have to be looked up again. A falsifier for the v1: if in a real proposal session Jonny still opens the PDF to check pages for more than a small share of pasted cards, the page-label confirmation is not reliable enough and has to be fixed before any AI work.

## 8. Open questions and unverified points

- Target institute and its citation style (APA/DGPs vs. footnotes) decide the default convention. Unknown.
- Uni Wien doctoral-program specific AI rules, and rules at other Austrian or German universities: not verified.
- Whether Zotero 9's Add Annotation fills the page locator from the annotation's page label: not verified.
- Whether Office.js can write an Addin field whose code is exactly `ADDIN ZOTERO_ITEM CSL_CITATION …`: not verified; needs a spike if option E plus Zotero compatibility is ever wanted.
- Pandoc's parsing of "S. 33" under `lang: de-DE`: inferred from source, not tested.
- Whether Citavi 7 flags AI passage summaries as AI in the knowledge item: not documented in the pages I read.
- CSL styles for specific German or Austrian institutes: not checked.

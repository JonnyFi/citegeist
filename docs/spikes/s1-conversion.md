# Spike S1: PDF conversion

Run date: 2026-10-23. Machine: Apple Silicon Mac (arm64), macOS 26, Python 3.12.13, uv 0.11.19. Code: `spikes/s1/` (throwaway). Corpus: `fixtures/pdf/` (permanent, 15 PDFs, not committed, fetched by `node fixtures/pdf/fetch.mjs`).

## Result

The assumption in `architecture.md` ("Docling und GROBID liefern Blöcke mit richtiger Seite und Lesereihenfolge") holds for born-digital PDFs. All four criteria of the two relevant rows in the risk table pass. The fallback (Marker or a VLM path) is not needed for digital PDFs. It is needed for scans that are not set in a plain printed typeface: Apple Vision reads the calligraphic scan with roughly 8 percent character error and cannot read Fraktur or Kurrent at all.

| Criterion (risk table) | Threshold | Result | Verdict |
|---|---|---|---|
| Blocks on the correct page (text search in the PDF via pypdf) | at least 95 % | 100 % (2,472 verified blocks, 0 wrong, 13 not verifiable) on the 13 digital PDFs | pass |
| Reading order correct (first 30 blocks inspected by hand) | 13 of 15 PDFs | 14 of 15 (the handwritten negative control fails) | pass |
| Speed | under 60 s for 20 pages | 0.06 to 0.72 s per page, so 1.3 to 14.3 s for 20 pages; cold start 3 s with cached models | pass |
| Printed page labels | at least 90 % of journal articles | 6 of 6 journal articles, 12 of 12 PDFs with a gold label, 280 of 280 pages, 0 wrong labels with confidence of 0.5 or more | pass |

Caveats that limit how far these numbers carry:

- The page check reads the same text layer through a second library. It proves that Docling puts blocks on the right page, not that the text is right.
- Reading order is judged from the first 30 blocks of every document, which covers one to three pages. An automated column heuristic in `evaluate.py` flags many pages, but it mixes up sidebars, footnotes and floating figures, so it was not used for the verdict.
- The label rules were adjusted while looking at these 15 PDFs (the Crossref agreement requirement, the duplicate check and the quality gate). The 100 % is therefore a development score. The next test needs PDFs that none of the rules have seen.
- The spike measured only the criteria in the risk table. The criteria of `document-conversion.md` section 9.3 that need hand-labelled gold sets (quote round trip, re-anchoring, block ID survival, table structure, equation LaTeX, OCR error rate on a clean scan) were not run.

## Setup

```
cd spikes/s1
uv sync                                   # Python 3.12, docling 2.142.1, ocrmac 1.0.1, pypdf 6.21.2, torch 2.14.1
node ../../fixtures/pdf/fetch.mjs         # downloads and verifies the 15 PDFs
docker run --rm -d --name grobid-s1 -p 8070:8070 --init lfoppiano/grobid:0.9.1-crf
uv run python convert.py                  # Docling on all fixtures -> out/<id>/blocks.jsonl, docling.json, convert_meta.json
uv run python labels.py                   # out/<id>/pages.json, fills `label` in blocks.jsonl
uv run python grobid_run.py               # out/<id>/grobid/*.tei.xml, out/_summary/grobid_summary.json
uv run python evaluate.py                 # out/results.json and a markdown table
uv run python quality.py                  # dictionary hit rate per document (NSSpellChecker)
```

Extra runs: `convert.py --formulas` (formula enrichment, Mamba only), `convert.py --ocr` (forced Apple Vision OCR over the Fraktur scan with a text layer), `vision_raw.py` (Apple Vision without Docling, on the Urkunde scan), `ocr_modes.py` (Docling OCR modes), `measure_rss.sh` (peak memory).

Pipeline configuration:

- Digital PDFs: `PdfPipelineOptions(do_ocr=False, do_table_structure=True)`, layout model docling-layout-heron, TableFormer. Layout and tables run on the MPS device (`device='auto'`).
- Scans: `OcrMacOptions(lang=["de-DE","en-US"], recognition="accurate", framework="vision", mode=OcrMode.FULL_PAGE)`. Apple Vision came through ocrmac, so OCRmyPDF was not needed and was not installed.
- GROBID: image `lfoppiano/grobid:0.9.1-crf`, native arm64 (`docker image inspect` reports arm64). Calls: `processHeaderDocument` and `processReferences`, no consolidation.
- Block schema: one JSON object per line with `id, type, flow, page` (zero-based), `label` (printed page), `bbox` ([x0, y0, x1, y1] in PDF points, origin bottom left), `text`, plus `spans` (one entry per page or column the block covers) and `src` as in `architecture.md`. Block IDs are a hash of page, bbox and text start, which is enough for the spike and not the persistent ID scheme of the architecture.

## Per-PDF results

Digital pipeline unless marked. "Page ok" is the share of verifiable text blocks whose first 24 or last 24 normalised characters occur on their page in the pypdf text of that page. "Labels" is the final label source, correct pages against the gold label (`firstPrintedPage + index` from the manifest) and the confidence reported in `pages.json`.

| Fixture | Pages | s/page | Blocks | Page ok | Reading order | Labels (source, correct, confidence) |
|---|---|---|---|---|---|---|
| tacl-natural-questions-2019 | 14 | 0.16 | 217 | 176/176 | ok, two columns, footnotes at column ends | catalog, 14/14, 0.97 |
| plos-one-reference-rot-2014 | 39 | 0.15 | 483 | 273/273 | ok, sidebar first | catalog, 39/39, 0.70 (plain 1..n, only weakly confirmed) |
| arxiv-2312.00752-mamba | 36 | 0.23 | 598 | 451/451 | ok | detected, 36/36, 0.95 |
| arxiv-2310.06825-mistral-7b | 9 | 0.22 | 111 | 80/80 | ok, table beside text | detected, 9/9, 0.95 |
| arxiv-2408.09869-docling-report | 9 | 0.18 | 111 | 73/73 | ok | detected, 9/9, 0.95 |
| lsp-ledgeway-dative-marking-2020 | 34 | 0.06 | 367 | 220/220 (8 not verifiable) | ok, author block split into several blocks | detected, 34/34, 0.95 |
| cup-bruce-vinuales-sdg7-2020 | 23 | 0.07 | 285 | 187/187 (1) | ok, footnotes typed as list items | catalog, 23/23, 0.97 |
| merz-bne-2021 | 8 | 0.08 | 91 | 73/73 | ok, two columns with a quote across them | detected, 8/8, 0.97 |
| rki-johm-kiggs-2019 | 25 | 0.41 | 373 | 205/205 | ok, sidebar before main column | catalog, 25/25, 0.95 |
| gvbl-berlin-2013-18 | 20 | 0.66 | 459 | 172/172 | ok, but the table of contents has empty text and crop marks become figure blocks | catalog, 20/20, 0.95 |
| nist-ai-rmf-1.0 | 48 | 0.14 | 442 | 254/254 (2) | ok | no gold label; catalog labels start `1, 1, i, i, ii, 1`, flagged as duplicates with page confidence 0.3 |
| birkmeyer-editio-princeps-1899 (Fraktur, embedded OCR layer) | 58 | 0.07 | 487 | 283/283 (2) | ok | detected, 58/58, 0.48 (OCR garbles some page numbers, so the user confirms once) |
| nomos-huntington-review-1970 | 5 | 0.13 | 53 | 25/25 | ok, a list of other reviews sits at the top of the right column | detected, 5/5, 0.97 (Crossref range agrees) |
| scan-ochtendung-urkunde-1958 (OCR) | 1 | 0.85 | 5 | n/a, no text layer | ok, three columns come out as one block with three spans in the right order | none, fallback label with confidence 0.10 |
| scan-boehmer-palatinat-1739 (OCR) | 14 | 0.72 | 59 | n/a | fails, the output is noise | none usable, see gotchas |

Totals over the 13 digital PDFs: 328 pages, 59 s, 0.18 s per page on average, 0.06 to 0.66 s per page. Peak memory: 1.7 GB (48 pages), 1.5 GB for the OCR run, 2.2 GB with formula enrichment.

### GROBID (header and references, digital PDFs only)

Header call about 1.05 s, reference call 1.1 to 2.3 s per PDF (the first call after container start took 6.9 s). The share of reference entries that carry a DOI or a title plus year is a structural measure, not a comparison against a gold list.

| Fixture | Header title | Authors | DOI in header | References with DOI or title and year |
|---|---|---|---|---|
| tacl | exact | 18 | truncated to `10.1162/tacl` | 26/26 |
| plos | exact | 7 | correct | 44/54 |
| mamba | exact | 2 | none | 103/116 |
| mistral | exact | 19 | none | 29/29 |
| docling-report | empty | 19 | none | 13/16 |
| dative | 0.94 similar | 3 | correct (Zenodo book DOI) | 83/88 |
| sdg7 | 0.97 similar (chapter number dropped) | 2 | correct | 21/26 |
| merz | empty | 0 | none | 11/13 |
| rki | 0.72 similar (subtitle dash differs) | 13 | correct | 82/83 |
| gvbl | wrong (masthead) | 0 | none | 1/4 |
| nist | 0.91 similar | 2 | correct | 1/1 |
| birkmeyer | empty | 0 | none | 0/5 |
| nomos | empty | 0 | correct | no reference section (HTTP 204) |

Over the nine PDFs that have a real reference list (tacl, plos, mamba, mistral, docling-report, dative, sdg7, merz, rki), 412 of 451 entries (91 %) have a DOI or title plus year. Header titles are usable on 8 of 13 PDFs and empty or wrong on 5, which matches the architecture's rule that GROBID header data is only accepted after a match against Crossref or arXiv.

### Printed page labels by source

| Source | What it did on this corpus |
|---|---|
| `/PageLabels` (catalog) | Present in 6 of 15 PDFs: tacl, plos, sdg7, rki, gvbl, nist. Correct and non-trivial in tacl, sdg7, rki and gvbl. plos has the plain sequence 1..n, which equals the footer "1 / 39". nist has duplicates in the front matter. The sdg7 chapter encodes one range per page with a prefix and no style, and pypdf returns the prefix alone, which is right. |
| Header and footer number runs | Found the right offset in all 12 gold PDFs, including the chapter that has no number on its opening page (dative) and the OCR text layer with garbled numbers (birkmeyer, 23 of 58 pages carried a usable candidate). Voting on `value - index` with at least 30 % of the pages as support is enough. Roman numerals were not implemented. |
| Crossref range offset | Usable for tacl, sdg7, merz and nomos, where the range length equals the page count. It refuses plos (`e115253`). For dative it is wrong: the range covers 33 pages, the PDF has 34 (a trailing page), and the assumed leading cover page shifts every label by one. The rule only holds together with agreement from detected numbers on several pages. |

## Recommended pipeline

1. **Triage.** Hash the file, read `/PageLabels` with pypdf, extract the text layer, and compute a quality score. The score is the share of word tokens that `NSSpellChecker` accepts for the document language (`quality.py`). It separated the two scans (0.50 and 0.22) from every digital PDF (0.79 to 0.997). A threshold of 0.6 is enough for the corpus. Do not use Apple Vision's confidence, because it reports 1.0 for every line, including the Kurrent noise.
2. **Digital path.** Docling with OCR off and TableFormer on for layout and blocks, include the `FURNITURE` content layer so that headers and footers are available for label detection. Run GROBID CRF for header and references only. Take DOI, year and type from Crossref or arXiv whenever an identifier exists in the text.
3. **Page labels.** Catalog if it is non-trivial and free of duplicates, else detected number runs, else the Crossref offset, with these rules from the spike: a catalog that is plain 1..n or has duplicates yields to a detected run that disagrees; Crossref is only accepted if the range length matches the page count and detected numbers confirm it on at least three pages; labels carry a confidence and duplicates or low text quality cap it. Below about 0.5 the app asks the user once per PDF.
4. **Scans.** Docling with `OcrMacOptions` and `OcrMode.FULL_PAGE` recovers as much text as raw Apple Vision (2,843 against 2,899 characters on the Urkunde) at 0.7 to 0.85 s per page and puts all three columns into one block with spans in reading order. Use it for printed Latin-script scans. Pages whose quality score stays under 0.6 go to the VLM path or are marked unreadable. Never run OCR over an existing text layer of acceptable quality: on the Fraktur article forced OCR scored 0.46 against 0.88 for the embedded layer.
5. **Math.** Formula enrichment turns the 9 empty formula blocks of the Mamba paper into LaTeX but costs 8 s per page (CPU bound, 300 s for 36 pages), so run it only on pages that the layout model marks as containing formulas, or take the math from arXiv HTML where it exists. The enrichment merges side-by-side equations into one block.
6. **Fallbacks.** Marker or a VLM path (PaddleOCR-VL, MinerU) for pages below the quality threshold. Not exercised in this spike.

## Gotchas

- **Model downloads.** The first Docling run downloaded the layout model docling-layout-heron (328 MB on disk) and the docling-models bundle with TableFormer (683 MB). Formula enrichment adds CodeFormulaV2 (1.2 GB). With the models absent the first conversion of one page took 45 s, with cached models 3 s. Hugging Face warns about unauthenticated requests. The app needs a download step with sizes and pinned revisions, as described in `document-conversion.md` section 9.2.
- **Install size.** The uv environment is 1.4 GB (torch, docling, onnxruntime, rapidocr and others). The GROBID CRF image is 1.73 GB on disk.
- **Docker.** Docker Desktop was not running at the start and had to be launched before the image could be pulled. The `lfoppiano/grobid:0.9.1-crf` tag runs natively on arm64 without a platform flag. The shipping app should use a bundled JRE and the GROBID jar instead of Docker, which this spike did not test.
- **Furniture.** `iterate_items()` skips page headers and footers by default (202 against 217 items on the TACL paper). Pass `included_content_layers={BODY, FURNITURE}`, otherwise label detection has no input.
- **Coordinates.** Docling reports bounding boxes in PDF points with the origin at the bottom left (all 224 boxes of the TACL paper), which matches the architecture's convention. `convert.py` still converts defensively. All 4,141 blocks fall inside their page.
- **Text defects in Docling output.** Soft hyphens (U+00AD) remain in German text (234 in four documents) and need to be removed before search. Docling dropped a space in an author line that pypdf extracts correctly ("MaksymLysak"). Table of contents items (`document_index`) have empty text. Crop marks on the Berlin gazette become figure blocks. Footnotes are sometimes typed as list items. Small-caps headings come out in lower case.
- **Block order inside one OCR block.** The three-column Urkunde is one paragraph with three spans, so the flat `bbox` field only describes the first column. Consumers must use `spans`.
- **Quality signals.** Apple Vision returns confidence 1.0 for everything. Use the dictionary hit rate instead.
- **GROBID.** It cuts DOIs that contain an underscore (`10.1162/tacl_a_00276` became `10.1162/tacl`). Never accept its DOI without a Crossref check. It returned an empty title on four of 13 PDFs and cannot read scans, because Docling's ocrmac output is not a PDF. A text-layer PDF from OCRmyPDF would be needed to feed scans to GROBID. OCRmyPDF was not installed here, so that route is untested.
- **PyMuPDF 2.0** is installed in the spike for rendering pages. Its license changed with the merged layout code (see open uncertainties in `document-conversion.md`). The shipping pipeline should not depend on it.
- **Not covered.** arXiv HTML alignment, Marker, VLM re-OCR, OCRmyPDF, roman numeral detection, Gatekeeper behaviour of a runtime-installed Python, and any measurement of the highlight anchoring criteria.
- **OCR quality on the one clean-ish scan.** The Urkunde is a calligraphed certificate photographed with a phone. Against my own transcription of the first 316 letters the space-insensitive character error rate is about 8 percent, and word spaces are largely lost ("Ehreundverherlichung"), as is the long s (read as f). This is one sentence and one scan, so it is a spot value and says little about the 2 percent and 6 percent thresholds for clean and poor scans in section 9.3, which need a typeset scan.

# Document conversion for citegeist

Research date: 2026-10-23. Scope: how to turn PDFs, arXiv/web HTML, EPUB and scans into one representation that people read comfortably and agents query efficiently, with exact page provenance for citations.

Conventions in this document:
- **Verified** means I read it in a primary source (repo, official docs, API response) or measured it on this machine (Apple M4 Pro, 24 GB, macOS 26.2) on 2026-10-23.
- **Inference** means my reasoning from verified facts.
- **Unverified** means I could not confirm it. The session hit a shared web-search budget late in the work, so some gaps remain and are marked.

---

## 0. Summary and recommendation

1. **Canonical store:** a JSON block model (one block per line, JSONL) with stable block IDs, per-block page index, printed page label and PDF-space bounding boxes. Render **semantic HTML** (reading view) and **Markdown with page markers and block IDs** (agent view) from it. Never treat a converter's native output as canonical.
2. **The original file is the citation source of truth.** Page numbers come from the PDF, not from the reflowed view. arXiv HTML, EPUB and converter output are aligned *to* the PDF.
3. **Default local pipeline:** Docling (MIT) standard pipeline for born-digital PDFs, GROBID CRF (Apache-2.0, native macOS ARM) for header metadata and references, arXiv HTML when available, OCRmyPDF with an Apple Vision plugin (or Tesseract `deu`) to add a text layer to scans, and a small permissively licensed VLM (PaddleOCR-VL-1.6 or MinerU2.5-Pro, both Apache-2.0, about 1B parameters, MLX paths exist) only on pages the fast path flags.
4. **Highlights get two anchors:** a source anchor (PDF page index plus quads in PDF user space, file hash) and a text anchor (W3C TextQuoteSelector plus TextPositionSelector plus block hint), re-anchored with Hypothesis-style fuzzy matching. This mirrors what Zotero's new Structured Document Text and Reading Mode do.
5. **Prior art worth copying:** Zotero's [structured-document-text](https://github.com/zotero/structured-document-text) schema (2026) is almost exactly the representation citegeist needs, and MinerU 4.0's locator syntax is a good model for agent addressing.

---

## 1. Tool comparison

### 1.1 Benchmarks (numbers with dates)

**OmniDocBench v1.6** (README updated 2026-09-11; 1,651 pages; Overall = ((1 - text edit) x 100 + table TEDS + formula CDM) / 3). Verified from the [OmniDocBench README](https://github.com/opendatalab/OmniDocBench). Important caveat: text evaluation covers **only Chinese and English**, so it says nothing about German.

| Model | Size | Overall | Text edit (lower is better) | Formula CDM | Table TEDS | Reading-order edit |
|---|---|---|---|---|---|---|
| TeleOCR | 1.2B | 96.91 | 0.027 | 96.6 | 96.8 | 0.118 |
| OvisOCR2 | 0.8B | 96.47 | 0.027 | 97.5 | 94.6 | 0.112 |
| PaddleOCR-VL-1.6 | 0.9B | 96.34 | 0.033 | 97.5 | 94.8 | 0.128 |
| MinerU2.5-Pro | 1.2B | 95.75 | 0.036 | 97.5 | 93.4 | 0.120 |
| GLM-OCR | 0.9B | 95.22 | 0.044 | 97.2 | 92.8 | 0.133 |
| Gemini 3 Pro | n/a | 92.91 | 0.064 | 96.0 | 89.2 | 0.165 |
| dots.ocr | 3B | 90.77 | 0.048 | 90.0 | 87.2 | 0.138 |
| DeepSeek-OCR 2 | 3B | 90.25 | 0.050 | 91.8 | 83.9 | 0.144 |
| MinerU pipeline | n/a | 86.47 | 0.055 | 83.1 | 81.9 | 0.153 |
| olmOCR | 7B | 85.74 | 0.139 | 88.1 | 83.0 | 0.216 |
| Mistral OCR (2503) | n/a | 85.66 | 0.097 | 89.9 | 76.8 | 0.171 |
| Marker 1.8.2 | n/a | 78.44 | 0.157 | 85.2 | 65.8 | 0.243 |

Docling, Chandra, Nougat and PyMuPDF are not in the v1.5 or v1.6 tables. On v1.0 (January 2025), Docling 2.14.0 and Nougat scored poorly (Docling did no formula recognition then). Treat that as outdated.

**olmOCR-Bench** (1,403 PDFs, about 7,000 to 8,400 unit tests; macro average over 8 categories). Mostly self-reported by vendors:

| System | Overall | Source, date |
|---|---|---|
| Datalab API (hosted) | 86.7 | [Chandra README](https://github.com/datalab-to/chandra), 2026-03 |
| Chandra 2 (open weights) | 85.8 | same |
| Mistral OCR 4 | 85.2 | [Mistral](https://mistral.ai/news/ocr-4/), 2026-06-23, own reproduction |
| dots.ocr 1.5 / dots.mocr | 83.9 | dots.ocr repo |
| Chandra 1 | 83.1 | olmOCR README |
| olmOCR 2 (v0.4.0) | 82.4 | [olmOCR README](https://github.com/allenai/olmocr), 2025-10 |
| PaddleOCR-VL (v1) | 80.0 | olmOCR README |
| Marker 2.0 balanced (GPU) | 76.0 (83.5 born-digital only) | [Marker README](https://github.com/datalab-to/marker), 2026-07 |
| DeepSeek-OCR | 75.7 | olmOCR README |
| MinerU pipeline | 72.7 | Marker README (competitor run) |
| Marker 2.0 fast | 66.6 | Marker README |
| Docling (default pipeline) | 50.3 (64.0 born-digital) | Marker README, competitor run by a competitor, so treat with care |

Other 2026 benchmarks I found but did not read in full: PureDocBench ([arXiv 2605.07492](https://arxiv.org/abs/2605.07492): 58 models, best three-track average 79.69, real-capture conditions cost 11.6 points on average) and MORE ([arXiv 2607.02956](https://arxiv.org/abs/2607.02956), 149 languages, ICML 2026). Whether these include German results: unverified.

**German evidence:** Chandra's own multilingual benchmark lists German at 94.8% (Chandra 2), 93.8% (Datalab API), 88.3% (Gemini 2.5 Flash) ([Chandra README](https://github.com/datalab-to/chandra)). I found no independent German benchmark for Apple Vision, Tesseract or PaddleOCR-VL. **Unverified; the spike has to measure it.**

### 1.2 Tool matrix

Versions and licenses verified via GitHub API, PyPI and the Hugging Face API on 2026-10-23. "Download" means the compressed wheel set resolved with `uv pip compile` for macOS arm64 and Python 3.12 (models not included), plus model weights from the Hugging Face file listing.

| Tool | Version (date) | Code / weights license | Page + bbox provenance | Apple Silicon | Download | Fit for citegeist |
|---|---|---|---|---|---|---|
| **Docling** | 2.142.1 (2026-10-23), very active | MIT / Apache-2.0 (heron layout, granite-docling) | Yes: every item has `prov[]` with `page_no` (1-based), `bbox` (l,t,r,b + origin), `charspan`. Furniture layer for headers/footers. **No /PageLabels support** (none found in code). Item IDs are positional JSON pointers (`#/texts/57`), not stable | Layout on MPS; TableFormer **MPS disabled**; VLMs via MLX (granite-docling, MinerU2.5-Pro, Nanonets, Qwen). Third-party [docling-mlx](https://github.com/AtkinsChang/docling-mlx) (2026-09) measured 112 ms/page MLX vs 204 ms/page official on M4 Pro for layout+tables+figures | ~286 MB wheels; heron 0.17 GB, granite-docling 0.53 GB | **Best orchestrator and data model.** Plug-in VLM presets, EPUB/HTML/JATS input, MCP server |
| **Marker 2.0** (Datalab) | 2.0.0 (2026-07-20) | **Code now Apache-2.0** (was GPL); weights modified OpenRAIL-M, free under $5M revenue/funding | JSON tree with 4-point polygons per block, line and span blocks; `--paginate_output` | VLM (surya) served by llama.cpp on Mac; defaults to `fast` mode on MPS | ~227 MB wheels + surya-ocr-2 1.4 GB | Good, but best quality needs GPU; weights license has thresholds |
| **Chandra 2** (Datalab) | 0.2.0 (2026-03) | Apache-2.0 / modified OpenRAIL-M, free under $2M, "cannot be used competitively with our API" | HTML layout divs with `data-bbox` (0 to 1000 normalized) and `data-label` | HF transformers or vLLM; no official MLX build found | 10.6 GB weights (5.3B) | Top olmOCR-Bench, too heavy for a laptop default |
| **MinerU 4.0** | 4.0.12 (2026-10-11) | Apache-2.0 plus extra terms (license needed above 100M MAU or USD 20M monthly revenue; attribution for online services). MinerU2.5-Pro weights Apache-2.0 (older MinerU2.5-2509 was AGPL) | Blocks with bbox, zero-based `page_idx`; agent locators `doc:{id}/tier:{t}/page:{n}/block:{n}/char:{offset}` | Officially recommended: Torch/MPS small models + llama.cpp VLM, 16 GB RAM | ~277 MB wheels; models 0.8 to 3 GB by tier | Strong alternative; has a local server, document library and anonymous telemetry (opt-out) |
| **olmOCR 2** | 0.4.27 (2026-03) | Apache-2.0 / Apache-2.0 | Page-level only (`pdf_page_numbers` char spans), no bboxes | Needs NVIDIA GPU (12 GB+) or a remote vLLM server | 10 GB weights | Not suitable (no block provenance, no Mac path) |
| **GROBID** | 0.9.1 (2026-08-04) | Apache-2.0 | TEI with `@coords="page,x,y,w,h;..."` for persName, biblStruct, ref, figure, formula, head, p, s, note, title, affiliation | Native macOS ARM binaries ship in `grobid-home` (wapiti, pdfalto). Docker `0.9.1-crf` exists for amd64 and arm64 (~506 MB compressed); `0.9.1-full` is **amd64 only, ~14.8 GB** | JDK 21 + ~0.5 GB | **Use for references and header** (see section 2) |
| **PyMuPDF 2.0** (absorbs pymupdf4llm + layout) | 2.0 (2026-10-19) | AGPL-3.0 or commercial. pymupdf-layout up to 1.28.2 was **PolyForm Noncommercial** or commercial; license of the merged layout code: unverified | Page chunks, `get_page_labels()`, `Page.get_label()` | CPU (GNN layout, ONNX) | ~106 MB | Useful for triage and page labels; AGPL matters only if citegeist is distributed closed-source |
| **Nougat** | last release 2023 | MIT / **CC-BY-NC-4.0 weights** | none | n/a | 0.35 GB | Dead; skip |
| **PaddleOCR-VL-1.6** | PaddleOCR 3.7.0 (2026-06) | Apache-2.0 / Apache-2.0 | Two-stage: PP-DocLayout boxes then element recognition | Official [Apple Silicon guide](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL-Apple-Silicon.html): MLX-VLM server backend, verified only on M4 | 1.9 GB | **Best small VLM candidate** |
| **GLM-OCR** | 0.1.5 (2026-04) | Apache-2.0 code, MIT weights, PP-DocLayoutV3 Apache-2.0 | Layout + parallel region OCR, JSON layout details | mlx-vlm example in repo, `mlx-community/GLM-OCR-bf16` (2.2 GB) | 2.2 to 2.7 GB | Candidate |
| **dots.ocr / dots.mocr** | 2026-03 | MIT / MIT | Layout JSON with bboxes | Transformers; MLX: unverified | 3.0 GB params, about 6 GB | Too large for default |
| **DeepSeek-OCR / OCR-2** | 2026-01/02 | MIT / Apache-2.0 | Grounding mode emits boxes | CUDA-oriented; Docling preset via Ollama/LM Studio API | 6.8 GB | Not first choice |
| **TeleOCR** | 2026-08 | Apache-2.0 | Has a layout mode with bboxes | Community MLX quantizations exist | 2.8 GB | Watch; newest leader |
| **OvisOCR2** | 2026-07 | Apache-2.0 | Bboxes only for image regions | community MLX/GGUF | 1.7 GB | Weak provenance |

**APIs (opt-in only, documents leave the machine):**
- **Mistral OCR 4** (2026-06-23): USD 4 per 1,000 pages, batch USD 2, Document AI USD 5; block-level bounding boxes; 170 languages; self-hosting for enterprise ([Mistral](https://mistral.ai/news/ocr-4/)). Version naming on the page is inconsistent (4 vs 4.1).
- **Datalab API**: convert fast/balanced USD 4, accurate USD 10 per 1,000 pages, word bboxes +USD 3; free allowance USD 20/month with a work email ([pricing](https://www.datalab.to/pricing)).
- **LlamaParse v2**: 1 / 3 / 10 / 45 credits per page (Fast / Cost-effective / Agentic / Agentic Plus), USD 1.25 per 1,000 credits, layout extraction +3 credits ([pricing](https://developers.llamaindex.ai/llamaparse/general/pricing/)).

**Inference on provenance:** only two-stage "layout then recognize" systems (Docling standard, Marker, MinerU, PaddleOCR-VL, GLM-OCR, TeleOCR layout mode) and Chandra give reliable block boxes. End-to-end page-to-Markdown models (olmOCR, OvisOCR2) lose provenance. For born-digital PDFs the PDF text layer itself is the most exact provenance (character geometry), so VLM text should be aligned back to it where it exists.

**Apple Silicon speed:** apart from docling-mlx's numbers above, I found no published per-page timings for Marker, MinerU, PaddleOCR-VL or GLM-OCR on M-series chips. **Unverified; the spike measures it.**

---

## 2. GROBID

- **Output:** TEI XML. Coordinates are opt-in per element type via `teiCoordinates` (`persName, figure, ref, biblStruct, formula, head, s, p, note, title, affiliation`). Format: `coords="page,x,y,w,h"`, multiple boxes separated by `;`. Page is 1-based, origin top-left, PDF units. Page sizes come in `<facsimile><surface n lrx lry>` ([Coordinates doc](https://github.com/grobidOrg/grobid/blob/master/doc/Coordinates-in-PDF.md)). Citation callouts `<ref type="bibr" target="#b12">` link to `<biblStruct xml:id="b12">`.
- **Accuracy (GROBID 0.9.0 end-to-end benchmarks, 2026):** PMC 1,943 PDFs: citation fields micro-F1 83.1 strict, 87.6 Levenshtein; header title 84.3 strict, 98.1 Levenshtein; authors 92.9 strict. bioRxiv 2,000 PDFs: citation fields micro-F1 87.4 strict, 91.4 Levenshtein. About 0.75 to 0.85 s per PDF with a GPU, 0.24 s per PDF CRF-only on 4 CPUs. The Docker docs say DL models add 2 to 4 F1 points on reference parsing over CRF-only. Abstract strict F1 is low (16.2) because of exact-match scoring.
- **On a Mac:** OpenJDK 21. `grobid-home` ships `mac_arm-64` builds of libwapiti and pdfalto, so native CRF runs without Docker. Docker: `grobid/grobid:0.9.1-crf` is multi-arch (arm64 ~506 MB compressed); `0.9.1-full` is amd64-only and ~14.8 GB compressed, so not viable on Apple Silicon. Parts of the Docker doc still say "amd64 only, use --platform linux/amd64", which contradicts the 0.9.0 changelog ("Multi-architecture Docker builds with ARM64 support") and the Docker Hub manifest. DL models need Python 3.10/3.11 + TensorFlow via JEP: impractical on a Mac, so plan on CRF.
- **Weaknesses:** formulas come out as plain text, not LaTeX. Tables are weak. Focus is articles, not books.
- **Combine with a layout model:** yes. Use GROBID for header, affiliations, reference list (biblStruct to CSL-JSON) and citation-callout linking. Use Docling/VLM for body text, math, tables, figures. Merge by page and bbox overlap: attach `refs` (callout to reference block) to the body blocks whose boxes contain GROBID `ref` coords. Prefer DOI/arXiv metadata from Crossref/arXiv over GROBID header output when an identifier exists.

---

## 3. arXiv HTML (LaTeXML)

Verified by downloading pages on 2026-10-23 and from [Scaling Accessible Mathematics on arXiv](https://arxiv.org/html/2605.16562v1) (May 2026):
- About **97%** of new submissions produce some HTML, but only about **75%** convert without LaTeXML errors (target 90%). Failures come from unsupported packages and LaTeX3 migrations. About 10% of arXiv is PDF-only (no TeX source).
- **Generator:** page sources now say `Generated by LaTeXML oxide (version 0.7.6)`, the Rust port, even on re-rendered older papers. `arxiv.org/html/1706.03762` (2017) is served, so backfill has started. Old-style IDs (`hep-th/9711200`) returned 404. ar5iv.labs.arxiv.org still serves older papers (oxide 0.7.5). No official backfill announcement found: unverified.
- **Structure:** `article.ltx_document`, sections `ltx_section` with IDs `S1`, `S1.SS2`, paragraphs `S1.p3`, equations `ltx_equation` with IDs like `S3.E1`, bibliography `bib.bib12`, citations `a.ltx_ref href="#bib.bib12"`, tables `ltx_tabular`, figures `ltx_figure` with relative image paths. Conversion problems are marked with `ltx_ERROR` elements (0 to 23 per paper in my sample).
- **Math:** `<math class="ltx_Math" alttext="\mathcal{O}(N^{2})" intent=":literal">` with MathML Core and `<annotation encoding="application/x-tex">`. So both renderable MathML and LaTeX for agents come for free.
- **Size:** the `<article>` HTML was 4.0 to 5.9 times larger than its text with inline LaTeX (measured on 3 papers). Raw LaTeXML HTML is a poor agent format; render Markdown from it.
- **Cleaning:** keep `article`, drop arXiv chrome (`ltx_page_navbar`, `ltx_page_footer`, banners, report buttons), resolve image URLs, convert `ltx_tabular` to plain tables, keep `alttext` LaTeX, count `ltx_ERROR` as a quality signal (above a small threshold, fall back to the PDF pipeline).

**No page numbers.** Alignment approaches, best first:
1. **hyperref named destinations (verified on 2 arXiv PDFs):** the PDFs contain destinations such as `section.4`, `subsection.2.1`, `equation.3.1`, `figure.N`, `table.N`, `cite.KEY`, `page.N`, each with page index and y-coordinate (read with pypdf). Map them to LaTeXML IDs (`section.4` to `S4`, `equation.3.1` to the matching `S3.E*`, figures and tables by counter). This gives coarse, reliable anchors. Inference: equation and figure counter mapping is heuristic when numbering is global.
2. **Text alignment between anchors:** extract page text from the PDF (pdf.js or PyMuPDF), normalize (NFKC, de-hyphenate, drop math and whitespace), then run a monotone fuzzy alignment of HTML block text against the page text stream (anchor n-grams first, then edit distance in between). Each HTML block gets its page index, and blocks split across pages get a split offset.
3. **SyncTeX** from recompiling the source: exact, but heavy and fragile. Not recommended.

The PDF stays the citation source; the HTML is a better text and structure layer.

---

## 4. Web articles and EPUB

- **[defuddle](https://github.com/kepano/defuddle)** 0.19.5 (2026-10-10, MIT, by the Obsidian Web Clipper author). Standardizes footnotes, code blocks, callouts, and converts MathJax/KaTeX to MathML with `data-latex`. Extracts schema.org metadata. Runs in browser or Node (linkedom/JSDOM) and outputs HTML or Markdown. **Recommended** for the TypeScript side.
- **[Mozilla Readability](https://github.com/mozilla/readability)** 0.6.0 (npm, 2025-03; repo active 2026-08, Apache-2.0). Conservative removal, less standardization. Zotero's reader depends on a Readability fork. Fallback.
- **[trafilatura](https://github.com/adbar/trafilatura)** 2.3.1 (2026-10-06, Apache-2.0, Python). Strong in third-party benchmarks (ScrapingHub article extraction, Bevendorff et al. 2023). Outputs TXT, Markdown, JSON, XML, TEI, and handles metadata and dates well. Use it as a second opinion or for batch work in the Python sidecar.
- Keep a raw snapshot (HTML or MHTML) as the source file. Web pages have no pages: cite by section heading or paragraph, and anchor annotations with CssSelector + TextPositionSelector (Zotero's snapshot approach) plus TextQuote.
- **EPUB:** the content is already reflowable XHTML. Keep the publisher XHTML as the reading view (sanitized) and extract blocks with CFI anchors. Printed page numbers come from the optional `page-list` nav and pagebreak markers ([EPUB 3.3](https://www.w3.org/TR/epub-33/), W3C Recommendation 2026-01-13, section 7.4.3). Zotero's SDT models this as `pageMappingType: "physical" | "locations"`; without a page-list, cite chapter and section, not page. Libraries: epub.js (Zotero uses a fork), foliate-js (MIT), Readium ts-toolkit (BSD-3). Docling and MinerU also parse EPUB. Avoid ebooklib (AGPL) if licensing matters.

---

## 5. Scans and books (German)

- **Apple Vision (verified on this Mac, macOS 26.2):** `VNRecognizeTextRequest` revision 3, `.accurate` supports 30 languages including `de-DE` (`.fast` supports 6, including German). macOS 26 adds `RecognizeDocumentsRequest` (Swift), which returns `DocumentObservation` containers with paragraphs, tables, lists, title and barcodes, with the same 30 languages. It is free, on-device, needs no model download and handles no math. German Fraktur is not in the list (inference: unsupported).
  - [ocrmac](https://github.com/straussmaximilian/ocrmac) 1.0.1 (MIT): Python wrapper returning text, confidence and normalized bbox; `vision` or `livetext` backend; about 130 to 210 ms per image on M3 Max (README). Docling already has `OcrMacOptions`.
  - A small Swift CLI is the better long-term route, because it exposes `RecognizeDocumentsRequest` and writes JSON with boxes.
- **OCRmyPDF** 17.13 (2026-09, MPL-2.0) + Tesseract (`deu`, `deu_latf`/`frk` for Fraktur), or the [OCRmyPDF-AppleOCR](https://github.com/mkyt/OCRmyPDF-AppleOCR) plugin (MIT, active 2026-10). It writes an invisible text layer into a derived PDF. **Key benefit:** the PDF view can select and highlight scanned text, and every downstream tool treats the scan as born-digital. OCRmyPDF now ships a PyInstaller hook; Tesseract and Ghostscript must still be installed.
- **VLM OCR** for hard scans (math, tables, warped pages): PaddleOCR-VL-1.6 (its release notes stress robustness to skew, warping and scanning), MinerU2.5-Pro, GLM-OCR. Run per page and only when flagged.
- **Recommendation:** for scans, run OCRmyPDF with AppleOCR into a derived PDF, then the normal structure pipeline; add VLM re-OCR for low-confidence pages. Tesseract `deu_latf` for Fraktur.

---

## 6. Page numbers for citations

- **PDF /PageLabels** (ISO 32000, number tree in the catalog: style D/R/r/A/a, prefix, start). Readable via pdf.js `getPageLabels()` (null if absent), PyMuPDF `get_page_labels()` / `Page.get_label()`, pypdf `page_labels`, macOS PDFKit `PDFPage.label` (PDFKit returns index+1 when absent, so check the catalog). In my 3-PDF sample, the PLOS PDF had `/PageLabels` (plain 1..n) and both arXiv PDFs had none. How common meaningful labels are in journal PDFs: unverified; measure in the spike.
- **Printed page detection:** Zotero's [document-worker `page-label.js`](https://github.com/zotero/document-worker) (verified): if catalog labels exist and the count matches, use them. Otherwise collect numeric and roman-numeral tokens from header/footer blocks (`flowClass: excluded`), find the longest increasing sequence across pages (Fenwick-tree LIS), accept arabic if it covers at least 30% of pages and roman if at least 5 pages, and fall back to index+1. citegeist should do the same and additionally **interpolate gaps** (chapter-opening pages often have no number) and flag conflicts.
- **Crossref offsets:** `api.crossref.org/works/{doi}` returns `page`, e.g. `"433-460"` (Mind 1950), `"213-229"` (LNCS chapter), `"610-623"` (FAccT 2021), but `"e115253"` for PLOS ONE (an e-locator, not a range). Rule: `label = first_page + (index - first_content_index)`, valid only if the PDF page count equals the range length (allow 1 or 2 injected cover pages, which Zotero's SDT marks as `injected`) **and** it agrees with detected printed numbers on several pages.
- **Zotero's reader:** annotations store `pageLabel` per annotation, not per document. "Edit Page Number" applies a label to one annotation, the selection, the page, all from this page on, or all, with offset arithmetic (`newLabel = label + (pageIndex - currentPageIndex)`), plus an "auto" reset to detected labels. A `usePhysicalPageNumbers` view toggle exists. Hypothesis stores `PageSelector {index, label}`.
- **citegeist design:** store per document a `pages.json` with `index`, `label`, `labelSource` (`catalog | detected | crossref-offset | user`), and `confidence`. Store the label snapshot on each quote as well, plus a document-level user override that re-labels all quotes (Zotero's "from this page on").

---

## 7. Representation design

| Criterion | (a) Markdown + page markers | (b) Semantic HTML + data attributes | (c) JSON block model, render HTML and MD |
|---|---|---|---|
| Agent token efficiency | Best (about 1x text) | 4 to 6x text (measured on LaTeXML) | Too verbose to read raw; fine via tools |
| Math | LaTeX `$...$` only | MathML + LaTeX (`data-latex`) | Both stored |
| Tables | Pipe tables break on merged cells; needs embedded HTML | Full | Full (cells, spans) |
| Page/bbox provenance | Coarse (markers) | Full via `data-page`, `data-bbox` | Full, typed, validated |
| Stable IDs for anchoring and links | Possible (`^blockid`) | `id`/`data-block-id` | Native |
| Git diffability | Good | Medium | Good if JSONL, one block per line, stable key order |
| Re-conversion merge | Hard | Hard | Feasible (match blocks, carry IDs) |

**Recommendation: (c) canonical, render (a) and (b).** This is also what Zotero chose: SDT is a JSON tree with page catalog, per-block anchors (`pageRects: [pageIndex,x1,y1,x2,y2]`, per-character `textMap`), `previousPart/nextPart` for blocks split across columns or pages, `flowClass` for furniture, `refs/backRefs` for citations, `label` per page and `textSource: born-digital | ocr`. Zotero lists "structured context for agents" as a use case and stores it as a binary chunked pack for random access. citegeist can use the same ideas with plain files.

**Block schema (one JSON object per line in `blocks.jsonl`):**
```json
{"id":"b7f3k2q","type":"paragraph","sec":"2.1","flow":"body",
 "text":"... the effect was robust ($p<0.01$) ...",
 "spans":[{"page":4,"label":"215","start":0,"end":812,"bbox":[72.0,310.2,290.1,520.7]},
          {"page":5,"label":"216","start":812,"end":1040,"bbox":[72.0,60.0,290.1,118.4]}],
 "refs":["r12"],"src":{"engine":"docling@2.142.1","native":"#/texts/57"},"conf":0.97}
```
Coordinates in PDF user space points of the original file (state the origin convention once in `manifest.json`); `page` is a zero-based index; per-page char ranges let a quote spanning a page break cite "pp. 215-216".

**Stable block IDs:** mint once (short random or content-hash ID), persist, never derive from position. On re-conversion, match new blocks to old ones by page overlap, bbox IoU and text similarity; carry IDs over, mint new IDs for unmatched blocks, and write `idmap.json` (old to new, plus tombstones) so note links and annotations resolve. Positional converter IDs (Docling `#/texts/n`, MinerU `page/block`, LaTeXML `S1.p3`) are kept only as `src.native`.

**Agent Markdown (`doc.md`):** YAML front matter (citekey, title, authors, year, DOI, source hash); page boundaries as `<!-- page 5 label=216 -->` on their own line, and inline `<!-- p:216 -->` where a page break falls inside a paragraph; Obsidian-style block IDs `^b7f3k2q` at the end of each block, so `[[smith2020#^b7f3k2q]]` works in Zettelkasten notes and agents can grep and cite. Math as LaTeX, complex tables as embedded HTML, figures as `![caption](assets/fig-b...png)`.

**Reader HTML (`doc.html`):** `<p id="b7f3k2q" data-page="4" data-label="215" data-bbox="...">`, inline `<span class="pb" data-page="5" data-label="216"></span>` at page breaks, MathML with `data-latex`.

**Folder layout per document:**
```
items/<citekey-or-ulid>/
  item.json                 # CSL-JSON metadata (+ identifiers, sources list)
  sources/<sha256-12>.pdf   # immutable originals (also .epub, .html, arXiv HTML snapshot)
  derived/<sha256-12>/      # one folder per source file, fully regenerable
    manifest.json           # pipeline path, tool versions, model revisions, timings, quality flags
    pages.json              # index, label, labelSource, size, rotation, textSource, per-page quality
    blocks.jsonl            # canonical block model
    refs.jsonl              # parsed references (from GROBID TEI or arXiv bib), linked to blocks
    doc.md                  # agent view
    doc.html                # reader view
    assets/                 # figure crops named by block id
    raw/                    # converter native output (docling.json, tei.xml, ...) for debugging
    idmap.json              # block id redirects across re-conversions
    ocr.pdf                 # derived PDF with OCR text layer (scans only)
  annotations.jsonl         # quotes and highlights, append-only, dual anchors (section 8)
```
Inference: commit `item.json`, `annotations.jsonl` and notes to git; treat `derived/` as cache (regenerable, possibly git-ignored or LFS) except `idmap.json`, which must persist.

---

## 8. Anchoring highlights (dual anchors)

**Standards and prior art (verified):**
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) (Recommendation, 2017-02-23): `TextQuoteSelector {exact, prefix, suffix}` over normalized text counted in Unicode code points; `TextPositionSelector {start, end}` (start inclusive, end exclusive), described as "very brittle" to changes; `FragmentSelector` with `conformsTo` RFC 3778 for PDF (`page=10&viewrect=50,50,640,480`); `refinedBy` chaining; `RangeSelector`; multiple selectors should select the same content.
- **Hypothesis client** ([anchoring code](https://github.com/hypothesis/client/tree/main/src/annotator/anchoring)): HTML tries RangeSelector, then TextPosition (checked against the quote), then fuzzy TextQuote. Fuzzy matching uses `approx-string-match` (bit-parallel edit distance) with `maxErrors = min(256, quote.length / 2)` and score = weighted quote similarity (50), prefix (20), suffix (20), position hint (2). For PDFs it strips all whitespace (pdf.js versions differ in spacing), searches pages ordered by distance from the hinted page, stops early on an exact quote plus exact context, and stores a custom `PageSelector {index, label}`.
- **Zotero** ([reader types](https://github.com/zotero/reader/blob/master/src/common/types.ts)): PDF annotations are `{pageIndex, rects[[x1,y1,x2,y2]], nextPageRects}` in PDF user space (y up); EPUB annotations are `FragmentSelector` with EPUB CFI; snapshots are `CssSelector` refined by `TextPositionSelector`. The new Reading Mode works on SDT positions (`{start, end}` content paths) and converts them back to source positions via an `SDTPositionMapper`, so stored annotations always live in source coordinates.

**Recommended dual-anchor record (`annotations.jsonl`):**
```json
{"id":"a01...","item":"smith2020","kind":"quote","color":"yellow",
 "source":{"file":"sha256:3f2a...","pdfFingerprint":"...","pages":[
   {"index":4,"quads":[[72.0,318.1,290.0,330.4]]},{"index":5,"quads":[[72.0,60.0,180.2,71.9]]}]},
 "text":{"exact":"...","prefix":"32 chars before","suffix":"32 chars after",
   "position":{"start":48211,"end":48390},"stream":"citegeist-norm-v1"},
 "block":{"id":"b7f3k2q","start":610,"end":789},
 "cite":{"pageLabels":["215","216"],"labelSource":"crossref-offset"},
 "created":"2026-10-23T12:00:00Z","by":"agent:claude"}
```
- The source anchor is authoritative in the PDF view and survives re-conversion untouched (it depends only on the file hash).
- The text anchor is the portable, re-anchorable one. Define one normalization (`citegeist-norm-v1`: NFC, collapse whitespace, remove soft hyphens, join end-of-line hyphenation) for every text stream.
- The block hint is a fast path; it can go stale.

**Algorithms:**
- Highlight created in the PDF view: pdf.js selection gives text and quads. Find the quote in `blocks.jsonl`, restricted to blocks on those pages, with Hypothesis scoring. Store block id and offsets.
- Highlight created in the HTML view: block id and offsets give the quote. Map to quads by aligning block text to the pdf.js (or OCR layer) characters inside the block's bbox on that page. Store the quads.
- After re-conversion: resolve the block via `idmap.json`, check the exact quote at the offset, then fuzzy search within the block, its neighbours, the same pages, and finally the whole document. Below a score threshold (for example 0.8), mark the annotation orphaned and show it for manual repair. The PDF highlight keeps working regardless.
- If the PDF file itself changes (new version): re-anchor quads from the text quote against the new pdf.js text layer, Hypothesis-style, and keep the old record.
- Interop export: W3C JSON-LD with TextQuote + TextPosition + FragmentSelector (RFC 3778) for PDFs, CFI for EPUB.

---

## 9. Pipeline, runtime, spike

### 9.1 Pipeline with fallbacks
0. **Ingest:** hash the file, store it immutably. Find identifiers (DOI in the text layer or XMP, arXiv ID); fetch Crossref/arXiv metadata.
1. **Triage** (PyMuPDF or pdf.js, under 1 s): per page text coverage vs image coverage, garbled text (`(cid:` sequences, ligature and encoding damage), language, `/PageLabels`, outline, named destinations.
2. **Fast path (born-digital):** Docling standard pipeline (OCR off, heron layout, TableFormer; optional docling-mlx), plus GROBID CRF for header, references and callouts. Normalize to `blocks.jsonl`, detect page labels, render MD and HTML. Target: seconds per paper.
3. **arXiv path:** if arXiv HTML exists with few `ltx_ERROR`s, take text, math and structure from HTML, align to PDF pages (named destinations, then text alignment), and keep figures from HTML. Fall back to step 2 otherwise.
4. **High-quality path (flagged pages only):** math-dense pages without LaTeX, low table confidence, reading-order doubts. Re-run those pages with PaddleOCR-VL-1.6 (MLX-VLM) or MinerU2.5-Pro (Docling `mineru2_pro` preset or MinerU 4 llama.cpp), and align the output to the text layer.
5. **OCR path (scans):** OCRmyPDF with AppleOCR plugin (or Tesseract `deu+eng`, `deu_latf` for Fraktur) into `ocr.pdf`, then step 2 on it; VLM for low-confidence pages.
6. **API path (explicit opt-in per document):** Mistral OCR 4 or Datalab for the hardest cases.
7. **Web/EPUB:** defuddle (Node) and trafilatura cross-check; EPUB XHTML with CFI and page-list.

### 9.2 Running Python from the TypeScript app
- Ship a signed `uv` binary as a sidecar. Tauri v2 requires `externalBin` entries named with the target triple (`uv-aarch64-apple-darwin`) and `shell:allow-spawn` capabilities ([Tauri sidecar docs](https://v2.tauri.app/develop/sidecar/)); Electron would use `utilityProcess` or `child_process`.
- On first run: `uv python install` (managed python-build-standalone builds; set `python-preference = only-managed`, `UV_PYTHON_INSTALL_DIR` and `UV_CACHE_DIR` under `~/Library/Application Support/citegeist/`), then `uv sync --frozen` from a lockfile bundled with the app. One env for the core (Docling, PyMuPDF, ocrmac, trafilatura); separate optional envs for heavy extras (VLM, MinerU) to avoid dependency conflicts.
- **Worker:** one long-lived Python process speaking JSON-RPC over stdio (job queue, progress events, cancellation, one VLM loaded at a time, unload after idle). GROBID as a second optional sidecar: a jlinked JRE 21 + GROBID jar + `grobid-home` (macOS ARM natives included), started lazily on localhost with a random port.
- **Models:** download lazily per tier via `huggingface_hub.snapshot_download` with **pinned revisions**, show sizes before download (heron 0.17 GB, granite-docling 0.53 GB, PaddleOCR-VL-1.6 1.9 GB, MinerU2.5-Pro 2.3 GB), then set `HF_HUB_OFFLINE=1`.
- Wheel download sizes measured with `uv pip compile` (macOS arm64, py3.12): Docling about 286 MB, MinerU 277 MB, Marker 227 MB, PyMuPDF 106 MB, OCRmyPDF 43 MB, ocrmac 12 MB. Installed size is larger: unverified.
- Unverified: how Gatekeeper and notarization treat a Python runtime installed at runtime. Test it in the spike.

### 9.3 Spike plan (1 to 2 days)
**Fixture corpus (15 PDFs):**
1. Two-column IEEE/ACM paper with equations
2. arXiv math-heavy preprint (with HTML version)
3. arXiv ML paper with many tables (with HTML version)
4. Elsevier/Springer journal article with footnotes and running headers (has Crossref page range)
5. PLOS/e-locator article (`/PageLabels`, e-number)
6. Book chapter PDF with printed page numbers starting above 200
7. German journal article (born-digital, umlauts, ligatures)
8. German scanned book chapter (300 dpi, clean)
9. German scan, poor quality (skew, 200 dpi, photocopy)
10. Old scan with Fraktur or old typography
11. Book front matter with roman numerals followed by arabic
12. Grey literature report (single column, complex tables, charts)
13. Thesis with long reference list and footnotes
14. PDF with broken text layer (cid fonts or garbled encoding)
15. JSTOR-style PDF with an injected cover page

Hand-label a gold set: 5 pages per document with block order, 10 quotes per document with true printed page, all tables in docs 3 and 12, all display equations in doc 2.

**Candidates:** Docling standard (with and without docling-mlx), Docling + PaddleOCR-VL-1.6 (MLX) on flagged pages, MinerU 4 standard, Marker 2 fast, GROBID CRF native; OCR: Apple Vision (ocrmac or Swift), OCRmyPDF + Tesseract `deu`, PaddleOCR-VL-1.6.

**Pass/fail criteria:**
| # | Criterion | Pass |
|---|---|---|
| 1 | Page label correct for gold quotes (catalog, detection or Crossref offset) | at least 98% on docs 4 to 6, 11, 15; never silently wrong (wrong labels must be flagged low confidence) |
| 2 | Quote round trip: highlight in PDF view, then block, then HTML range, then back to PDF quads | at least 95% exact, 100% of failures detected |
| 3 | Re-anchoring after converting with a different engine | at least 95% of annotations re-anchor with score of at least 0.9; rest flagged |
| 4 | Block ID survival across two runs of the same engine | 100%; across engines at least 90% via idmap |
| 5 | Reading order on two-column pages (normalized edit distance vs gold) | at most 0.10 |
| 6 | German OCR character error rate, clean scan (doc 8) | at most 2%; poor scan (doc 9) at most 6% |
| 7 | Display-equation LaTeX that compiles and matches (doc 2) | at least 90% fast or HQ path |
| 8 | Table structure acceptable (manual check of rows/cols) | at least 80% of tables |
| 9 | References parsed into CSL with DOI or title+year | at least 90% of entries (docs 1, 4, 13) |
| 10 | Speed on M4 Pro, born-digital fast path | at most 1.5 s/page; HQ VLM path at most 15 s/page; peak RAM at most 8 GB |
| 11 | arXiv HTML to PDF page alignment (docs 2, 3) | at least 98% of blocks on the correct page |
| 12 | Agent Markdown size vs plain text | at most 1.3x characters |

Decision rule: pick the cheapest engine set that passes 1 to 4 (non-negotiable for citations) and most of 5 to 12. If no local engine passes 6 or 7, keep the API path as an opt-in.

---

## 10. Open uncertainties
- No published Apple Silicon speed figures for Marker 2, MinerU 4, PaddleOCR-VL-1.6 or GLM-OCR; no independent German OCR benchmark for Vision, Tesseract or the VLMs.
- Docling's olmOCR-Bench score comes only from a competitor's run (Marker README).
- License of the layout code merged into PyMuPDF 2.0 (previously PolyForm Noncommercial).
- How common meaningful `/PageLabels` are in journal and book PDFs.
- Whether the 2026 multilingual benchmarks (MORE, PureDocBench) cover German.
- Official status of arXiv's HTML backfill and of LaTeXML oxide (observed in page sources only).
- Gatekeeper behaviour for runtime-installed Python environments.
- Whether Zotero's SDT and Reading Mode have shipped in a release: commits in 2026 show active development, but no release note was found.

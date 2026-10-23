# citegeist: desktop and frontend stack research

Date: 2026-10-23. Scope: macOS first (Apple Silicon), document-centric app, files on disk as source of truth, rebuildable local index, Node libraries in the core, Python worker for PDF conversion, inference via CLI subprocesses, built mostly by coding agents.

Method and caveats:
- Versions and dates come from the npm registry, PyPI and the Hugging Face API, queried on 2026-10-23, unless another source is linked.
- The shared web-search budget ran out midway. After that I verified only through direct fetches of known docs, registries and raw source files. Points I could not verify are marked **unverified**.
- "Inference" marks my own reasoning as opposed to a sourced fact.

---

## 1. Desktop shell: Electron vs Tauri v2 vs Electrobun vs native Swift + WKWebView

### Verified facts

| | Electron | Tauri v2 | Electrobun | Swift + WKWebView |
|---|---|---|---|---|
| Current version | 45.0.0 (2026-10-21), Chromium 156, Node 24.22.0; 44.x and 43.x still supported ([releases](https://releases.electronjs.org/)) | tauri 2.12.3 (2026-10-10), CLI 2.12.4 (2026-10-21) ([release index](https://v2.tauri.app/release/)) | 2.0.4 (2026-10-18); v1 on 2026-02-06 ([blog](https://blackboard.sh/blog/electrobun-v1/)); 2.x moved builds to "Hutch", and 2.0.2 defaulted to a new "Cottontail" runtime before 2.0.4 went back to Bun ([migration guide](https://framework.blackboard.sh/electrobun/guides/migrating-to-v2/)) | Apple frameworks |
| Web engine on macOS | Bundled Chromium | System WKWebView. A CEF runtime exists only on the `feat/cef` branch ([PR #14661](https://github.com/tauri-apps/tauri/issues/14661), merged into the branch 2025-12-15). The release index lists only `tauri-runtime-wry` | System WebKit by default, optional bundled CEF via `bundleCEF` ([README](https://cdn.jsdelivr.net/npm/electrobun@1.18.1/README.md)) | System WebKit |
| Node in-process | Yes: main process plus [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) (Node child with MessagePorts, launched via Chromium services) | No. Node runs as a sidecar binary (`externalBin`, target-triple naming, shell-plugin permissions). The docs show `@yao-pkg/pkg` and describe the example as short-lived, single-command ([sidecar](https://v2.tauri.app/develop/sidecar/), [Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)) | Bun main process (Node-compatible, not Node) | No. Separate Node process plus a bridge |
| E2E automation on macOS | Playwright `_electron` ("experimental", Electron v21+). Native dialogs must be stubbed ([docs](https://playwright.dev/docs/api/class-electron)). CDP is available, so [Playwright MCP `--cdp-endpoint`](https://github.com/microsoft/playwright-mcp) can attach to a running dev app | The official page still says tauri-driver supports only Windows/Linux "due to macOS not having a WKWebView driver tool". WebdriverIO's `@wdio/tauri-service` with the embedded `tauri-plugin-wdio-webdriver` covers macOS ([wdio](https://webdriver.io/docs/desktop-testing/tauri)) | Nothing documented in the docs index ([docs](https://framework.blackboard.sh/electrobun/)) | No WebDriver for embedded WKWebView (same reason as Tauri). XCUITest only |
| Auto-update | `autoUpdater` (Squirrel.Mac): "Your application must be signed for automatic updates on macOS" ([docs](https://www.electronjs.org/docs/latest/api/auto-updater)). electron-updater 6.8.9 | Own updater signature, "This cannot be disabled" ([docs](https://v2.tauri.app/plugin/updater/)). The page says nothing about Apple signing | bsdiff deltas, "as small as 4KB" (README claim) | Sparkle (not researched) |
| Bundle size | Measured locally on this Mac: the arm64 `Electron Framework` is 273 to 285 MB on disk in Slack (Electron 44.0.0), Notion (43.6.0) and Cursor (42.10.0) | A few MB plus assets (not measured) | "~14MB" goal, "as small as 16MB" (README) | Smallest |
| Maintenance | Electron team, 8-week majors | Tauri team | Single maintainer. The README states "no expectation" that issues or PRs get reviewed | You |

WebKit canvas limits (relevant to pdf.js in WKWebView):
- Per-canvas area cap: `16384 * 16384` on macOS and `8192 * 8192` on iOS. Larger canvases log "Canvas area exceeds the maximum limit" ([CanvasBase.cpp](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/html/CanvasBase.cpp)).
- Process-wide cap on total canvas backing memory: `max(ramSize()/4, 1 GB)`. Past it, `getContext` returns null with "Total canvas memory use exceeds the maximum limit" ([r193500, 2015](https://trac.webkit.org/r193500)). Whether this exact cap is still in current WebKit main is **unverified** (I did not find it in today's `CanvasBase.cpp`). Desktop Safari hits the bug less often because its limit is higher ([bug 195325](https://bugs.webkit.org/show_bug.cgi?id=195325)).

pdf.js browser support: the modern build targets current Firefox and Chrome. Safari is listed only for the legacy build: "18 and later, mostly supported", with "some missing features/defects" ([FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)). pdf.js 6.0 raised the minimums to Chrome 125 and Safari 18 ([#21152](https://github.com/mozilla/pdf.js/pull/21152)) and enables `ImageDecoder` by default only on Chrome ([v6.0.227](https://github.com/mozilla/pdf.js/releases/tag/v6.0.227)).

Signing for a personal app: since macOS Sequoia, users cannot Control-click past Gatekeeper and must allow the app in System Settings ([Apple, 2024-08-06](https://developer.apple.com/news/?id=saqachfa)). Inference: a locally built app carries no quarantine attribute, so Gatekeeper does not block it, and an ad-hoc signature (needed for arm64 code) is enough. Squirrel-based auto-update needs a stable signing identity, so in practice it needs a Developer ID ($99/year). Until that is worth paying for, "update" for a personal build can simply mean `git pull && pnpm build`.

### Assessment for citegeist (inference)

- **The rendering engine decides.** The heaviest UI surface is a multi-document PDF reader. On Chromium, pdf.js runs on its primary target with no WebKit canvas budget. On WKWebView it runs on a "mostly supported" legacy target and shares one canvas-memory cap across all open PDFs, thumbnails and the graph canvas.
- **Node integration decides.** The core is Node: the MCP TypeScript SDK, the Claude Agent SDK, citeproc-js, watchers, SQLite and Transformers.js. Electron runs all of it in a `utilityProcess` without a packaged sidecar, a Rust bridge or a second runtime. Tauri needs a long-lived Node sidecar plus its own IPC. Electrobun substitutes Bun, which raises native-addon and SDK compatibility questions (**unverified** for onnxruntime-node, better-sqlite3 13 and the Agent SDK under Bun).
- **Agent testability decides.** Playwright drives Electron directly, and agents can attach to a running dev instance over CDP. The same renderer also runs in a plain Chromium page for fast component tests. WKWebView-based shells have only WebdriverIO's plugin route (Tauri) or nothing (native).
- **Footprint is the main cost.** It costs roughly 280 MB of disk and a higher RAM baseline (not measured for citegeist). PDF page bitmaps, embeddings and models will dominate memory regardless of shell.
- **Python sidecar.** Spawning a supervised `uv`-managed worker is equal effort in every shell (uv 0.13.5, docling 2.142.1, marker-pdf 2.0.0 on PyPI). With Electron, the supervisor is TypeScript and can be unit-tested with Vitest.

**Recommendation: Electron 45**, with electron-vite 6.0.0 for builds and electron-builder 26.15.3 for packaging. Forge's Vite plugin is still marked experimental ([docs](https://www.electronforge.io/config/plugins/vite)). Run the core in a `utilityProcess`, keep the renderer sandboxed with `contextIsolation` and no Node, and serve local files via a custom protocol. Package the core so it can also run headless under plain Node (`citegeist serve`). That gives agents and CI a way to exercise the MCP server and indexer without the UI.

- Runner-up: Tauri v2, which becomes attractive once its CEF runtime ships in a release.
- What would change this: pdf.js measured equally fast and stable in WKWebView on large multi-PDF sessions, combined with a released Tauri CEF runtime.

---

## 2. PDF viewing and annotation

| Option | Status (verified) | Fit |
|---|---|---|
| **pdf.js / pdfjs-dist** | 6.4.299 (2026-10-03), Apache-2.0. Exports `TextLayer`, `DrawLayer`, `AnnotationEditorLayer`, `AnnotationEditorUIManager`. `AnnotationEditorType.HIGHLIGHT = 9`, plus `COMMENT = 102` ([util.js](https://raw.githubusercontent.com/mozilla/pdf.js/master/src/shared/util.js)). Viewer defaults: `maxCanvasPixels 2**25`, `maxCanvasDim 32767`, `enableDetailCanvas true` ([app_options.js](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/app_options.js)) | DOM text layer, so native Selection/Range, copy and find all work and Playwright can see the text. The built-in highlight editor stores into the PDF's annotationStorage and is written out on save, which is the wrong place for sidecar-file truth |
| **EmbedPDF** | 2.15.1 (2026-09-16), PDFium fork. The npm license says MIT, while the repo README now says Apache-2.0 and warns that "v3 is under active development and is not yet recommended for production" ([repo](https://github.com/embedpdf/embed-pdf-viewer)). The selection plugin offers `getSelectedText()`, `getFormattedSelection()` (per-page rects) and a `selectionMenu` render prop. Hit-testing works on glyph geometry ([docs](https://www.embedpdf.com/docs/react/headless/plugins/plugin-selection)). Annotations have an export/import transfer format ([docs](https://www.embedpdf.com/docs/react/viewer/plugins/plugin-annotation)) | Strong runner-up: PDFium fidelity and a ready-made selection menu. Costs: a v2 to v3 migration ahead, no DOM text, and a smaller ecosystem |
| **react-pdf-highlighter-extended** | 8.1.0, last published 2024-07-05. Depends on `pdfjs-dist ^4.4`, peer React 18 | Reject: stale against pdf.js 6 and React 19.3 |
| **zotero/reader** | AGPL-3.0 (`COPYING`, `package.json`). Uses forks of pdf.js and epub.js as submodules. Builds `zotero`, `ios`, `android` and `dev` targets. Embeddable via `new Reader({ type, data: { buf }, annotations, onSaveAnnotations, onDeleteAnnotations, onChangeViewState, onOpenContextMenu, ... })` ([src/index.dev.js](https://raw.githubusercontent.com/zotero/reader/master/src/index.dev.js)). Pushed 2026-10-22. Builds need `NODE_OPTIONS=--openssl-legacy-provider` ([README](https://github.com/zotero/reader)) | It can be embedded standalone, the way Zotero's mobile builds do. But you adopt Zotero's whole UI and data model, a custom AI popover means maintaining a fork, and AGPL binds citegeist if it is distributed. Best used as a reference for the annotation schema and for selection in multi-column papers |
| **Nutrient Web SDK** | `@nutrient-sdk/viewer` 1.24.0, commercial evaluation license | Reference only |

**Recommendation: pdfjs-dist 6.x** with the `pdf_viewer` components (page virtualization, link service, find controller). Disable the built-in editors (`annotationEditorMode: AnnotationEditorType.DISABLE`) and render your own highlight layer. Decisive reason: the DOM text layer gives selection, quote extraction and agent-testable DOM for free, and Chromium is pdf.js's primary target. Runner-up: EmbedPDF, if pdf.js selection or rendering quality on real papers turns out inadequate.

### Custom highlight layer with a selection popover (design sketch, inference)

1. **Storage.** Write one sidecar file per paper, e.g. `papers/<key>/annotations.json`. Each highlight carries `{ id, page, color, rects: [[x1,y1,x2,y2]] in PDF points, quote: { exact, prefix, suffix }, textPosition: { start, end }, note, createdBy }`. The quote follows the W3C Web Annotation TextQuoteSelector model. The PDF itself stays untouched.
2. **Selection to geometry.** On `pointerup`, read `getSelection().getRangeAt(0).getClientRects()` and group the rects by the `.page` element they intersect. Subtract each page div's rect and convert to PDF space with `viewport.convertToPdfPoint`, then merge the rects for each line. Compute `exact`, `prefix` and `suffix` from `page.getTextContent()`.
3. **Rendering.** Add one absolutely positioned SVG or div layer per page between canvas and text layer. Use `mix-blend-mode: multiply` and recompute positions with `viewport.convertToViewportRectangle` on zoom or rotation. Clicks are hit-tested in a top layer that enables `pointer-events` only on highlight shapes.
4. **Popover.** Pass `range.getBoundingClientRect()` as a virtual reference to Floating UI (`@floating-ui/react` 0.27.20) with `offset`, `flip`, `shift` and `autoUpdate` on the scroll container. Actions: color, note, "Ask AI" (sends the quote, page and paper id to the agent sidebar), and "Add to note" (inserts an embed into the open note).
5. **Agent-written highlights.** An agent may write only `{ page, quote.exact }`. The reader re-anchors it by fuzzy search over the page text with `approx-string-match` (2.0.1, 2026-10-09) and backfills `rects`. The same quote selectors re-anchor highlights in the reflowed HTML reader after a reconversion.

---

## 3. Notes editor (lossless Markdown round-trip)

| Editor | Version | Round-trip (verified where linked) |
|---|---|---|
| **CodeMirror 6** | view 6.43.15, lang-markdown 6.5.2, @lezer/markdown 1.8.1 | The document is the Markdown text, so round-trip is identity. @lezer/markdown supports custom `parseInline`/`defineNodes` extensions and ships GFM, Subscript, Superscript and Emoji ([README](https://github.com/lezer-parser/markdown)). `@codemirror/lang-yaml` provides `yamlFrontmatter()` |
| Milkdown | 7.22.3 | ProseMirror plus remark. Markdown is re-serialized from the tree, so marker style, escaping and spacing get normalized (inference from the architecture) |
| TipTap v3 | 3.32.0, `@tiptap/markdown` 3.32.0 | "an early release and can be subject to change", MarkedJS parser. Lossless round-trip is not claimed. Frontmatter is not mentioned ([docs](https://tiptap.dev/docs/editor/markdown)) |
| BlockNote | 0.56.0 (core MPL-2.0, `xl-ai` GPL-3.0 or proprietary) | Import "lossy". The docs recommend JSON for lossless storage ([docs](https://www.blocknotejs.org/docs/features/import/markdown)) |
| Lexical | 0.52.0 | Transformer-based import/export. Lossy for unmodeled syntax (inference) |

**Recommendation: CodeMirror 6 with an Obsidian-style live preview built from decorations.** Lines away from the cursor render as widgets, and the active line shows raw syntax.
- Ready-made packages are young: `codemirror-markdown-hybrid` 1.2.2, `codemirror-live-markdown` 0.5.1-alpha, and `@retronav/ixora` (last release 2023). Plan to own the extension and borrow patterns from SilverBullet (MIT).
- Wiki-links: `[[` triggers an `@codemirror/autocomplete` source fed by the index.
- Citations: Pandoc `[@citekey]` with `[@` autocomplete, rendered as a citeproc short-cite widget.
- Highlight embeds: `![[paper#^hl-id]]` as a block widget, rendered through a `StateField` because block decorations need one.
- Frontmatter: `yamlFrontmatter()` plus an optional properties widget.
- Typed links: one custom inline syntax parsed by a lezer extension.
- Decisive extra reason: when an agent edits an open file, the watcher's new text is diffed and dispatched as a CM6 transaction. Cursor, selection and undo map through the change. ProseMirror-family editors must re-parse and replace the document instead.
- Runner-up: Milkdown, if true WYSIWYG matters more than byte stability. In that case every writer, agents included, should run one canonical formatter.

---

## 4. Local storage and indexing

Verified facts:
- **better-sqlite3** 13.0.3, bundling SQLite 3.53.4 with FTS5 and JSON1 ([compilation.md](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/compilation.md)). 13.0.0 (2026-07-21) is "the first version of better-sqlite3 to run on the N-API". Its binaries "should theoretically work across different versions of Node.js and Electron" ([releases](https://github.com/WiseLibs/better-sqlite3/releases)).
- **node:sqlite** is a release candidate (Stability 1.2) since Node v24.15.0 per the [v24 docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html). It is synchronous and has `function`, `aggregate`, `loadExtension` (opt-in via `allowExtension`) and `backup`. Node builds SQLite with `SQLITE_ENABLE_FTS5` ([sqlite.gyp](https://raw.githubusercontent.com/nodejs/node/main/deps/sqlite/sqlite.gyp)). Whether Electron 45 (Node 24.22) exposes `node:sqlite` is **unverified**. One third-party issue reports it working in VS Code's Electron host ([issue](https://github.com/microsoft/AI-Engineering-Coach/issues/84)).
- **FTS5** ([docs](https://www.sqlite.org/fts5.html)):
  - Tokenizers: `unicode61 remove_diacritics 2`, `porter` (English only), and `trigram` (`case_sensitive`, `remove_diacritics`, indexed LIKE/GLOB, minimum 3 characters).
  - Contentless-delete tables exist since 3.43.0.
  - There is no German stemmer. Options: the C extension [fts5-snowball](https://lists.tartarus.org/pipermail/snowball-discuss/2021-May/001717.html), or stemming in JS before indexing (e.g. `snowball-stemmers` 0.6.0, an old but stable algorithm port).
- **sqlite-vec**: 0.1.9 (2026-03-31) is still "pre-v1, so expect breaking changes". The 0.1.10 alphas (through 2026-05-18) add DiskANN and rescore, with IVF experimental ([releases](https://github.com/asg017/sqlite-vec/releases)).
- **vec1**, the official SQLite extension by Dan Kennedy: version 0.8, an IVFADC+OPQ approximate index, L2 and cosine, a loadable extension built from the SQLite tree. Its roadmap lists "More and better testing" ([doc](https://sqlite.org/vec1/doc/trunk/doc/vec1.md)). A forum user reported memory-safety bugs found with an agent ([thread](https://sqlite.org/forum/info/a09b103d9d41ed25a357a42aa22ca32a93d4a5fb9b10eb40ab3e14cde508e8f1?t=c)). SQLite 3.54.0 shipped on 2026-10-09 ([release log](https://www.sqlite.org/releaselog/3_54_0.html)).
- **libSQL/Turso**: `@libsql/client` 0.18.0. The Rust rewrite `@tursodatabase/database` is at 0.8.3, which is pre-1.0.
- **PGlite**: 0.5.11 (Postgres 18.6). Since 0.5.4 it detects Electron main and utility processes correctly ([changelog](https://raw.githubusercontent.com/electric-sql/pglite/main/packages/pglite/CHANGELOG.md)). It is still single-user-mode Postgres. v0.4 added multiplexing over its one connection, and true multi-connection is only planned ([v0.4 post](https://electric-sql.com/blog/2026/03/25/announcing-pglite-v04)). Postgres has German Snowball stemming built in.
- **LanceDB** (`@lancedb/lancedb` 0.40.0) has BM25 FTS and hybrid RRF search ([docs](https://lancedb.com/docs/search/full-text-search)).
- **DuckDB**: the FTS index "will not update automatically when the input table changes" ([docs](https://duckdb.org/docs/stable/core_extensions/full_text_search.html)).
- **Watchers**:
  - `@parcel/watcher` 2.6.0 uses FSEvents and is used by VS Code. `getEventsSince(snapshot)` answers "what changed while the app was closed" ([README](https://github.com/parcel-bundler/watcher)).
  - chokidar 6.0.0 (2026-10-19) is a "complete rewrite" with a native `fs.watch(recursive)` backend and requires Node 22.22+. v5 was ESM-only, and v4 dropped globs and fsevents ([README](https://github.com/paulmillr/chokidar)).

**Recommendation: SQLite via better-sqlite3 13 in the core utilityProcess, WAL mode.**
- **One rebuildable `index.db`:**
  - Items, links and annotations as tables.
  - FTS5 table A: `unicode61 remove_diacritics 2` over JS-stemmed text, with the language detected per chunk using `eld` 2.1.0.
  - FTS5 table B: `trigram remove_diacritics 1`, for substrings and German compound parts.
  - Vectors: sqlite-vec `vec0`, brute force over int8 or Matryoshka-truncated vectors, re-scored at full precision.
- **A separate small `state.db`** holds non-rebuildable operational state (job queue, settings).
- **Why:**
  - WAL gives many readers across processes. The UI core, the MCP server and an agent running the `sqlite3` CLI can all read at once, which PGlite's single owner rules out.
  - One file, synchronous, fast, and well known to agents.
  - The schema is plain SQL, so Drizzle 0.45 or Kysely 0.29 are optional.
- **Fallbacks:** keep `node:sqlite` as the zero-native fallback. Switch vectors to vec1 or LanceDB if chunk counts pass roughly 1M (inference).
- **Watcher:** `@parcel/watcher` (snapshot catch-up on start, coalesced events), with chokidar 6 as runner-up once it has matured past its first weeks.
- Runner-up store: PGlite, for its built-in German stemming and pgvector HNSW, at the cost of a single process owning the index.

---

## 5. On-device embeddings

**Transformers.js** 4.3.1 (2026-10-06). v4.0.0 (2026-03-30) brought a new C++ WebGPU runtime, "WebGPU-accelerated models directly in Node, Bun, and Deno", and a "~4x speedup for BERT-based embedding models". v4.3.0 added WebGPU for Safari 26+ ([releases](https://github.com/huggingface/transformers.js/releases)). In Node on macOS arm64, the supported devices are CPU, WebGPU (experimental) and CoreML ([onnx.js](https://raw.githubusercontent.com/huggingface/transformers.js/main/packages/transformers/src/backends/onnx.js)). It depends on onnxruntime-node 1.30.0.

Models (license, created date and parameter counts from the HF API; scores self-reported in the model cards):

| Model | Params | Dims (MRL) | Context | Multilingual score | License | ONNX port |
|---|---|---|---|---|---|---|
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | 596M | up to 1024 (MRL) | 32K | MTEB-ML 64.33 | Apache-2.0 | onnx-community (transformers.js) |
| [harrier-oss-v1-0.6b](https://huggingface.co/microsoft/harrier-oss-v1-0.6b) (Microsoft, 2026-03) | 596M | 1024 | 32K | MMTEB v2 69.0; 270m variant 66.5 at 640 dims | MIT | onnx-community (low adoption) |
| [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) (2026-10) | 744M total, 270M text path | 768 (128/256/512) | 8K | MTEB-ML v2 61.36 | Apache-2.0 | onnx-community; Transformers.js 4.3.1 support |
| [EmbeddingGemma-300m](https://huggingface.co/google/embeddinggemma-300m) | 303M | 768 (MRL) | 2K | 61.15 | Gemma terms | onnx-community |
| multilingual-e5-large-instruct | 560M | 1024 | 512 | 63.22 (Qwen table) | MIT | community |
| bge-m3 | 568M | 1024 (+sparse) | 8K | 59.56 (Qwen table) | MIT | Xenova |
| nomic-embed-text-v2-moe | 475M | 768 | 512 (from memory, **unverified**) | n/a | Apache-2.0 | n/a |
| jina-embeddings-v5-text-small | 596M | n/a | n/a | n/a | **CC-BY-NC-4.0** | n/a |

Speed on Apple Silicon is **unverified** for citegeist's setup. The one data point is a self-reported MLX server claiming about 44K tokens/s for Qwen3-Embedding-0.6B (4-bit, batch 32) on an M2 Max ([repo](https://github.com/jakedahn/qwen3-embeddings-mlx)). Ollama (`/api/embed`) and MLX in the Python worker are the alternatives. MLX is likely the fastest on Apple GPUs, but it ties embeddings to the Python worker.

Rerankers (all Apache-2.0, ONNX ports exist): `bge-reranker-v2-m3` (568M, cross-encoder, simplest in Transformers.js), `Qwen3-Reranker-0.6B` (LLM-style yes/no scoring, needs custom logits code) and `mxbai-rerank-base-v2`. Jina rerankers are CC-BY-NC.

**Recommendation:** put an `Embedder` interface in a utilityProcess with Transformers.js 4.3.
- Default model: Qwen3-Embedding-0.6B, q8, truncated to 512 dims.
- Spike candidates: harrier-oss-v1 (0.6b/270m) for quality and the EmbeddingGemma 2 text path for speed. Pick by a local evaluation: about 50 German and English queries over Jonny's own papers, measuring recall@10 and tokens/s on his Mac.
- Reranking: `bge-reranker-v2-m3` on the top 50.
- Falsifier: if CPU or CoreML throughput is under roughly 2K tokens/s for the chosen model, move bulk embedding to MLX in the Python worker.

---

## 6. Graph visualization

| Library | Status (verified) | Notes |
|---|---|---|
| **sigma.js + graphology** | sigma 4.0.3. 4.0.0 (2026-10-08) is a "complete rewrite" of the programs system: WebGL2 only, SDF labels in WebGL, built-in node dragging, native parallel edges and self-loops, a declarative styles API ([CHANGELOG](https://raw.githubusercontent.com/jacomyal/sigma.js/main/CHANGELOG.md)). graphology 0.26.0. `@react-sigma/core` 6.0.0 | Scales to large graphs. Graphology adds layouts (ForceAtlas2 in a worker), communities and metrics |
| Cytoscape.js | 3.34.4. The WebGL renderer is a provisional "preview" since 3.31, without dashed edges, gradients or source/target labels ([blog](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)) | Richest edge styling on canvas and best layouts. Slower beyond a few thousand elements |
| react-force-graph | 1.48.3 (2D canvas and 3D three.js) | Fastest to prototype, limited control over typed-edge styling |
| Reagraph | 4.32.0, Apache-2.0, depends on three.js and react-three-fiber | Heavy dependency tree |

**Recommendation: sigma.js 4 + graphology.** Native parallel edges cover typed links between the same pair of notes, and the graph needs WebGL scale. Coding agents mostly know the v3 API, so vendor the [v3 to v4 migration guide](https://www.sigmajs.org/how-to/technical/migration-v3-v4/) into repo docs. Runner-up: Cytoscape.js, if edge styling matters more than scale.

---

## 7. Citation tooling

- **citeproc-js**: npm `citeproc` 2.4.63, last published 2023-04-17, license "CPAL-1.0 OR AGPL-1.0". This is still the CSL processor Zotero uses ([repo](https://github.com/Juris-M/citeproc-js)).
- **citation-js**: 0.9.0 (2026-09-18), MIT, with plugins for CSL (wraps citeproc), BibTeX, RIS and DOI.
- **@retorquere/bibtex-parser**: 12.1.13 (2026-10-22), ISC. It drives Better BibTeX imports, has a WASM entry and is parse-only ([README](https://github.com/retorquere/bibtex-parser)). For writing BibTeX, use citation-js `plugin-bibtex` output, or `bibtex-tidy` 1.15.1 for formatting.
- **CSL styles and locales**: CC BY-SA 3.0 ([styles](https://github.com/citation-style-language/styles), [locales](https://github.com/citation-style-language/locales)). Vendor a pinned snapshot.
- **Zotero translation-server**: AGPL-3.0-only, Node. Endpoints `/web`, `/search` (DOI, ISBN, PMID, arXiv), `/import` and `/export`, port 1969 ([repo](https://github.com/zotero/translation-server)). Run it as a separate child process so the AGPL boundary stays at a process edge (inference, not legal advice).
- **Hayagriva**: Rust, MIT/Apache, YAML format, all CSL styles via citationberg. No JS or WASM bindings documented ([repo](https://github.com/typst/hayagriva)). Not a fit for a Node core.

**Recommendation:** store item metadata as CSL-JSON in files. Use citation-js for import and export and citeproc-js (through citation-js or directly) for formatting. Parse imports with bibtex-parser and use translation-server for URL and identifier lookups.

---

## 8. Monorepo and agent-friendly tooling

Verified versions: pnpm 12.15.0, Turborepo 2.11.10, Nx 24.0.0, TypeScript 7.0.2 (native, 2026-07-08), Vitest 5.0.5, Playwright 1.64.1, Biome 2.6.2, ESLint 10.13.0, oxlint 1.89.0, React 19.3.1, Vite 8.3.5, Tailwind 4.3.3, Zod 4.6.7, oRPC 1.16.1, tRPC 11.19.0, Hono 4.13.13, shadcn 4.22.1, Base UI 1.9.0, Radix 1.8.1, MCP SDK 1.32.1 and v2 split packages `@modelcontextprotocol/server` and `/client` at 2.3.1, Claude Agent SDK 0.3.309.

- **Monorepo:** pnpm workspaces plus Turborepo, for its small config and cached `build`/`test`/`lint` tasks. Nx is more capable but heavier, which a single-developer repo does not need (inference).
- **Tests:**
  - Vitest 5 requires Node 22.12+ and Vite 6.4+. It is up to 53% faster and adds a Browser Mode trace view, `vi.when`, and unawaited assertions failing tests ([blog](https://vitest.dev/blog/vitest-5)).
  - Vitest 4 made Browser Mode stable and added `toMatchScreenshot` and Playwright traces ([blog](https://vitest.dev/blog/vitest-4)).
  - Use Vitest unit tests for the core, Vitest Browser Mode with the Playwright provider for renderer components (pdf.js layer, CM6 extensions), and Playwright `_electron` for a thin E2E layer.
- **Lint and format:**
  - Biome 2 is fast and has type-aware rules without tsc. Its `noFloatingPromises` catches "about 75%" of what typescript-eslint catches ([blog](https://biomejs.dev/blog/biome-v2/)).
  - Pair it with `tsc` 7 for type checking. Add typescript-eslint only if a specific rule is missing.
- **Typed IPC:**
  - Use oRPC with its MessagePort adapter (`@orpc/server/message-port`, documented Electron main/preload/renderer setup) ([docs](https://orpc.dev/docs/adapters/electron)). The same router can also be served over HTTP for the headless mode.
  - electron-trpc (0.7.1, 2024-12-07) is stale. `trpc-electron` 0.1.2 is a small fork.
  - Hono RPC would add a localhost HTTP server for no gain inside the app.
- **Schemas:** Zod 4's native `z.toJSONSchema()` (targets draft-2020-12, draft-07, openapi-3.0) ([docs](https://zod.dev/json-schema)) is the single source for MCP tool schemas, IPC, file formats (annotations.json, CSL-JSON wrappers) and the Python worker. For the worker, generate Pydantic 2 models with datamodel-code-generator 0.86.0.
- **UI:** shadcn/ui on Tailwind v4. Since July 2026 its default primitive layer is Base UI, and components support Base UI, React Aria and Radix ([changelog](https://ui.shadcn.com/docs/changelog)). Add TanStack Table 9 and TanStack Virtual for the library table.
- **Agent debugging:** launch dev Electron with `--remote-debugging-port`, and agents attach through Playwright MCP `--cdp-endpoint`.

---

## 9. Recommended stack

| Layer | Choice | Runner-up | Decisive reason |
|---|---|---|---|
| Shell | Electron 45 + electron-vite + electron-builder | Tauri v2 (once its CEF runtime ships) | Chromium for pdf.js, in-process Node, Playwright/CDP testability |
| Core runtime | TS core in `utilityProcess`, also runnable headless under Node | Separate Node daemon | One codebase. Agents and CI can test it without the UI |
| Python worker | `uv`-managed venv, JSON-RPC over stdio, Pydantic models generated from Zod JSON Schema | HTTP worker | Simple supervision from TS, typed boundary |
| PDF | pdfjs-dist 6 + own highlight layer + Floating UI | EmbedPDF 2.x | DOM text layer, native Selection API, testable DOM |
| Notes | CodeMirror 6 + custom live preview | Milkdown 7 | Text is the document: lossless, clean merges of agent edits |
| Index | SQLite (better-sqlite3 13) + FTS5 (unicode61 on stemmed text + trigram) + sqlite-vec | PGlite 0.5 + pgvector | Multi-process readers in WAL, one rebuildable file |
| Watcher | @parcel/watcher 2.6 | chokidar 6 | FSEvents snapshot catch-up after downtime |
| Embeddings | Transformers.js 4.3, Qwen3-Embedding-0.6B q8 @512d | harrier-oss-v1 / EmbeddingGemma 2; MLX in the worker | Apache-2.0, strong multilingual score, ONNX port |
| Reranker | bge-reranker-v2-m3 | Qwen3-Reranker-0.6B | Plain cross-encoder, multilingual, Apache-2.0 |
| Graph | sigma.js 4 + graphology | Cytoscape.js | WebGL scale, parallel typed edges |
| Citations | CSL-JSON files + citation-js + citeproc-js + bibtex-parser; translation-server as child process | Hayagriva (no JS bindings) | De facto CSL engine, Zotero-compatible metadata |
| Monorepo | pnpm + Turborepo | Nx | Minimal config |
| Tests | Vitest 5 (unit + Browser Mode) + Playwright `_electron` | WebdriverIO | One Playwright toolchain from components to E2E |
| Lint/types | Biome 2 + tsc 7 | ESLint 10 + typescript-eslint | Speed for agent loops |
| IPC | oRPC (MessagePort) | trpc-electron | Maintained, Electron adapter, same router over HTTP |
| Schemas | Zod 4 + `toJSONSchema` | Valibot | One schema source for MCP, IPC, files and the Python side |
| UI kit | shadcn/ui (Base UI) + Tailwind v4 + TanStack Table/Virtual | Radix-based shadcn | Current shadcn default |

## Main risks

1. **Playwright's Electron support is labeled experimental.** Mitigation: keep most UI tests in Vitest Browser Mode against the plain renderer, and keep E2E thin.
2. **Electron's 8-week majors and native modules.** better-sqlite3's N-API switch is only "theoretically" ABI-stable, and Electron prebuilds have broken before (12.11.0 was "NOT A VIABLE RELEASE"). Pin versions and run E2E smoke tests on every Electron bump.
3. **Young dependencies.**
   - sqlite-vec is pre-v1 and vec1 lacks testing. Keep vectors behind an interface, so a model or store change only means reindexing.
   - sigma 4 is two weeks old and chokidar 6 four days old.
   - EmbeddingGemma 2 is about two weeks old.
4. **Highlight anchoring.** pdf.js text-layer changes, or reconversion of the HTML, can shift offsets. Store quote selectors and re-anchor fuzzily.
5. **German search quality.** It depends on JS-side stemming plus trigram. Validate it on a real German query set before committing.
6. **AGPL components** (zotero/reader if adopted, translation-server). Keep them out of process or out of the bundle if citegeist is ever distributed.
7. **Auto-update on macOS needs a Developer ID** ($99/year) for Squirrel. Without one, updates are manual rebuilds.
8. **Unverified items:** Electron's exposure of `node:sqlite`, whether WebKit's total-canvas-memory cap is still current, embedding throughput on Jonny's Mac, Electrobun and Bun compatibility with the Node SDKs, and Electron versus WKWebView RAM for this app.

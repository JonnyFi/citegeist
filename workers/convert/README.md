# citegeist-convert

Python conversion worker. It speaks JSON-RPC 2.0 over stdio, one JSON object per line, with the two methods of `packages/schema/src/worker.ts`: `health` and `convert`. All outputs of a conversion land in `outDir`: `manifest.json` (written last), `pages.json`, `blocks.jsonl`, `idmap.json`, `refs.jsonl`, `doc.md`, `doc.html`, `assets/`, and `header.json` when a header was found.

```
cd workers/convert && uv sync
uv run python -m citegeist_convert                 # serve on stdio
uv run python -m citegeist_convert convert '{"sourcePath":"/x.pdf","source":"0123456789ab","outDir":"/tmp/out","kind":"pdf"}'
uv run python -m citegeist_convert download-models # layout and table models, about 1 GB
uv run python -m citegeist_convert install-grobid  # native GROBID, about 1 GB of downloads, a few minutes
```

## Paths

| `kind` | Path | Notes |
|---|---|---|
| `pdf` | digital | Docling with OCR off. The text layer must pass the dictionary gate (hit rate 0.6). |
| `pdf` | scan | Docling with Apple Vision OCR. Chosen when there is no text layer or it fails the gate, or with `ocr: "force"`. Pages below the gate are flagged (`low-quality`, `low-quality-pages:`). |
| `arxiv-html` | arxiv | LaTeXML cleanup. Pages come from the arXiv PDF when `pdfPath` is passed or `<name>.pdf` sits next to the HTML. |
| `web` | web | trafilatura, no pages. |

Formula enrichment runs on a second pass over the pages that contain formula blocks (digital path only). Switch with `CITEGEIST_FORMULAS=off|auto`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `CITEGEIST_MODELS_DIR` | `~/Library/Application Support/citegeist/models` | Machine-local models: Docling (pinned commits) and GROBID with its JRE |
| `CITEGEIST_GROBID` | `auto` | `auto` uses an installed GROBID, `install` installs it on first use, `off` skips it |
| `CITEGEIST_GROBID_URL` | unset | Use a running GROBID service instead (Docker, for example) |
| `CITEGEIST_FORMULAS` | `auto` | `off` skips formula enrichment |
| `CITEGEIST_FORMULA_MAX_PAGES` | `60` | Cap for the formula pass |
| `CITEGEIST_IDLE_SECONDS` | `600` | The worker exits after this long without a request |

Progress during a convert is sent as notifications `{"jsonrpc":"2.0","method":"progress","params":{"id":<request id>,"message":"...","fraction":0.4}}`. Logs go to stderr.

## Tests

```
uv run pytest                 # default: unit tests, the fast fixtures, golden doc.md, JSON-RPC round trip (about 2 minutes)
uv run pytest -m slow         # the remaining fixtures of fixtures/pdf/manifest.json and formula enrichment
uv run pytest -m ''           # everything
```

Fixtures are fetched with `node fixtures/pdf/fetch.mjs`; tests skip when a fixture, the network or the models are unavailable. Models for the tests live in `~/.cache/citegeist-test-models` (override with `CITEGEIST_MODELS_DIR`). The native GROBID integration test is opt-in: `CITEGEIST_TEST_GROBID=install uv run pytest tests/test_grobid.py`.

The JSON Schema snapshot `src/citegeist_convert/schemas.json` comes from `packages/schema`: refresh it with `node workers/convert/scripts/export-schemas.mjs` (a test fails when it is stale). Regenerate the golden files with `UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py`.

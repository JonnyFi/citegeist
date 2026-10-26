# Third-party licenses

citegeist is licensed under Apache-2.0 (`LICENSE`). The attribution that third-party material asks for is in `NOTICE`, which the packaged app ships next to `LICENSE`. This page is a technical inventory, not legal advice.

## Policy

- GPL, AGPL and SSPL dependencies are not bundled with citegeist and are not linked into any citegeist process.
- Copyleft tools run as separate processes that citegeist starts with command line arguments and files. They are downloaded on the user's machine or installed by the user, and citegeist does not ship them. Pandoc (GPL) and the Temurin JRE (GPL with Classpath Exception) work this way.
- LGPL dependencies are not bundled either. The only one that was in the app, libvips through `sharp`, is replaced by a stub (see "sharp and libvips").
- File-level copyleft (MPL-2.0, CPAL-1.0) is acceptable for unmodified packages. Changes to such files are published under the same license.
- Where a package offers a choice of licenses, citegeist uses the permissive option and says so in `NOTICE`.
- Proprietary components are listed in `NOTICE` and in `scripts/license-allowlist.json` with the reason.

## License check

`pnpm verify` runs `scripts/check-licenses.mjs`. It reads

- the production dependencies of the whole workspace from `pnpm licenses list --prod --json`, and
- the locked runtime dependencies of `workers/convert` and `workers/research` (`uv export --no-dev`), with license metadata from the installed worker environments (`scripts/py-licenses.py`).

The check fails on GPL, AGPL, LGPL, SSPL and on unknown licenses. An `OR` expression passes when one option is permissive, an `AND` expression needs all parts to pass. A package that has to be accepted anyway goes into `scripts/license-allowlist.json` with the exact license string the check saw and a reason, so a license change fails the check again. A new entry also needs a line in `NOTICE`. The check runs offline once `pnpm install` and the `uv` environments exist.

## Notable dependencies

| Component | License | How it is used |
|---|---|---|
| citeproc-js 2.4.63 (through `@citation-js/plugin-csl`) | CPAL-1.0 OR AGPL | Bundled, unmodified. citegeist uses the CPAL option. License text ships in `Resources/licenses` |
| CSL styles and locales (`packages/cite/src/vendor`) | CC BY-SA 3.0 | Bundled as separate data files, unmodified. Authors are named in `NOTICE` and in the files |
| Fonts Inter, Newsreader, JetBrains Mono (Fontsource) | OFL-1.1 | Bundled in the renderer. OFL texts ship in `Resources/licenses/fonts` |
| `@anthropic-ai/claude-agent-sdk` | Proprietary (Anthropic legal agreements) | Bundled JavaScript, unmodified, through `claude-agent-acp`. Use falls under Anthropic's Commercial Terms. The Claude Code binary is not bundled |
| `@agentclientprotocol/*` adapters, `@openai/codex` | Apache-2.0 | Bundled JavaScript. The Codex binary is excluded from the app |
| `sharp` (through `@huggingface/transformers`) | Apache-2.0, with LGPL-3.0 libvips | Replaced by `stubs/sharp`, so neither is in the app |
| ONNX Runtime, `better-sqlite3`, `sqlite-vec`, `@parcel/watcher`, `@napi-rs/canvas`, `pdfjs-dist` | MIT, Apache-2.0 | Bundled, native parts unpacked from the archive |
| `workers/research` | Apache-2.0 | Part of citegeist. Contributed by its author under Apache-2.0 (issue #50) |
| `workers/research/vendor/opendraft` | Apache-2.0 bundle, derived from MIT-licensed OpenDraft | In the repository, not in the app yet. Keeps its `LICENSE` and `THIRD_PARTY_NOTICES.md` |
| Docling and its models | MIT code. Models Apache-2.0 and CDLA-Permissive-2.0 | Python packages from PyPI and models from Hugging Face, both fetched on the user's machine |
| `certifi`, `tqdm` (Python) | MPL-2.0 | Installed by `uv` on the user's machine, unmodified |
| `tld` (Python, through trafilatura) | MPL-1.1 OR GPL-2.0 OR LGPL-2.1+ | citegeist uses the MPL-1.1 option. Installed by `uv` on the user's machine |
| `opencv-python-headless`, `torch`, `numpy`, `pypdfium2` (Python) | Apache-2.0, BSD, bundled libraries (OpenCV wheels include LGPL FFmpeg) | Installed by `uv` from PyPI on the user's machine. citegeist does not redistribute the wheels |
| GROBID | Apache-2.0 | Runtime download, built from the release archive (pinned checksum), separate process on 127.0.0.1 |
| Eclipse Temurin JRE 21 | GPL-2.0 with Classpath Exception | Runtime download (pinned checksum) for GROBID, separate process. The exception allows programs under any license |
| Pandoc 3.12.1 | GPL-2.0-or-later | Runtime download on request (pinned checksum) or the user's own installation. Separate process, never linked, not shipped. The license covers the program, not the files it produces |
| Claude Code, Codex CLI, Cursor CLI | The vendors' terms | Installed by the user, called through the ACP adapters |
| Zotero Connector | AGPL-3.0 | The user's browser extension, talks to citegeist over the Connector protocol. citegeist contains no Zotero code |

## Models downloaded at run time

Weights are fetched from Hugging Face at a pinned revision when the feature is used. They are not in the repository or in the app.

| Model | License | When |
|---|---|---|
| EmbeddingGemma 300M (`onnx-community/embeddinggemma-300m-ONNX`) | Gemma Terms of Use and Prohibited Use Policy | Default of the semantic search |
| Qwen3-Embedding-0.6B (`onnx-community/Qwen3-Embedding-0.6B-ONNX`) | Apache-2.0 per the original model; the ONNX card has no license field | Setting for the semantic search |
| bge-reranker-v2-m3 (`onnx-community/bge-reranker-v2-m3-ONNX`) | Apache-2.0 per `BAAI/bge-reranker-v2-m3`; the ONNX card has no license field | Setting that re-ranks hits (off by default) |
| bge-reranker-base (`Xenova/bge-reranker-base`), mxbai-rerank-xsmall-v1, EmbeddingGemma 2 | MIT, Apache-2.0, Apache-2.0 | Only `pnpm eval:retrieval` in a development checkout |
| docling-layout-heron, docling-models, CodeFormulaV2 | Apache-2.0, CDLA-Permissive-2.0 | Document conversion, on first import |

EmbeddingGemma is not under an open source license. Its terms say that the Gemma Terms of Use must reach everyone who receives the weights, and the download happens on the user's machine from Hugging Face, where the terms are shown. `NOTICE` links the Terms of Use and the Prohibited Use Policy. The decision for the release is that the UI shows no extra hint before the download.

The license of Qwen3-Embedding-0.6B should be checked against the model card of `Qwen/Qwen3-Embedding-0.6B` before it is promoted from a setting to the default.

## sharp and libvips

`@huggingface/transformers` imports `sharp` when the module loads, to decode images for vision models. citegeist runs text embeddings and rerankers only, which never call it. The real package brings `@img/sharp-libvips-darwin-arm64` (LGPL-3.0-or-later) into the app. A pnpm override (`pnpm-workspace.yaml`) therefore links `stubs/sharp`, a module that only has to exist, and `electron-builder.yml` adds it to the archive. Using an image model would fail with an explicit error. The real default model (EmbeddingGemma) was run against the stub.

## Test data

`fixtures/pdf/manifest.json` records the license and the evidence for every fixture PDF (CC BY 4.0, CC BY-SA 4.0, public domain). The PDFs are not committed; `fixtures/pdf/fetch.mjs` downloads them and checks the checksum. The six converted texts in `fixtures/retrieval/corpus` come from CC BY 4.0 works, and `NOTICE` gives authors, titles, DOIs and source URLs. Some manifest entries carry a note to verify the license before redistribution; those PDFs are only downloaded, never committed.

## Zotero

citegeist contains and starts no Zotero component. The Connector protocol on port 23119 is implemented from scratch in `packages/server/src/connector`; the translators run in the browser extension of the user. `packages/import/src/zotero/mapping.ts` has its own tables with the same facts (type names, field mapping) and no file from `zotero-schema`. The online services of Zotero are not called, and the name is used descriptively only. Anyone who connects Zotero's translation-server later runs it as a separate process or container behind a local HTTP interface and lets the user install it.

## Checklist for a release

1. `LICENSE` and `NOTICE` are in the app (`Contents/Resources`), together with `licenses/fonts` and `licenses/citeproc-LICENSE.txt`. Electron's `LICENSES.chromium.html` stays; `afterPack` does not delete it.
2. `pnpm verify` is green, including the license check.
3. New dependencies are in `NOTICE` when they need attribution. New GPL, AGPL or SSPL packages stop the release.
4. The Claude Code binary stays out of the package. "Claude Code" and Anthropic names or logos do not appear in the name or logo of the app.

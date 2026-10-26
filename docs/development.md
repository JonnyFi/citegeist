# Development

## Prerequisites

- macOS on Apple Silicon.
- Node 22 or newer and pnpm 10 (the repository pins `pnpm@10.33.2` in `package.json`).
- [uv](https://docs.astral.sh/uv/) for the Python workers (`brew install uv`).
- For the chat and the AI tasks, one of the agent command line tools you are logged in to (`claude auth login`, `codex login`, `agent login`), or an API key. The tests need none of them.

```sh
pnpm install
cd workers/convert && uv sync
```

`pnpm install` also activates the pre-push hook (`git config core.hooksPath .githooks`), which runs `pnpm verify` before every push.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/schema` | Zod schemas and the JSON Schema export |
| `packages/ops` | The operations registry and the contracts of every operation |
| `packages/core` | Store, index, watcher, jobs and services |
| `packages/metadata` | Metadata resolvers and merge |
| `packages/cite` | CSL, BibTeX, RIS, citekeys and citation export |
| `packages/import` | Importers for Zotero, BibTeX, RIS and CSL-JSON |
| `packages/embed` | Local embedding models and the reranker |
| `packages/ai` | Inference backends, AI tasks and evals |
| `packages/mcp` | The MCP server, built on the operations |
| `packages/chat` | Agent chat over ACP, turn undo and research jobs |
| `packages/webhooks` | Signing, payloads and the connector protocol |
| `packages/server` | The core process: HTTP, oRPC, WebSocket, lockfile and chat wiring |
| `packages/anchoring` | Anchor library for highlights (pure TypeScript) |
| `packages/reader` | PDF and text view with the highlight layer |
| `packages/editor` | Markdown editor with citation completion |
| `apps/cli` | The `cg` command, including `cg mcp` |
| `apps/ui` | The React renderer. It also runs in a browser against a mock core |
| `apps/desktop` | Electron main process and preload |
| `workers/convert` | Python worker (uv): Docling, GROBID, OCR, arXiv, web |
| `workers/research` | Python scripts of the literature search |
| `skills/citegeist` | The agent skill and the `.mcpb` bundle |
| `fixtures` | CC-BY PDFs, recorded HTTP responses and expected outputs |
| `docs` | This handbook |

[architecture.md](architecture.md) explains how the parts fit together. Packages export TypeScript source from `src/index.ts`, and tests sit next to the code as `*.test.ts`.

## Running the app from source

```sh
pnpm install
pnpm --filter @citegeist/ui dev
ELECTRON_RENDERER_URL=http://localhost:5173 pnpm --filter @citegeist/desktop dev
```

The first `dev` command starts the Vite server of the UI. The second starts Electron with hot reload for the main process and the core. Without `ELECTRON_RENDERER_URL`, Electron loads the built UI from `apps/ui/dist` (run `pnpm --filter @citegeist/ui build` first). You choose the library in the welcome window. To open a specific library directly, set `CITEGEIST_LIBRARY=/path/to/library`.

The UI also runs in a browser against a mock core: `pnpm --filter @citegeist/ui dev:mock`.

Environment variables for development and tests:

| Variable | Effect |
|---|---|
| `CITEGEIST_LIBRARY` | The library to open (the `cg` default is `~/Citegeist`) |
| `CITEGEIST_LOCAL_BASE` | Folder for the index and the lock file, default `~/Library/Application Support/citegeist` |
| `CITEGEIST_USER_DATA` | Electron data folder. It separates the settings and the single-instance lock |
| `CITEGEIST_WORKER_DIR` | Source folder of the Python worker, default `workers/convert` in the repository |
| `CITEGEIST_AI_MOCK=1` | Every AI task answers with fixed texts |
| `CITEGEIST_SKIP_MODELS=1` | Tests never load a model (CI sets this) |

To check that the core is running, call its health endpoint. The port and token are in the lock file of the library:

```sh
DIR=~/Library/Application\ Support/citegeist/<library-id>
curl -H "authorization: Bearer $(cat $DIR/core.token)" http://127.0.0.1:$(jq .port $DIR/core.lock)/health
```

## Building the app

```sh
pnpm package
open apps/desktop/dist/mac-arm64/citegeist.app
```

`pnpm package` builds the UI and the Electron bundles and writes an arm64 `citegeist.app`. The app is not notarized. It is signed ad hoc, or with a stable identity when you created one (see below). On the Mac that built it, the app starts without a prompt. On another Mac, Gatekeeper blocks it until you open it with right click and "Open". The install script avoids Gatekeeper altogether.

The package contains the sources of the Python worker (`Contents/Resources/workers/convert`), the CSL styles, the native modules and the two ACP adapters as JavaScript. The command line tools of Claude Code and Codex are not included. citegeist starts the ones you installed and looks for them in the `PATH` and in `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`. Without a tool, the settings show the install and login commands, and the chat reports the error `CHAT_CLI_MISSING`.

To rebuild and replace the installed app from a checkout:

```sh
pnpm app:update
```

This fetches the latest `main`, builds the app, quits the running citegeist, replaces `/Applications/citegeist.app` and starts it again. The library and the settings live outside the app and stay as they are. When `main` is checked out in another worktree, the update runs there, and that worktree must be clean apart from untracked files.

### Stable signing identity

An ad hoc signature changes with every build. macOS ties the Accessibility permission (needed for quick insert) and Keychain access to the signature, so both are lost after each `pnpm app:update`. A self-signed identity keeps the signature the same:

```sh
sh scripts/make-signing-cert.sh
```

The script creates the identity "citegeist local signing" once in your login keychain. macOS asks for your login password to trust the certificate. `pnpm package` then signs with it (`scripts/package-mac.sh` looks it up by name). `CITEGEIST_SIGNING_IDENTITY=-` forces an ad hoc signature, and any other value names a different identity. On the first build macOS asks whether `codesign` may use the key. Enter the password and choose "Always Allow". Choosing "Allow" makes the question return for every file of the app. Afterwards, grant the Accessibility permission one last time.

The identity is not a Developer ID and never leaves the keychain. Users who install a release built with it keep their permissions across updates.

## Tests

```sh
pnpm verify
```

`pnpm verify` runs `biome check`, `tsc --noEmit` in every package, vitest in every package, and pytest for `workers/convert` and `workers/research`. It must pass before every commit, and the pre-push hook enforces it. You can skip the hook once with `git push --no-verify`.

| Command | Effect |
|---|---|
| `pnpm lint` | `biome check .` |
| `pnpm format` | `biome format --write .` |
| `pnpm typecheck` | `tsc --noEmit` in every package through turbo |
| `pnpm test` | vitest in every package |
| `pnpm --filter @citegeist/<name> test` | One package only |
| `pnpm test:convert`, `pnpm test:research` | pytest for one worker |
| `pnpm --filter @citegeist/desktop test:e2e` | Playwright end-to-end tests of the Electron app |

CI runs `pnpm verify` on Linux with `PYTEST_ADDOPTS="-m 'not slow and not network'"` and `CITEGEIST_SKIP_MODELS=1`. Tests that need model downloads or the network are skipped there. Run them locally with `uv run pytest -m ''` in `workers/convert`.

### Fixtures

`fixtures/` holds the material that tests share:

- `fixtures/pdf` lists CC-BY PDFs in `manifest.json`. `node fixtures/pdf/fetch.mjs` downloads them, and tests skip when a fixture is missing.
- `fixtures/metadata/http` holds recorded HTTP responses of the metadata services.
- `fixtures/retrieval` holds the search test set (see below).
- `fixtures/web` holds a saved web page.

Real library data never goes into the repository.

### Search evaluation

A test set of 43 queries over six CC-BY documents (`fixtures/retrieval/`) runs in `pnpm verify`. It fails when hit@5 or MRR fall below the bar in `fixtures/retrieval/baseline.json`. When the embedding model is in the local cache (`~/Library/Caches/citegeist-embed-eval` or the model folder of the app), the test checks the hybrid search. Otherwise it checks the full-text search only. With `CITEGEIST_SKIP_MODELS=1` it never loads a model.

```sh
pnpm eval:retrieval --golden                  # the repository test set, full text and hybrid
pnpm eval:retrieval --golden --record         # store the numbers as the new bar
pnpm eval:retrieval --golden --rerank bge-reranker-v2-m3
pnpm eval:retrieval --library ~/Citegeist --queries ~/queries.json
```

The last form measures a real library. The queries live in a file outside the repository. The script only reads the library and works on a copy of the index from the app folder, so vectors that exist already are reused. The queries file is a JSON array or `{ "queries": [...] }`:

```json
[
  {
    "id": "q1",
    "lang": "en",
    "kind": "conceptual",
    "q": "How does the share of smoking teenagers change?",
    "expect": [
      { "item": "lampert2019gesundheitliche", "contains": "sharp decline" },
      { "item": "another-citekey" }
    ]
  }
]
```

`item` is the citekey and `contains` a text snippet of the passage that answers the query. Without `contains`, any hit of the item counts. A query is answered when one of the entries is among the first k hits. The output has hit@1, hit@3, hit@5, hit@10, MRR and the duration per search, split by language and kind of query.

| Option | Effect |
|---|---|
| `--mode fts\|hybrid\|both` | Which search to measure, default `both` |
| `--model <key>` | Embedding model from `MODELS`, default `DEFAULT_MODEL` |
| `--models-dir <folder>` | Read models from there, download missing ones there |
| `--kinds block,item,card,note` | Which hits count, default with `--library`: `item,card,block` |
| `--rerank <key>` | Also measure with a reranker (`--rerank-top` and `--rerank-tokens` tune it) |
| `--details` | The rank of every single query |
| `--json` | The numbers as JSON |

When the way passages are embedded changes (heading path, model), the next index update re-embeds only the chunks whose input changed. After a switch to the heading path that is every passage of converted documents. This runs in the background and takes roughly 7 minutes for 10,000 passages on an M4 Pro. See [ADR 0026](decisions/0026-retrieval-benchmark.md).

### AI evals

`pnpm --filter @citegeist/ai eval -- --task card.paraphrase --backend claude --max-calls 5` runs the eval of an AI task against a real backend. It spends model calls and is not part of CI. Backends are `claude`, `codex`, `cursor` and the OpenAI-compatible presets (`openai`, `anthropic`, `openrouter`, `xai`, `ollama`, with the key in `CITEGEIST_API_KEY`).

### Python workers

`workers/convert/README.md` documents the conversion worker: its paths (digital, scan, arXiv, web), environment variables, tests and the golden files. The JSON Schema snapshot of the worker comes from `packages/schema` (`node workers/convert/scripts/export-schemas.mjs`).

## Secrets

`pnpm secrets` scans the working tree with [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`), configured in `.gitleaks.toml`. It skips with a hint when gitleaks is not installed. Run it before you open a pull request.

## Releases

Releases are built on the maintainer's Mac and published with the GitHub CLI. The version is in `apps/desktop/package.json`.

```sh
pnpm release --dry-run   # runs every check and prints the steps
pnpm release             # builds, packs, writes the checksum, creates the GitHub release
```

`scripts/release.sh` refuses to run on a dirty working tree, when the tag `v<version>` exists locally or on `origin`, and when `HEAD` is not on `origin`. It needs a logged-in `gh`. The steps are `pnpm package`, a zip with `ditto`, a `.sha256` file and `gh release create`. `install.sh` downloads the zip and the checksum of the latest release. Bump the version before the release, and sign with the stable identity so that users keep their macOS permissions.

[maintainers.md](maintainers.md) lists what only maintainers change.

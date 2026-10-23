# citegeist

citegeist is a macOS research library app: PDFs, notes and citations live as plain files in a folder, and an index plus AI agents work on top of them.
The core is TypeScript on Node, conversion runs in a Python worker, and the UI ships in Electron.

## Module map

| Path                 | Purpose                                                    | Owner workstream |
| -------------------- | ---------------------------------------------------------- | ---------------- |
| `packages/schema`    | Zod schemas, JSON Schema export (hotspot)                  | W0.2             |
| `packages/ops`       | Operations registry and contracts (hotspot)                | W0.2             |
| `packages/core`      | Store, index, watcher, jobs, services                      | W1.1             |
| `packages/metadata`  | Resolvers and merge                                        | W1.2             |
| `packages/cite`      | CSL, BibTeX, RIS, citekeys, citation export                | W1.4             |
| `packages/ai`        | Inference backends, tasks, evals                           | W1.5             |
| `packages/mcp`       | MCP server built on ops                                    | W1.8             |
| `packages/anchoring` | Anchor library (pure TypeScript)                           | W1.6             |
| `packages/reader`    | PDF and text view with highlight layer                     | W1.6             |
| `apps/cli`           | `cg` command, including `cg mcp`                           | W1.8             |
| `apps/ui`            | React renderer, also runs in a browser against a mock core | W1.7             |
| `apps/desktop`       | Electron main and preload                                  | W1.7             |
| `workers/convert`    | Python (uv): Docling, GROBID, OCR, arXiv, web              | W1.3             |
| `fixtures/`          | CC-BY PDFs, recorded HTTP, expected outputs                | W0.3             |
| `docs/`              | Product, architecture, decisions, plan                     | Lead             |

## Hotspots

Only the lead session changes these. Other workstreams ask for a change instead of making it.
- `packages/schema`
- `packages/ops/src/contracts`
- root `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- `CLAUDE.md`
- `.github/workflows`

If your workstream needs a new dependency, add it to your own package's `package.json` and report it to the lead, who updates the lockfile.

## Commands

```
pnpm install                              install all JS dependencies
pnpm verify                               biome check, typecheck, vitest, pytest (must pass before every commit)
pnpm lint                                 biome check .
pnpm format                               biome format --write .
pnpm typecheck                            tsc --noEmit in every package via turbo
pnpm test                                 vitest run in every package via turbo
pnpm --filter @citegeist/<name> test      one package only
cd workers/convert && uv sync             set up the Python worker
cd workers/convert && uv run pytest       run the worker tests
```

## Conventions

- Code, comments, file names and commit messages are English. The docs in `docs/` are German.
- Never use em dashes in any text: code, comments, docs, commit messages, chat.
- TypeScript is strict (`tsconfig.base.json`). Each package has its own `tsconfig.json` extending it.
- Package names are `@citegeist/<name>`. Packages export TypeScript source from `src/index.ts`.
- Tests sit next to the code as `*.test.ts`. Python tests live in `workers/convert/tests`.
- Stay inside the directories your workstream owns. Never edit hotspots.
- Coding agents default to Sonnet. Use a larger model only when the lead says so.
- Commit on your own branch. End commit messages with the Co-Authored-By line given by the session.

## Workflow (gstack)

1. `/spec` turns the workstream into an executable spec.
2. Build against fixtures and mocks, and run `pnpm verify` until green.
3. `/review` checks the diff before landing.
4. `/qa` exercises the running app or CLI.
5. `/ship` creates the PR.

## Docs

- [docs/product.md](docs/product.md): product scope and open questions
- [docs/architecture.md](docs/architecture.md): architecture, data model, tech stack, risks
- [docs/decisions.md](docs/decisions.md): decision log
- [docs/development-plan.md](docs/development-plan.md): waves, workstreams, repo structure
- [docs/README.md](docs/README.md): index

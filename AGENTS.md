# citegeist

Shared instructions for all coding agents (Claude Code, Cursor, Codex). `CLAUDE.md` imports this file and adds the gstack install check.

citegeist is a macOS research library app: PDFs, notes and citations live as plain files in a folder, and an index plus AI agents work on top of them.
The core is TypeScript on Node, conversion runs in a Python worker, and the UI ships in Electron.

## Module map

| Path                 | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `packages/schema`    | Zod schemas, JSON Schema export                            |
| `packages/ops`       | Operations registry and contracts                          |
| `packages/core`      | Store, index, watcher, jobs, services                      |
| `packages/metadata`  | Resolvers and merge                                        |
| `packages/cite`      | CSL, BibTeX, RIS, citekeys, citation export                |
| `packages/import`    | Zotero, BibTeX, RIS and CSL-JSON importers                 |
| `packages/embed`     | Local embedding models and reranker                        |
| `packages/ai`        | Inference backends, tasks, evals                           |
| `packages/mcp`       | MCP server built on ops                                    |
| `packages/chat`      | Agent chat over ACP, turn undo, research jobs              |
| `packages/webhooks`  | Webhook signing, payloads, connectors                      |
| `packages/server`    | Core process: HTTP/oRPC/WebSocket, lockfile, chat wiring   |
| `packages/anchoring` | Anchor library (pure TypeScript)                           |
| `packages/reader`    | PDF and text view with highlight layer                     |
| `packages/editor`    | Markdown editor with citation completion                   |
| `apps/cli`           | `cg` command, including `cg mcp`                           |
| `apps/ui`            | React renderer, also runs in a browser against a mock core |
| `apps/desktop`       | Electron main and preload                                  |
| `workers/convert`    | Python (uv): Docling, GROBID, OCR, arXiv, web              |
| `workers/research`   | Python (uv): literature search scripts                     |
| `skills/citegeist`   | Agent skill and `.mcpb` bundle                             |
| `fixtures/`          | CC-BY PDFs, recorded HTTP, expected outputs                |
| `docs/`              | Handbook, specs, architecture, decisions                   |

## Maintainer-owned files

These files shape every package, so only maintainers change them. If your change needs one of them, say so in the issue or the pull request and a maintainer makes the change or agrees to it in your PR.

- `packages/schema`
- `packages/ops/src/contracts`
- root `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- `AGENTS.md`
- `CLAUDE.md`
- `.github/workflows`

If you need a new dependency, add it to the `package.json` of your own package and mention it in the pull request. A maintainer updates the lockfile. [docs/maintainers.md](docs/maintainers.md) has the details.

## Commands

```
pnpm install                              install all JS dependencies
pnpm verify                               biome check, typecheck, vitest, pytest (must pass before every commit; the pre-push hook enforces it)
pnpm package                              build the unsigned arm64 citegeist.app (apps/desktop/dist)
pnpm lint                                 biome check .
pnpm format                               biome format --write .
pnpm typecheck                            tsc --noEmit in every package via turbo
pnpm test                                 vitest run in every package
pnpm --filter @citegeist/<name> test      one package only
cd workers/convert && uv sync             set up the Python worker
cd workers/convert && uv run pytest       run the worker tests
```

[docs/development.md](docs/development.md) describes running the app from source, tests, evals and releases.

## Conventions

- Code, comments, file names, commit messages and docs are English.
- Never use em dashes in any text: code, comments, docs, commit messages, chat.
- TypeScript is strict (`tsconfig.base.json`). Each package has its own `tsconfig.json` extending it.
- Package names are `@citegeist/<name>`. Packages export TypeScript source from `src/index.ts`.
- Tests sit next to the code as `*.test.ts`. Python tests live in `workers/convert/tests`.
- Stay inside the directories your change needs. Do not edit maintainer-owned files without agreement.
- Work on your own branch and open a pull request against `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).
- End commit messages with the Co-Authored-By line given by your session when an agent wrote the change.
- Documentation changes follow the same rules as code: record a decision in `docs/decisions/` when you change one.

## Workflow (gstack)

gstack is required for AI-assisted work in this repo, in every tool. Before doing any work, check that it is installed:

```bash
_GS=""
for _D in "${GSTACK_ROOT:-}" "$HOME/gstack" "$HOME/.claude/skills/gstack" "$HOME/.codex/skills/gstack" "$HOME/.cursor/skills/gstack" "$HOME/.config/opencode/skills/gstack" "$HOME/.copilot/skills/gstack" "$HOME/.factory/skills/gstack" "$HOME/.kiro/skills/gstack" "$HOME/.gemini/antigravity-cli/skills/gstack" "$HOME/.gstack/repos/gstack"; do
  [ -z "$_GS" ] && [ -n "$_D" ] && [ -d "$_D/bin" ] && _GS="$_D"
done
[ -n "$_GS" ] && echo "GSTACK_OK: $_GS" || echo "GSTACK_MISSING"
ls -d "${CODEX_HOME:-$HOME/.codex}"/skills/gstack-* "$HOME"/.cursor/skills/gstack-* "$HOME"/.config/opencode/skills/gstack-* "$HOME"/.copilot/skills/gstack-* 2>/dev/null | head -1
```

If neither line finds gstack, stop and tell the user to install it for their tool: `git clone --depth 1 https://github.com/garrytan/gstack.git ~/gstack && cd ~/gstack && ./setup --team --host <tool>` with `<tool>` one of `claude`, `codex`, `cursor`, `opencode`, `copilot` (or `auto`). In Claude Code the hook in `.claude/` enforces this; other tools rely on this check. Skills are called `/review` in Claude Code and `gstack-review` (or `/gstack-review`) elsewhere.

1. `/spec` turns the change into an executable spec.
2. Build against fixtures and mocks, and run `pnpm verify` until green.
3. `/review` checks the diff before landing.
4. `/qa` exercises the running app or CLI.
5. `/ship` creates the PR. CI runs on Linux runners while Actions minutes last. When they are used up, the local `pnpm verify` (pre-push hook) is the gate and the PR body quotes its result.

## Docs

- [docs/README.md](docs/README.md): index of the handbook
- [docs/getting-started.md](docs/getting-started.md): install and first run
- [docs/architecture.md](docs/architecture.md): architecture, data model, tech stack
- [docs/decisions/README.md](docs/decisions/README.md): decision records
- [docs/development.md](docs/development.md): repo layout, tests, evals, releases
- [docs/maintainers.md](docs/maintainers.md): maintainer-owned files and the model policy

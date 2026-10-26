# Contributing to citegeist

Thank you for helping. This page describes how to propose a change and what a pull request needs. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Read [AGENTS.md](AGENTS.md) and the parts of [docs/](docs/README.md) that touch your change. [docs/architecture.md](docs/architecture.md) explains how the packages fit together, and [docs/development.md](docs/development.md) explains how to run the app and the tests.
- For anything larger than a small fix, open an issue first and agree on the approach. Product questions are decided by the maintainers.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md). Do not open a public issue for them.

## Setup

```sh
pnpm install
cd workers/convert && uv sync
pnpm verify
```

`pnpm install` activates a pre-push hook that runs `pnpm verify` before every push. See [docs/development.md](docs/development.md) for running the app from source.

## Proposing a change

1. **Branch.** Create one branch per topic, with your handle in front, for example `alex/zotero-import-fix`. Never work on `main` directly.
2. **Keep it small.** One topic per pull request. Split unrelated changes.
3. **Pull request.** Open it against `main` and fill in the template. Opening it early as a draft is welcome.
4. **Review.** The maintainers review every pull request, comment on it and decide product questions.
5. **Merge.** The maintainers merge after `pnpm verify` is green, either in CI or locally. They use merge commits instead of squash, so that stacked branches rebase cleanly.

## The verify gate

`pnpm verify` runs `biome check`, the type check of every package, vitest and pytest. It must pass before every commit. CI runs it on Linux runners while GitHub Actions minutes last. When they are used up, the local run is the gate, and the pull request body quotes the last lines of the `pnpm verify` output.

Tests sit next to the code as `*.test.ts`, and Python tests live in `workers/convert/tests` and `workers/research/tests`. A new operation needs a contract in `packages/ops/src/contracts` and a test. Run `pnpm secrets` before you open the pull request when you have gitleaks installed.

## Files only maintainers change

Schemas, operation contracts, the root `package.json`, the lockfile, `turbo.json`, `AGENTS.md`, `CLAUDE.md` and the CI workflows are maintainer-owned. If your change needs one of them, say so in the issue or the pull request. A new dependency goes into the `package.json` of your own package, and a maintainer updates the lockfile. See [docs/maintainers.md](docs/maintainers.md).

## Style

- Code, comments, file names, commit messages and docs are English.
- Never use em dashes in any text, including code comments, docs and commit messages.
- Write documentation in plain sentences. Headings are nouns or plain statements.
- TypeScript is strict. `pnpm format` applies the Biome formatting.
- Record a decision that changes how citegeist works in [docs/decisions/](docs/decisions/README.md). A decision is not edited silently. A change is a new record that references the old one.

## AI-assisted contributions

AI-assisted contributions are welcome. gstack is required for AI-assisted work in this repository, whatever coding agent you use. Clone it once and run its setup for your tool:

```sh
git clone --depth 1 https://github.com/garrytan/gstack.git ~/gstack
cd ~/gstack && ./setup --team --host <tool>
```

| Tool | `--host` | How you call a skill | Enforcement |
|---|---|---|---|
| Claude Code | `claude` (default) | `/review` | the hook in `.claude/` blocks skills until gstack is installed |
| Codex CLI | `codex` | ask for `gstack-review` | the install check in `AGENTS.md` |
| Cursor | `cursor` | ask for `gstack-review` | the install check in `AGENTS.md` |
| OpenCode | `opencode` | `/gstack-review` | the install check in `AGENTS.md` |
| GitHub Copilot CLI | `copilot` | `/gstack-review` | the install check in `AGENTS.md` |

`./setup --host auto` installs for every agent it finds on your machine. Other hosts (Kiro, Factory Droid, Antigravity) are listed in `./setup --help`. The workflow is the same everywhere: spec to plan the change, review and qa to check it, ship to open the pull request.

The author of a pull request has reviewed the diff and understands it. You are expected to explain any line in review, whether you or an agent wrote it. Say in the pull request that an agent wrote part of the change when that is the case, and keep the `Co-Authored-By` line that your tool adds to the commit message.

## Reporting bugs and requesting features

Use the issue templates. A bug report names the citegeist version, the macOS version and the steps to reproduce the problem. A feature request starts from the moment in your work when you needed it.

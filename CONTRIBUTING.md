# Contributing to citegeist

Thank you for helping. This page describes how to propose a change and what a pull request needs. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Read [AGENTS.md](AGENTS.md) and the parts of [docs/](docs/README.md) that touch your change. [docs/architecture.md](docs/architecture.md) explains how the packages fit together, and [docs/development.md](docs/development.md) explains how to run the app and the tests.
- Open an issue first for anything larger than a typo or a one-line fix, and wait until a maintainer agrees on the approach there. Product questions are decided by the maintainers.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md). Do not open a public issue for them.

## Setup

```sh
pnpm install
cd workers/convert && uv sync
pnpm verify
```

`pnpm install` activates a pre-push hook that runs `pnpm verify` before every push. See [docs/development.md](docs/development.md) for running the app from source.

## Proposing a change

1. **Issue.** Link the issue in which a maintainer agreed on the approach.
2. **Branch.** Create one branch per topic in your fork, for example `zotero-import-fix`.
3. **Keep it small.** One topic per pull request. A reviewer reads every line, so a pull request should stay under about 400 changed lines outside tests, fixtures and generated files. Split anything larger, or agree on the size in the issue first.
4. **Pull request.** Open it against `main` and fill in the template. Opening it early as a draft is welcome.
5. **Review.** The maintainers review every pull request, comment on it and decide product questions.
6. **Merge.** The maintainers merge after the `verify` check is green. They use merge commits instead of squash, so that stacked branches rebase cleanly.

## The verify gate

`pnpm verify` runs `biome check`, the type check of every package, vitest, pytest and the license check. It must pass before every push, and the pre-push hook runs it. CI runs the same check as `verify` on every pull request, and `main` accepts only pull requests on which it is green. For a pull request from a fork, CI starts once a maintainer has approved the run.

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

AI-assisted contributions are welcome. A coding agent writes code faster than anyone can review it, so the limit of this project is the time of its maintainers. These rules protect that time:

- **A person stands behind every pull request.** You have read the whole diff, run the change yourself and can explain any line in review, whether you or an agent wrote it.
- **Show that it works.** A bug fix comes with a test that fails without it. A UI change comes with a screenshot or the steps you clicked through.
- **Two open pull requests at a time.** Open the next one when one of them is merged or closed.
- **Write issues, comments and review answers yourself.** An agent may help you think, but post only what you have read and mean. Unedited agent output in issues or review threads gets closed.
- **No automated pull requests.** Agent loops, bots and scripts that open pull requests or issues on their own are not allowed. Dependabot is the only exception.

Maintainers close pull requests that do not follow these rules without a detailed review. Fix the point that the closing comment names and open the pull request again.

gstack is required for AI-assisted work in this repository, whatever coding agent you use. Clone it once and run its setup for your tool:

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

Say in the pull request that an agent wrote part of the change when that is the case, and keep the `Co-Authored-By` line that your tool adds to the commit message.

## Reporting bugs and requesting features

Use the issue templates. A bug report names the citegeist version, the macOS version and the steps to reproduce the problem. A feature request starts from the moment in your work when you needed it.

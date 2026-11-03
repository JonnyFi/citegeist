# Maintainers

This page records what only the maintainers change and how they work. Contributors need it when a change touches one of these areas.

## Maintainer-owned files

These files are shared by every package. A change to one of them can break all packages, so maintainers make it, or agree to it explicitly in a pull request.

| Path | Why |
|---|---|
| `packages/schema` | The schemas define the file formats and the JSON Schema that the Python workers read. |
| `packages/ops/src/contracts` | The contracts define every operation, and the UI, the CLI and MCP derive from them. |
| root `package.json` | Scripts and the dependency catalog. |
| `pnpm-lock.yaml` | One lockfile for the whole workspace. |
| `turbo.json` | The task graph of `pnpm verify`. |
| `AGENTS.md`, `CLAUDE.md` | Instructions that every coding agent reads. |
| `.github/workflows` | CI. |

A new dependency goes into the `package.json` of the package that uses it. The contributor mentions it in the pull request, and a maintainer updates the lockfile.

## Review and merge

A maintainer reviews every pull request (`.github/CODEOWNERS`). `main` is protected: the `verify` check of CI must be green on a branch that is up to date with `main`, and force pushes and deletion are blocked. Only collaborators can push branches; everyone else works from a fork, and CI on a fork pull request starts after a maintainer approves the run. Merged branches are deleted automatically. Merges use merge commits instead of squash, so that stacked branches rebase cleanly.

A pull request that breaks the rules in [CONTRIBUTING.md](../CONTRIBUTING.md#ai-assisted-contributions) is closed with a comment that names the rule. If a flood of issues or pull requests comes in, Settings, Moderation options, Interaction limits restricts them to prior contributors or collaborators for up to six months.

## gstack

gstack is required for AI-assisted work in this repository, for maintainers and contributors alike and in every coding agent. `CONTRIBUTING.md` has the install command per tool (`./setup --team --host <tool>`). Claude Code enforces it through the hook in `.claude/`; Codex, Cursor and the other hosts run the install check in `AGENTS.md`, because gstack marks those hosts as advisory and they have no blocking hook.

## Agent models

Coding agents default to Sonnet. Larger models are for architecture and contract work, and the maintainer decides when to use one.

## Decisions

Decisions are recorded in [decisions/](decisions/README.md). A decision is never edited silently. To change one, write a new record that references the old one and says which finding supports the change.

## Releases

`pnpm release` publishes a release from the maintainer's Mac. See [development.md](development.md#releases).

## Going public

citegeist became public on 2026-11-02 with release v0.1.0. On that day `pnpm secrets` scanned the whole git history, Private Vulnerability Reporting, Dependabot alerts and security updates and secret scanning with push protection were turned on, and `verify` became a required check for `main`.

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

A maintainer reviews every pull request (`.github/CODEOWNERS`). The merge happens after `pnpm verify` is green, either in CI or locally. CI runs on Linux runners while GitHub Actions minutes last. When they are used up, the local run of `pnpm verify` (the pre-push hook) is the gate, and the pull request body quotes its result. Merges use merge commits instead of squash, so that stacked branches rebase cleanly.

## gstack

gstack is required for AI-assisted work in this repository, for maintainers and contributors alike. Install it once:

```sh
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

The Claude Code hook in `.claude/` enforces the install, and `CLAUDE.md` runs the same check for other tools. The workflow is `/spec`, build, `/review`, `/qa` and `/ship`.

## Agent models

Coding agents default to Sonnet. Larger models are for architecture and contract work, and the maintainer decides when to use one.

## Decisions

Decisions are recorded in [decisions/](decisions/README.md). A decision is never edited silently. To change one, write a new record that references the old one and says which finding supports the change.

## Releases

`pnpm release` publishes a release from the maintainer's Mac. See [development.md](development.md#releases).

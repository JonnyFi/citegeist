# Contributing to citegeist

citegeist is built mostly by coding agents. These rules keep everyone's agents working the same way.

1. **gstack is required.** The repo enforces it through `CLAUDE.md` and a hook in `.claude/`. Install it once:
   ```bash
   git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
   cd ~/.claude/skills/gstack && ./setup --team
   ```
2. **Read `CLAUDE.md` and the docs in `docs/`** before larger work. `docs/development-plan.md` lists the open workstreams with their owned paths and acceptance criteria.
3. **One workstream, one branch, one PR against `main`.** Plan with `/spec` or `/autoplan`, check with `/review` and `/qa`, open the PR with `/ship`. Nothing lands without green CI.
4. **Stay inside your workstream's paths.** Hotspots (schemas, contracts, root config, lockfile, CI) change only through a dedicated PR.
5. **Agents default to Sonnet.** Opus is for architecture and contract work.
6. **`pnpm verify` must pass** before every commit.

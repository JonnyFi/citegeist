# Contributing to citegeist

citegeist is built mostly by coding agents. These rules keep everyone's agents working the same way.

1. **gstack is required.** AI-assisted work in this repo uses gstack. `CLAUDE.md` checks for it, and a hook in `.claude/` stops skill use until it is installed. Install it once:
   ```bash
   git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
   cd ~/.claude/skills/gstack && ./setup --team
   ```
2. **Read `AGENTS.md` and the docs in `docs/`** before larger work.
3. **One workstream, one branch, one PR against `main`.** Plan with `/spec` or `/autoplan`, check with `/review` and `/qa`, open the PR with `/ship`.
4. **Stay inside the paths your change needs.** Hotspots (schemas, contracts, root config, lockfile, CI) change only through a dedicated PR.
5. **Agents default to Sonnet.** Opus is for architecture and contract work.
6. **`pnpm verify` is the gate, and it runs locally.** `pnpm install` activates a pre-push hook that runs it before every push. CI runs on Linux runners while Actions minutes are available. When they are used up, the local run is the gate, and the PR body quotes the last lines of the `pnpm verify` output.

## Ablauf für Beiträge von außen

1. **Branch pro Thema** mit deinem Kürzel vorn, zum Beispiel `alex/zotero-import-fix`. Nie direkt auf `main`.
2. **Klein bleiben:** ein Thema pro PR. Größere Arbeit vorher als Issue abstimmen.
3. **PR gegen `main`** mit der Vorlage. Früh als Draft öffnen ist willkommen.
4. **Review:** Die Maintainer prüfen den PR, kommentieren und entscheiden über Produktfragen.
5. **Merge** machen die Maintainer, nachdem `pnpm verify` grün ist (CI oder lokal, siehe oben). Merge-Commits statt Squash, damit gestapelte Branches sauber rebasen.
6. **Hotspots** (Schemas, Verträge, Root-Konfiguration) ändern nur die Maintainer oder ein dafür abgestimmter PR.

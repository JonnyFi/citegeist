# ADR 0005: Sync and versioning

Status: accepted. Date: 2026-10-23.

## Context

The library is a folder of files. Several Macs should share it, and changes made by agents should be traceable. Format, sync and versioning are three separate roles.

## Decision

- **Format:** Obsidian-compatible Markdown ([ADR 0006](0006-obsidian-compatible-notes.md)). It costs nothing.
- **Sync:** the folder can live in iCloud Drive, Dropbox or another synchronized location, PDFs included. Exactly one transport carries the sync, either iCloud/Dropbox or a git remote (with git LFS for PDFs), never both at once.
- **Versioning:** git provides history and diffs. In iCloud the `.git` directory is placed outside iCloud with `git init --separate-git-dir`, because iCloud synchronizes internal git files one by one and with delay, which can corrupt the repository.
- The search index and all other machine-local data live outside the library folder in `~/Library/Application Support/citegeist/` and rebuild themselves when needed. SQLite files never go into a synchronized folder.
- The watcher recognizes iCloud conflict copies (`Datei 2.md`) and reports them.

## Consequences

Git history is always allowed. Sync and versioning can run at the same time because they are independent tasks.

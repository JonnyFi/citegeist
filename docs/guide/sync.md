# Sync

A library is a folder, so it syncs like any folder. citegeist separates two jobs that can run at the same time: moving the folder between Macs (sync) and recording its history (versioning). The reasoning is in [ADR 0005](../decisions/0005-sync-and-versioning.md).

Sync settings are in Settings > Sync. `cg sync status`, `cg sync configure`, `cg sync now` and `cg sync resolve-conflict` do the same from a shell.

## Sync route

Exactly one route carries the sync:

| Route | Use it when |
|---|---|
| iCloud | The library folder sits in iCloud Drive. |
| Dropbox | The library folder sits in a Dropbox folder. |
| git remote | The library folder sits outside iCloud and Dropbox. citegeist commits, pulls with rebase and pushes. PDFs go through git LFS when it is installed (setting "auto"). |

A git remote is refused while the library sits in iCloud or Dropbox. citegeist detects where the folder is, and the settings show it as "Library location".

The search index, job state and models live outside the library folder in `~/Library/Application Support/citegeist` and are never synchronized. SQLite files do not belong in a synchronized folder, and each Mac rebuilds its own index from the files.

## Versioning

"Keep a git history of the library" records changes as git commits, including the changes of agents, with the actor in the commit. The history is available with any route.

When the library sits in iCloud, citegeist keeps the `.git` directory outside the library folder (`git init --separate-git-dir`). iCloud syncs the internal git files one by one and with delay, which can corrupt a repository inside iCloud. The settings show where the git directory is: in the library folder, apart from it, or broken.

"Sync now" commits pending changes and then syncs once. In the background citegeist commits after a quiet period and syncs at the configured interval (default: 10 minutes).

## iCloud files that are not downloaded

iCloud can evict files from a Mac. The sync settings count the files that exist only in iCloud. "Sync now" downloads them, and citegeist downloads a file when it needs it.

## Conflicts

Every card and note is a file of its own, so two Macs conflict only when they change the same file. A conflict appears under "Conflicts" in the sync settings. citegeist recognizes the conflict copies that iCloud and Dropbox create (for example `note 2.md`), and for a git remote it keeps the remote version next to yours. For each conflict you can show the difference and choose "Keep A", "Keep B" or "Keep both". A is the file under its own name (after a git sync: the version on this Mac), and B is the copy.

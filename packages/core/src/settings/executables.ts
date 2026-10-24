import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Apps started from the Dock inherit a minimal PATH (/usr/bin:/bin:...), so `claude`, `codex`
 * and `uv` in the usual install locations are not found by name. These directories are searched
 * in addition to PATH.
 */
export function extraBinDirs(home = homedir()): string[] {
  return [
    join(home, ".local", "bin"),
    // the "local" install of Claude Code (`claude migrate-installer`)
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    // MacTeX and BasicTeX, where Pandoc finds xelatex for PDF export
    "/Library/TeX/texbin",
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".volta", "bin"),
  ];
}

export interface FindOptions {
  pathEnv?: string | undefined;
  home?: string;
  exists?: (path: string) => boolean;
}

/** PATH with the extra install directories appended. */
export function extendedPath(opts: FindOptions = {}): string {
  const base = (opts.pathEnv ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const all = [...base];
  for (const dir of extraBinDirs(opts.home)) if (!all.includes(dir)) all.push(dir);
  return all.join(delimiter);
}

/** Absolute path of an executable on PATH or in a usual install directory. */
export function findExecutable(name: string, opts: FindOptions = {}): string | undefined {
  const exists = opts.exists ?? existsSync;
  for (const dir of extendedPath(opts).split(delimiter)) {
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

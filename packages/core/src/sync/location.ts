import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type LocationKind = "local" | "icloud" | "dropbox";

/** Which kind of folder a (real) library path lies in. */
export function detectLocation(realPath: string): LocationKind {
  const p = realPath.split("\\").join("/");
  if (p.includes("/Library/Mobile Documents/") || p.endsWith("/Library/Mobile Documents")) {
    return "icloud";
  }
  if (p.includes("/Library/CloudStorage/Dropbox") || /\/Dropbox(?: \([^/]*\))?(?:\/|$)/.test(p)) {
    return "dropbox";
  }
  return "local";
}

export type GitDirKind = "none" | "embedded" | "separate" | "broken";

export interface GitDirState {
  kind: GitDirKind;
  /** Absolute path of the git directory, when there is one. */
  gitDir?: string;
}

/**
 * Looks at `<root>/.git`. A directory is an embedded repository. A file ("gitdir: <path>") is the
 * pointer `git init --separate-git-dir` leaves behind; it is broken when its target is missing,
 * for example because the pointer arrived through iCloud from another Mac.
 */
export function detectGitDir(root: string, separateDir?: string): GitDirState {
  if (separateDir && existsSync(join(separateDir, "HEAD"))) {
    return { kind: "separate", gitDir: separateDir };
  }
  const dotGit = join(root, ".git");
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(dotGit);
  } catch {
    return { kind: "none" };
  }
  if (st.isDirectory()) return { kind: "embedded", gitDir: dotGit };
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    const target = m?.[1]?.trim();
    if (target) {
      const abs = isAbsolute(target) ? target : resolve(dirname(dotGit), target);
      if (existsSync(join(abs, "HEAD"))) return { kind: "separate", gitDir: abs };
    }
  } catch {
    // fall through
  }
  return { kind: "broken" };
}

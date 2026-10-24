import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { SyncConflict } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { classify, SKIPPED_DIRS } from "../classify.js";
import { MarkdownFile } from "../frontmatter.js";
import { writeFileAtomic } from "../fsutil.js";
import { newCardId, newNoteId } from "../ids.js";
import { Git } from "./git.js";

const DROPBOX_COPY = /^(.*) \([^()]*conflicted copy[^()]*\)(\.[^./]+)$/;
const MAX_DIFF = 8000;
const MAX_DIFF_BYTES = 1_000_000;

const abs = (root: string, rel: string): string => join(root, ...rel.split("/"));

/** Original path of a conflict copy: iCloud "name 2.md" or Dropbox "name (X's conflicted copy).md". */
export function conflictOriginal(
  rel: string,
  exists: (rel: string) => boolean,
): string | undefined {
  const c = classify(rel, exists);
  if (c?.kind === "conflict") return c.original;
  const m = DROPBOX_COPY.exec(basename(rel));
  if (m) {
    const dir = dirname(rel);
    const original = `${dir === "." ? "" : `${dir}/`}${m[1]}${m[2]}`;
    if (exists(original)) return original;
  }
  return undefined;
}

/** Walks the library (without sources and caches) and lists every conflict copy as [original, copy]. */
export function findConflictPairs(root: string): [string, string][] {
  const out: [string, string][] = [];
  const exists = (rel: string) => existsSync(abs(root, rel));
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIPPED_DIRS.has(e.name)) walk(rel);
      } else {
        const original = conflictOriginal(rel, exists);
        if (original) out.push([original, rel]);
      }
    }
  };
  walk("");
  return out.sort((a, b) => a[1].localeCompare(b[1]));
}

/** Free name for a conflict copy of `rel`, in the form iCloud uses: "name 2.md", "name 3.md". */
export function freeCopyName(root: string, rel: string): string {
  const dir = dirname(rel);
  const ext = extname(rel);
  const stem = basename(rel, ext);
  for (let n = 2; ; n++) {
    const name = `${stem} ${n}${ext}`;
    const candidate = dir === "." ? name : `${dir}/${name}`;
    if (!existsSync(abs(root, candidate))) return candidate;
  }
}

function fileInfo(root: string, rel: string): SyncConflict["a"] {
  const st = statSync(abs(root, rel));
  return { path: rel, size: st.size, modified: st.mtime.toISOString() };
}

/** Describes one conflict, including a line diff for text files. */
export async function describeConflict(
  root: string,
  original: string,
  copy: string,
): Promise<SyncConflict> {
  const a = fileInfo(root, original);
  const b = fileInfo(root, copy);
  const bufA = readFileSync(abs(root, original));
  const bufB = readFileSync(abs(root, copy));
  const identical = bufA.equals(bufB);
  let diff: string | undefined;
  if (!identical && a.size < MAX_DIFF_BYTES && b.size < MAX_DIFF_BYTES) {
    const res = await new Git({ cwd: root }).exec(
      ["diff", "--no-index", "--no-color", "--unified=2", "--", original, copy],
      { allowFail: true },
    );
    if (res.code === 1 && res.stdout) {
      diff = res.stdout.length > MAX_DIFF ? `${res.stdout.slice(0, MAX_DIFF)}\n...` : res.stdout;
    }
  }
  return { path: original, copy, a, b, identical, ...(diff ? { diff } : {}) };
}

export async function listConflicts(root: string): Promise<SyncConflict[]> {
  const out: SyncConflict[] = [];
  for (const [original, copy] of findConflictPairs(root)) {
    try {
      out.push(await describeConflict(root, original, copy));
    } catch {
      // a file that disappeared while scanning is not a conflict any more
    }
  }
  return out;
}

export interface Resolution {
  path: string;
  keep: "a" | "b" | "both";
  kept: string[];
  removed: string[];
}

function fail(code: string, message: string, fix: string, context: Record<string, unknown>) {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

function safeRel(rel: string): string {
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith("/") || norm.split("/").includes("..") || norm.split("/").includes(".git")) {
    throw fail(
      "SYNC_PATH_INVALID",
      `"${rel}" is not a path inside the library`,
      "Pass the library-relative path from sync.status, for example notes/idea.md.",
      { path: rel },
    );
  }
  return norm;
}

/** Name for the copy when both versions stay: it must no longer look like a conflict copy. */
function keepBothTarget(root: string, original: string): string {
  const c = classify(original);
  const dir = dirname(original);
  const prefix = dir === "." ? "" : `${dir}/`;
  const ext = extname(original);
  const stem = basename(original, ext);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    const name = c?.kind === "card" ? `${newCardId()}${ext}` : `${stem}${suffix}${ext}`;
    const candidate = `${prefix}${name}`;
    if (!existsSync(abs(root, candidate))) return candidate;
  }
}

/** Gives a kept-both copy a new id so that it does not collide with the original in the index. */
function reidentify(root: string, original: string, target: string): void {
  const kind = classify(original)?.kind;
  if (kind !== "card" && kind !== "note") return;
  const file = MarkdownFile.parse(readFileSync(abs(root, target), "utf8"));
  if (typeof file.data?.id !== "string") return;
  file.patch({ id: kind === "card" ? basename(target, ".md") : newNoteId() });
  writeFileAtomic(abs(root, target), file.toString());
}

/**
 * Resolves one conflict on disk. "a" drops the copy, "b" puts the copy in the place of the file,
 * "both" renames the copy to its own file with a fresh id.
 */
export function resolveConflictFiles(
  root: string,
  conflicts: SyncConflict[],
  input: { path: string; copy?: string | undefined; keep: "a" | "b" | "both" },
): Resolution {
  const path = safeRel(input.path);
  const matching = conflicts.filter((c) => c.path === path);
  if (matching.length === 0) {
    throw fail(
      "SYNC_NO_CONFLICT",
      `${path} has no conflict copy`,
      "Call sync.status to list the current conflicts and pass one of their paths.",
      { path },
    );
  }
  const copyRel = input.copy ? safeRel(input.copy) : undefined;
  const picked = copyRel ? matching.find((c) => c.copy === copyRel) : matching[0];
  if (!picked || (!copyRel && matching.length > 1)) {
    throw fail(
      "SYNC_COPY_AMBIGUOUS",
      `${path} has ${matching.length} conflict copies: ${matching.map((c) => c.copy).join(", ")}`,
      "Pass `copy` with the path of the copy to resolve.",
      { path, copies: matching.map((c) => c.copy) },
    );
  }
  const copy = picked.copy;
  if (input.keep === "a") {
    rmSync(abs(root, copy));
    return { path, keep: "a", kept: [path], removed: [copy] };
  }
  if (input.keep === "b") {
    renameSync(abs(root, copy), abs(root, path));
    return { path, keep: "b", kept: [path], removed: [copy] };
  }
  const target = keepBothTarget(root, path);
  renameSync(abs(root, copy), abs(root, target));
  reidentify(root, path, target);
  return { path, keep: "both", kept: [path, target], removed: [copy] };
}

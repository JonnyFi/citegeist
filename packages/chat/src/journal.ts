import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { merge3 } from "./merge.js";
import { writeAtomic } from "./util.js";

/**
 * Turn journal: records every file the agent changes during one turn, so one click undoes them
 * all (docs/decisions/0018-direct-agent-edits-with-undo.md). The agent may write through the citegeist MCP tools or edit files directly. Both end
 * as text files in the library folder, so the journal compares the folder before and after the
 * turn and does not depend on how the agent wrote.
 */

/** One changed file of a turn. `null` means the file did not exist. */
export interface JournalEdit {
  path: string;
  before: string | null;
  after: string | null;
}

interface Entry {
  size: number;
  mtimeMs: number;
  content: string;
}

export type Snapshot = Map<string, Entry>;

/** Files over this size are not tracked. Notes, cards and project files stay far below it. */
const MAX_FILE_BYTES = 1024 * 1024;
const TRACKED = /\.(md|ya?ml)$/i;
/** Atomic-write temp files, see TEMP_FILE in the core. */
const TEMP = /^\..*\.[0-9a-f]{8}\.tmp$/;
const SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "node_modules",
  "derived",
  "sources",
  "exports",
  "chats",
]);

/** Directories at the library root that hold text the agent may change. */
const ROOTS = ["items", "notes", "projects"];

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(join(root, ...rel.split("/").filter(Boolean)), {
      withFileTypes: true,
    });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(root, child, out);
    } else if (e.isFile() && TRACKED.test(e.name) && !TEMP.test(e.name)) {
      out.push(child);
    }
  }
}

/**
 * Remembers the last snapshot of a library, so the next one only reads files whose size or
 * modification time changed.
 */
export class SnapshotCache {
  private last: Snapshot = new Map();

  constructor(private readonly root: string) {}

  async take(): Promise<Snapshot> {
    const paths: string[] = [];
    for (const dir of ROOTS) await walk(this.root, dir, paths);
    const next: Snapshot = new Map();
    // Small batches keep the number of open files low on big libraries.
    for (let i = 0; i < paths.length; i += 64) {
      await Promise.all(
        paths.slice(i, i + 64).map(async (rel) => {
          const abs = join(this.root, ...rel.split("/"));
          let st: import("node:fs").Stats;
          try {
            st = await stat(abs);
          } catch {
            return;
          }
          if (st.size > MAX_FILE_BYTES) return;
          const known = this.last.get(rel);
          if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) {
            next.set(rel, known);
            return;
          }
          try {
            next.set(rel, {
              size: st.size,
              mtimeMs: st.mtimeMs,
              content: await readFile(abs, "utf8"),
            });
          } catch {
            // vanished between stat and read
          }
        }),
      );
    }
    this.last = next;
    return next;
  }
}

export function diffSnapshots(before: Snapshot, after: Snapshot): JournalEdit[] {
  const edits: JournalEdit[] = [];
  for (const [path, now] of after) {
    const was = before.get(path);
    if (!was) edits.push({ path, before: null, after: now.content });
    else if (was.content !== now.content) {
      edits.push({ path, before: was.content, after: now.content });
    }
  }
  for (const [path, was] of before) {
    if (!after.has(path)) edits.push({ path, before: was.content, after: null });
  }
  return edits.sort((a, b) => a.path.localeCompare(b.path));
}

export interface RevertResult {
  restored: string[];
  conflicts: Array<{ path: string; reason: string }>;
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * Puts the files of a turn back. A file nobody touched since the turn gets its old text back. A
 * file the user edited afterwards is merged line by line, and a change on the same lines stays as it
 * is and is reported as a conflict.
 */
export async function revertEdits(
  root: string,
  edits: readonly JournalEdit[],
  io: {
    /** Called for every file that was written or removed. */
    changed(path: string): void;
    remove(abs: string): void;
  },
): Promise<RevertResult> {
  const result: RevertResult = { restored: [], conflicts: [] };
  for (const edit of edits) {
    const abs = join(root, ...edit.path.split("/"));
    const current = await readText(abs);
    const conflict = (reason: string) => result.conflicts.push({ path: edit.path, reason });

    if (current === edit.before) {
      result.restored.push(edit.path);
      continue;
    }
    if (current === edit.after) {
      if (edit.before === null) io.remove(abs);
      else writeAtomic(abs, edit.before);
      io.changed(edit.path);
      result.restored.push(edit.path);
      continue;
    }
    // The file differs from both ends of the turn: somebody changed it since.
    if (edit.before === null) {
      conflict("the file was created in this turn and has been edited since");
    } else if (edit.after === null) {
      conflict("the file was deleted in this turn and exists again with other content");
    } else if (current === null) {
      conflict("the file was deleted after this turn");
    } else {
      const merged = merge3(edit.after, current, edit.before);
      if (merged.ok) {
        writeAtomic(abs, merged.text);
        io.changed(edit.path);
        result.restored.push(edit.path);
      } else {
        conflict(merged.reason);
      }
    }
  }
  return result;
}

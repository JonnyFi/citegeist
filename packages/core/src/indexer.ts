import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Classified, classify, type FileKind, SKIPPED_DIRS } from "./classify.js";
import { sha256Hex } from "./hash.js";
import type { Index } from "./index-db.js";
import { type Issue, type Parsed, parseLibraryFile } from "./parse.js";

export type IndexStatus =
  /** Parsed, valid, and the index now reflects the file. */
  | "indexed"
  /** The content hash equals the indexed one: our own write or a touch. */
  | "unchanged"
  /** Schema-invalid or otherwise unusable; reported in the problem list. */
  | "invalid"
  /** iCloud conflict copy or placeholder, reported as problem and not read. */
  | "flagged"
  | "removed"
  | "ignored";

export interface IndexResult {
  rel: string;
  status: IndexStatus;
  kind?: FileKind | "conflict" | "placeholder";
  issues?: Issue[];
}

export interface SyncSummary {
  scanned: number;
  indexed: number;
  removed: number;
}

/** Turns library files into index rows. Everything it does is idempotent per file content. */
export class Indexer {
  constructor(
    readonly root: string,
    readonly index: Index,
    private readonly onParsed?: (rel: string, parsed: Parsed) => void,
  ) {}

  /** Reads `rel` (or uses `content`) and brings the index in line with it. */
  indexFile(rel: string, content?: Buffer): IndexResult {
    const c = classify(rel);
    if (!c) return { rel, status: "ignored" };
    const abs = join(this.root, ...rel.split("/"));

    if (c.kind === "conflict" || c.kind === "placeholder") {
      return this.flag(rel, c, abs);
    }

    let buf: Buffer;
    let size: number;
    let mtimeMs: number;
    try {
      const st = statSync(abs);
      if (!st.isFile()) return { rel, status: "ignored" };
      size = st.size;
      mtimeMs = st.mtimeMs;
      buf = content ?? readFileSync(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return this.removePath(rel);
      }
      throw err;
    }

    const hash = sha256Hex(buf);
    const rec = this.index.getFile(rel);
    if (rec && rec.hash === hash) {
      if (rec.mtimeMs !== mtimeMs || rec.size !== size) {
        this.index.putFile({ path: rel, kind: c.kind, hash, size, mtimeMs });
      }
      return { rel, status: "unchanged", kind: c.kind };
    }

    const result = parseLibraryFile(c, buf.toString("utf8"));
    return this.index.transaction((): IndexResult => {
      this.index.putFile({ path: rel, kind: c.kind, hash, size, mtimeMs });
      if (!result.ok) {
        this.index.setProblems(rel, result.issues);
        return { rel, status: "invalid", kind: c.kind, issues: result.issues };
      }
      const clash = this.duplicate(rel, result.parsed);
      if (clash) {
        this.index.setProblems(rel, [clash]);
        return { rel, status: "invalid", kind: c.kind, issues: [clash] };
      }
      this.put(rel, result.parsed);
      this.index.setProblems(rel, result.warnings);
      this.onParsed?.(rel, result.parsed);
      return { rel, status: "indexed", kind: c.kind, issues: result.warnings };
    });
  }

  removePath(rel: string): IndexResult {
    const known = this.index.getFile(rel) !== undefined || this.index.problemPaths().includes(rel);
    this.index.transaction(() => this.index.removeFile(rel));
    return known ? { rel, status: "removed" } : { rel, status: "ignored" };
  }

  /** Removes a directory subtree from the index (folder deleted or moved away). */
  removeUnder(prefix: string): IndexResult[] {
    const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return this.index.pathsUnder(dir).map((p) => this.removePath(p));
  }

  private flag(
    rel: string,
    c: Extract<Classified, { kind: "conflict" | "placeholder" }>,
    abs: string,
  ): IndexResult {
    try {
      statSync(abs);
    } catch {
      return this.removePath(rel);
    }
    const issue: Issue =
      c.kind === "conflict"
        ? {
            code: "ICLOUD_CONFLICT",
            message: `conflict copy of ${c.original}; compare both files, keep one and delete the other`,
          }
        : {
            code: "ICLOUD_PLACEHOLDER",
            message: `${c.original} is evicted to iCloud and not downloaded yet`,
          };
    this.index.setProblems(rel, [issue]);
    return { rel, status: "flagged", kind: c.kind, issues: [issue] };
  }

  private duplicate(rel: string, p: Parsed): Issue | undefined {
    const clash = (what: string, other: string | undefined): Issue | undefined =>
      other ? { code: "DUPLICATE_ID", message: `${what} is already used by ${other}` } : undefined;
    switch (p.kind) {
      case "item":
        return (
          clash(`item id ${p.fm.id}`, this.index.itemIdConflict(p.fm.id, rel)) ??
          clash(`citekey ${p.citekey}`, this.index.conflictFor("items", p.citekey, rel))
        );
      case "card":
        return clash(`card id ${p.fm.id}`, this.index.conflictFor("cards", p.fm.id, rel));
      case "note":
        return clash(`note id ${p.fm.id}`, this.index.conflictFor("notes", p.fm.id, rel));
      case "project":
        return clash(`project slug ${p.fm.slug}`, this.index.conflictFor("projects", p.slug, rel));
      default:
        return undefined;
    }
  }

  private put(rel: string, p: Parsed): void {
    switch (p.kind) {
      case "manifest":
        break;
      case "item":
        this.index.putItem(rel, p.citekey, p.fm, p.body);
        break;
      case "card":
        this.index.putCard(rel, p.citekey, p.fm, p.body, p.quoteOk);
        break;
      case "note":
        this.index.putNote(rel, p.slug, p.fm, p.body);
        break;
      case "project":
        this.index.putProject(rel, p.fm);
        break;
      case "blocks":
        this.index.putBlocks(rel, p.citekey, p.source, p.blocks);
        break;
    }
  }

  /** Root-relative paths of every file the index cares about (including conflict copies). */
  scan(): string[] {
    const out: string[] = [];
    const walk = (relDir: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(join(this.root, ...relDir.split("/").filter(Boolean)), {
          withFileTypes: true,
        });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = relDir === "" ? e.name : `${relDir}/${e.name}`;
        if (e.isDirectory()) {
          if (!SKIPPED_DIRS.has(e.name) && !(relDir === "" && !isTopDir(e.name))) walk(rel);
        } else if (classify(rel)) {
          out.push(rel);
        }
      }
    };
    walk("");
    return out;
  }

  /**
   * Brings the index in line with the folder: new and changed files are indexed, files that
   * vanished are removed. Unchanged files (same size and mtime) are not even read.
   */
  sync(): SyncSummary {
    const files = this.scan();
    const seen = new Set(files);
    const summary: SyncSummary = { scanned: files.length, indexed: 0, removed: 0 };
    this.index.transaction(() => {
      for (const rel of files) {
        const rec = this.index.getFile(rel);
        if (rec) {
          try {
            const st = statSync(join(this.root, ...rel.split("/")));
            if (st.size === rec.size && st.mtimeMs === rec.mtimeMs) continue;
          } catch {
            // vanished between scan and stat: indexFile handles it
          }
        }
        const r = this.indexFile(rel);
        if (r.status === "indexed" || r.status === "invalid" || r.status === "flagged") {
          summary.indexed++;
        }
      }
      const stale = new Set([
        ...this.index.listFiles().map((f) => f.path),
        ...this.index.problemPaths(),
      ]);
      for (const p of stale) {
        if (!seen.has(p)) {
          this.index.removeFile(p);
          summary.removed++;
        }
      }
    });
    return summary;
  }

  /** Drops the index and reads the whole folder again. */
  rebuild(): SyncSummary {
    return this.index.transaction(() => {
      this.index.reset();
      return this.sync();
    });
  }
}

function isTopDir(name: string): boolean {
  return name === "items" || name === "notes" || name === "projects";
}

import { execFile } from "node:child_process";
import { type Dirent, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { classify } from "../classify.js";

/** Runs `brctl download <path>`. Replaceable in tests. */
export type BrctlRunner = (absPath: string) => Promise<{ code: number; stderr: string }>;

export const runBrctl: BrctlRunner = (absPath) =>
  new Promise((resolve) => {
    execFile("brctl", ["download", absPath], { timeout: 30_000 }, (err, _out, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stderr: String(stderr) });
    });
  });

const PLACEHOLDER = /^\.(.+)\.icloud$/;
const SKIP = new Set([".git", "node_modules", ".obsidian", ".trash"]);

export interface Evicted {
  /** Library-relative path of the real file, which is not on this Mac yet. */
  rel: string;
  /** True for files the index needs (items, cards, notes, projects, blocks). */
  needed: boolean;
}

/** Lists iCloud placeholders (".name.ext.icloud") of evicted files. */
export function scanEvicted(root: string): Evicted[] {
  const out: Evicted[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, ...dir.split("/").filter(Boolean)), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(rel);
        continue;
      }
      const m = PLACEHOLDER.exec(e.name);
      if (!m) continue;
      const original = `${dir ? `${dir}/` : ""}${m[1]}`;
      out.push({ rel: original, needed: classify(original) !== null });
    }
  };
  walk("");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export interface DownloadOptions {
  runner?: BrctlRunner;
  /** How long to wait for one file to arrive. Default 60 s. */
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Asks iCloud to download evicted files and waits until they exist. Returns the paths that
 * arrived and the ones that did not.
 */
export async function downloadEvicted(
  root: string,
  rels: string[],
  opts: DownloadOptions = {},
): Promise<{ downloaded: string[]; failed: string[] }> {
  const run = opts.runner ?? runBrctl;
  const timeout = opts.timeoutMs ?? 60_000;
  const poll = opts.pollMs ?? 100;
  const downloaded: string[] = [];
  const failed: string[] = [];
  const one = async (rel: string): Promise<void> => {
    const abs = join(root, ...rel.split("/"));
    if (existsSync(abs)) {
      downloaded.push(rel);
      return;
    }
    const res = await run(abs);
    const start = Date.now();
    while (res.code === 0 && !existsSync(abs) && Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, poll));
    }
    (existsSync(abs) ? downloaded : failed).push(rel);
  };
  const queue = [...rels];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) await one(rel);
  });
  await Promise.all(workers);
  return { downloaded: downloaded.sort(), failed: failed.sort() };
}

/** True when the real file is missing and only its iCloud placeholder exists. */
export function isEvicted(root: string, rel: string): boolean {
  const abs = join(root, ...rel.split("/"));
  return !existsSync(abs) && existsSync(join(dirname(abs), `.${basename(abs)}.icloud`));
}

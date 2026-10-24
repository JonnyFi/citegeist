import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../fsutil.js";
import { Git, LITERAL_PATHS } from "./git.js";
import { detectGitDir, type GitDirState } from "./location.js";

/**
 * Derived files that the worker can rebuild stay out of git. `idmap.json` (stable block ids) and
 * `blocks.jsonl` are kept on purpose: ids would change if they were regenerated. `pages.json`
 * holds page labels that the user confirmed, so it stays as well. Of a literature search run only
 * the results are kept; the query cache, the cached OpenAlex records and the log can be refetched.
 * The watchlist logs, the watchlist lock and half-written `.tmp` files of the scripts are local too.
 */
export const IGNORE_LINES = [
  ".DS_Store",
  ".*.tmp",
  "*.icloud",
  ".trash/",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  "items/*/derived/*/doc.md",
  "items/*/derived/*/doc.html",
  "items/*/derived/*/refs.jsonl",
  "items/*/derived/*/assets/",
  "projects/*/exports/",
  "research/runs/*/query-cache/",
  "research/runs/*/stderr.log",
  "research/runs/*/works/",
  "research/watches/logs/",
  "research/watches/.lock",
  "research/**/*.tmp",
];

export const LFS_LINES = ["items/*/sources/* filter=lfs diff=lfs merge=lfs -text"];

const BEGIN = "# citegeist:begin (managed, edit outside this block)";
const END = "# citegeist:end";

/** Writes `lines` between the markers of `file`, or removes the block when `lines` is empty. */
export function upsertBlock(file: string, lines: string[]): boolean {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const re = new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`);
  const without = current.replace(re, "");
  const block = lines.length > 0 ? `${BEGIN}\n${lines.join("\n")}\n${END}\n` : "";
  let next = without;
  if (block) next = `${without}${without && !without.endsWith("\n") ? "\n" : ""}${block}`;
  if (next === current) return false;
  if (next === "") rmSync(file, { force: true });
  else writeFileAtomic(file, next);
  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface CommitRecord {
  sha: string;
  message: string;
  actor: string;
  files: number;
}

export interface VersionerOptions {
  /** Where the git directory goes when it must live outside the library. */
  localGitDir: string;
  quietMs: number;
  onError?: (err: unknown) => void;
}

/** Actors that appear in commit messages: "human", "system" or "agent:<name>". */
function emailFor(actor: string): string {
  return `${actor.replace(/[^a-zA-Z0-9._-]+/g, "-")}@citegeist.local`;
}

function summarize(files: string[], ops: readonly string[]): string {
  const n = files.length;
  const count = `${n} file${n === 1 ? "" : "s"}`;
  if (ops.length > 0) {
    const shown = ops.slice(0, 3).join(", ");
    return `${shown}${ops.length > 3 ? ", ..." : ""} (${count})`;
  }
  if (n <= 3) return `update ${files.join(", ")}`;
  return `update ${count}, e.g. ${files.slice(0, 2).join(", ")}`;
}

/**
 * Git history for the library: creates the repository (with the git directory outside the
 * library when the folder is synced), and commits changes after quiet periods, one commit per
 * actor so that agent writes show up as their own commits.
 */
export class Versioner {
  private readonly pending = new Map<string, string>();
  private readonly ops = new Map<string, Set<string>>();
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private identityEnv: Record<string, string> | undefined;

  constructor(
    readonly root: string,
    private readonly opts: VersionerOptions,
  ) {}

  /** Where the repository is now. */
  state(): GitDirState {
    return detectGitDir(this.root, this.opts.localGitDir);
  }

  /** A git handle for the current repository, or undefined when there is none. */
  git(): Git | undefined {
    const st = this.state();
    if (st.kind === "none" || st.kind === "broken") return undefined;
    return new Git({
      cwd: this.root,
      ...(st.kind === "separate" && st.gitDir ? { gitDir: st.gitDir } : {}),
    });
  }

  /**
   * Makes sure a repository exists. With `separate`, the git directory is created (or moved) to
   * the machine-local folder with `git init --separate-git-dir`, because iCloud and Dropbox
   * would sync its internal files one by one and can corrupt the repository.
   */
  async ensureRepo(separate: boolean): Promise<{ created: boolean; state: GitDirState }> {
    const plain = new Git({ cwd: this.root });
    let st = this.state();
    let created = false;
    if (st.kind === "broken") {
      rmSync(join(this.root, ".git"), { force: true });
      st = { kind: "none" };
    }
    if (st.kind === "none") {
      created = true;
      if (separate) {
        mkdirSync(dirname(this.opts.localGitDir), { recursive: true });
        await plain.exec([
          "init",
          "--initial-branch=main",
          "--separate-git-dir",
          this.opts.localGitDir,
          this.root,
        ]);
      } else {
        await plain.exec(["init", "--initial-branch=main", this.root]);
      }
    } else if (separate && st.kind === "embedded") {
      mkdirSync(dirname(this.opts.localGitDir), { recursive: true });
      await plain.exec(["init", "--separate-git-dir", this.opts.localGitDir, this.root]);
    }
    upsertBlock(join(this.root, ".gitignore"), IGNORE_LINES);
    if (created) await this.snapshot("system", "initial snapshot of the library");
    return { created, state: this.state() };
  }

  /** Turns git LFS tracking for source files on or off. Returns whether it is on. */
  async setLfs(enabled: boolean): Promise<boolean> {
    const git = this.git();
    upsertBlock(join(this.root, ".gitattributes"), enabled ? LFS_LINES : []);
    if (enabled && git) await git.exec(["lfs", "install", "--local"], { allowFail: true });
    return enabled;
  }

  // Attribution --------------------------------------------------------------------------------

  /** Remembers who changed a file. The last actor wins when two touch the same file. */
  note(actor: string, rel: string, op?: string): void {
    this.pending.set(rel, actor);
    if (op) {
      const set = this.ops.get(actor) ?? new Set<string>();
      this.ops.set(actor, set);
      set.add(op);
    }
  }

  /** Commits after `quietMs` without further changes. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.commitNow().catch((err) => this.opts.onError?.(err));
    }, this.opts.quietMs);
    this.timer.unref();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  // Committing ---------------------------------------------------------------------------------

  /** Commits everything that changed, one commit per actor. Calls are queued, not run in parallel. */
  commitNow(): Promise<CommitRecord[]> {
    const run = this.chain.then(() => this.commitAll());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** One commit of everything under the given actor, with a fixed message. */
  async snapshot(actor: string, message: string): Promise<CommitRecord | undefined> {
    const run = this.chain.then(async () => {
      const git = this.git();
      if (!git) return undefined;
      const files = await this.changedPaths(git);
      if (files.length === 0) return undefined;
      return this.commitGroup(git, actor, files, `${actor}: ${message}`);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Paths git reports as changed, ignoring what .gitignore excludes. */
  async changedPaths(git: Git = this.git() as Git): Promise<string[]> {
    const res = await git.exec(["status", "--porcelain=v1", "-z", "-uall", "--no-renames"]);
    return res.stdout
      .split("\0")
      .filter((e) => e.length > 3)
      .map((e) => e.slice(3));
  }

  private async commitAll(): Promise<CommitRecord[]> {
    const git = this.git();
    if (!git) return [];
    const changed = await this.changedPaths(git);
    const groups = new Map<string, string[]>();
    for (const rel of changed) {
      const actor = this.pending.get(rel) ?? "system";
      const list = groups.get(actor);
      if (list) list.push(rel);
      else groups.set(actor, [rel]);
    }
    const opsByActor = new Map([...this.ops].map(([a, s]) => [a, [...s]] as const));
    this.pending.clear();
    this.ops.clear();
    const order = [...groups.keys()].sort((a, b) =>
      a === "human" ? -1 : b === "human" ? 1 : a.localeCompare(b),
    );
    const records: CommitRecord[] = [];
    for (const actor of order) {
      const files = (groups.get(actor) ?? []).sort();
      const message = `${actor}: ${summarize(files, opsByActor.get(actor) ?? [])}`;
      const rec = await this.commitGroup(git, actor, files, message);
      if (rec) records.push(rec);
    }
    return records;
  }

  private async commitGroup(
    git: Git,
    actor: string,
    files: string[],
    message: string,
  ): Promise<CommitRecord | undefined> {
    const input = `${files.join("\0")}\0`;
    const spec = ["--pathspec-from-file=-", "--pathspec-file-nul"];
    await git.exec(["add", "-A", ...spec], { input, env: { ...LITERAL_PATHS } });
    const env = { ...(await this.identity(git)), ...authorEnv(actor), ...LITERAL_PATHS };
    const res = await git.exec(["commit", "--no-verify", "-m", message, ...spec], {
      input,
      env,
      allowFail: true,
    });
    if (res.code !== 0) {
      if (/nothing (added to commit|to commit)|no changes added/i.test(res.stdout + res.stderr)) {
        return undefined;
      }
      throw new Error(`git commit failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }
    const sha = await git.out(["rev-parse", "--short", "HEAD"]);
    return { sha, message, actor, files: files.length };
  }

  /** Committer identity: the user's own when configured, a neutral one otherwise. */
  async identity(git: Git): Promise<Record<string, string>> {
    if (this.identityEnv) return this.identityEnv;
    const name = await git.out(["config", "user.name"], { allowFail: true });
    const email = await git.out(["config", "user.email"], { allowFail: true });
    this.identityEnv =
      name && email
        ? {}
        : { GIT_COMMITTER_NAME: "citegeist", GIT_COMMITTER_EMAIL: "citegeist@citegeist.local" };
    return this.identityEnv;
  }
}

function authorEnv(actor: string): Record<string, string> {
  return { GIT_AUTHOR_NAME: actor, GIT_AUTHOR_EMAIL: emailFor(actor) };
}

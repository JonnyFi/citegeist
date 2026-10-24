import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncConflict, SyncStatusResult } from "@citegeist/ops";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { ChangeEvent, Library } from "../library.js";
import {
  loadSyncConfig,
  type SyncConfig,
  saveSyncConfig,
  type Transport,
  validateRemote,
} from "./config.js";
import { listConflicts, resolveConflictFiles } from "./conflicts.js";
import { lfsInstalled } from "./git.js";
import { type BrctlRunner, downloadEvicted, isEvicted, scanEvicted } from "./icloud.js";
import { detectLocation, type LocationKind } from "./location.js";
import { currentBranch, setOrigin, syncWithRemote } from "./remote.js";
import { type CommitRecord, Versioner } from "./versioning.js";

export interface SyncServiceOptions {
  /** Where the library folder sits. Default: detected from its path. */
  location?: LocationKind;
  /** Replaces `brctl download` (tests). */
  runner?: BrctlRunner;
  /** Replaces the check for an installed git LFS (tests). */
  lfsInstalled?: () => Promise<boolean>;
  /** Run the background timer and commit after quiet periods. Default true. */
  autoStart?: boolean;
  /** Quiet period in milliseconds. Default: the configured `quietSeconds`. */
  quietMs?: number;
  /** Receives errors of background work (timer sync, quiet-period commits). */
  onError?: (err: unknown) => void;
  now?: () => Date;
}

export interface SyncNowResult {
  transport: Transport;
  commits: CommitRecord[];
  pulled: boolean;
  pushed: boolean;
  downloaded: string[];
  evicted: string[];
  conflicts: SyncConflict[];
  message: string;
}

export interface ConfigureInput {
  transport?: Transport | undefined;
  remote?: string | undefined;
  branch?: string | undefined;
  intervalMinutes?: number | undefined;
  versioning?: boolean | undefined;
  lfs?: "auto" | "on" | "off" | undefined;
}

/** The actor and operation behind the writes that happen while it runs. */
const context = new AsyncLocalStorage<{ actor: string; op: string }>();

/** Runs `fn` so that library changes it causes are committed as `actor`. */
export function runAs<T>(actor: string, op: string, fn: () => T): T {
  return context.run({ actor, op }, fn);
}

function refuse(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

/** Files that arrive from outside the core: workers write derived data, people edit in Obsidian. */
function externalActor(rel: string): string {
  return /(^|\/)derived\//.test(rel) ? "system" : "human";
}

/** Sync and versioning of one library. */
export class SyncService {
  readonly versioner: Versioner;
  readonly location: LocationKind;
  private config: SyncConfig;
  private readonly configPath: string;
  private timer: NodeJS.Timeout | undefined;
  private last: SyncStatusResult["lastSync"];
  private chain: Promise<unknown> = Promise.resolve();
  private listener: ((ev: ChangeEvent) => void) | undefined;

  constructor(
    private readonly lib: Library,
    private readonly opts: SyncServiceOptions = {},
  ) {
    this.configPath = join(lib.local.dir, "sync.json");
    this.config = loadSyncConfig(this.configPath);
    this.location = opts.location ?? detectLocation(lib.root);
    this.versioner = new Versioner(lib.root, {
      localGitDir: join(lib.local.dir, "git"),
      quietMs: opts.quietMs ?? this.config.quietSeconds * 1000,
      ...(opts.onError ? { onError: opts.onError } : {}),
    });
  }

  get settings(): Readonly<SyncConfig> {
    return this.config;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private lfsAvailable(): Promise<boolean> {
    return (this.opts.lfsInstalled ?? lfsInstalled)();
  }

  private needsSeparateGitDir(transport: Transport): boolean {
    return this.location !== "local" || transport === "icloud" || transport === "dropbox";
  }

  /** Attaches to the library, prepares the repository and starts the timer. */
  async start(): Promise<void> {
    if (this.listener) return;
    this.listener = (ev) => this.onChange(ev);
    this.lib.on("change", this.listener);
    if (this.config.versioning) {
      await this.versioner.ensureRepo(this.needsSeparateGitDir(this.config.transport));
    }
    if (this.opts.autoStart !== false) this.restartTimer();
  }

  close(): void {
    if (this.listener) this.lib.off("change", this.listener);
    this.listener = undefined;
    this.versioner.cancel();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private onChange(ev: ChangeEvent): void {
    if (!this.config.versioning) return;
    const who = context.getStore();
    const actor = who?.actor ?? (ev.external ? externalActor(ev.rel) : "system");
    this.versioner.note(actor, ev.rel, who?.op);
    if (this.opts.autoStart !== false) this.versioner.schedule();
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.config.transport === "none") return;
    this.timer = setInterval(() => {
      this.sync({ downloadAll: false }).catch((err) => this.opts.onError?.(err));
    }, this.config.intervalMinutes * 60_000);
    this.timer.unref();
  }

  // Operations ---------------------------------------------------------------------------------

  async configure(input: ConfigureInput): Promise<SyncStatusResult> {
    const next: SyncConfig = { ...this.config };
    const transport = input.transport ?? next.transport;
    next.transport = transport;
    if (input.branch) next.branch = input.branch;
    if (input.intervalMinutes) next.intervalMinutes = input.intervalMinutes;
    if (input.lfs) next.lfs = input.lfs;

    if (transport === "git") {
      if (this.location !== "local") {
        throw refuse(
          "SYNC_GIT_REMOTE_IN_SYNCED_FOLDER",
          `The library sits in ${this.location === "icloud" ? "iCloud Drive" : "Dropbox"} (${this.lib.root}); a git remote would be a second sync transport next to it`,
          'Keep one transport. Either stay with sync.configure {transport: "icloud"} (git history stays local and keeps working), or move the library folder out of the synced folder and configure the git remote again.',
          { location: this.location, path: this.lib.root },
        );
      }
      const remote = input.remote ?? next.remote;
      if (!remote) {
        throw refuse(
          "SYNC_REMOTE_MISSING",
          "The transport git needs a remote address",
          'Call sync.configure again with {transport: "git", remote: "<url>"}.',
        );
      }
      validateRemote(remote);
      next.remote = remote;
      if (input.versioning === false) {
        throw refuse(
          "SYNC_GIT_NEEDS_VERSIONING",
          "The transport git cannot work without git versioning",
          "Leave `versioning` out or set it to true.",
        );
      }
    } else if (input.remote) {
      validateRemote(input.remote);
      next.remote = input.remote;
    }
    if (transport === "icloud" && this.location !== "icloud") {
      throw refuse(
        "SYNC_NOT_IN_ICLOUD",
        `The library is at ${this.lib.root}, which is not in iCloud Drive`,
        "Move the library folder into iCloud Drive (~/Library/Mobile Documents/com~apple~CloudDocs) and open it from there, or pick another transport.",
        { path: this.lib.root },
      );
    }
    if (transport === "dropbox" && this.location === "icloud") {
      throw refuse(
        "SYNC_NOT_IN_DROPBOX",
        `The library is at ${this.lib.root}, which is in iCloud Drive and not in a Dropbox folder`,
        'Use sync.configure {transport: "icloud"}, or move the library into your Dropbox folder first.',
        { path: this.lib.root },
      );
    }
    next.versioning =
      transport === "git" ? true : (input.versioning ?? (transport !== "none" || next.versioning));

    let lfsOn = false;
    if (transport === "git") {
      const installed = await this.lfsAvailable();
      if (next.lfs === "on" && !installed) {
        throw refuse(
          "SYNC_LFS_MISSING",
          "git LFS was requested but is not installed",
          'Install it with `brew install git-lfs`, or call sync.configure with {lfs: "auto"} or {lfs: "off"}.',
        );
      }
      lfsOn = next.lfs === "on" || (next.lfs === "auto" && installed);
    }

    saveSyncConfig(this.configPath, next);
    this.config = next;
    if (next.versioning) {
      await this.versioner.ensureRepo(this.needsSeparateGitDir(transport));
      await this.versioner.setLfs(lfsOn);
      const git = this.versioner.git();
      if (git && transport === "git" && next.remote) await setOrigin(git, next.remote);
      await this.versioner.snapshot("system", "sync configuration");
    }
    this.restartTimer();
    return this.status();
  }

  /** Runs `fn` after the previous sync or resolution has finished. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  sync(input: { downloadAll: boolean }): Promise<SyncNowResult> {
    return this.serial(async () => {
      try {
        const result = await this.syncOnce(input);
        this.last = { at: this.now().toISOString(), ok: true, message: result.message };
        return result;
      } catch (err) {
        this.last = {
          at: this.now().toISOString(),
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
        throw err;
      }
    });
  }

  private async syncOnce(input: { downloadAll: boolean }): Promise<SyncNowResult> {
    const { transport } = this.config;
    const result: SyncNowResult = {
      transport,
      commits: [],
      pulled: false,
      pushed: false,
      downloaded: [],
      evicted: [],
      conflicts: [],
      message: "",
    };
    if (this.config.versioning) {
      await this.versioner.ensureRepo(this.needsSeparateGitDir(transport));
      result.commits = await this.versioner.commitNow();
    }
    const notes: string[] = [];
    if (result.commits.length > 0) notes.push(`${result.commits.length} commit(s)`);
    if (transport === "git") {
      const git = this.versioner.git();
      if (!git || !this.config.remote) {
        throw refuse(
          "SYNC_NOT_CONFIGURED",
          "The git remote is not set up",
          'Call sync.configure with {transport: "git", remote: "<url>"}.',
        );
      }
      await setOrigin(git, this.config.remote);
      const branch = this.config.branch ?? (await currentBranch(git)) ?? "main";
      const outcome = await syncWithRemote(
        git,
        this.lib.root,
        branch,
        await this.versioner.identity(git),
      );
      result.pulled = outcome.pulled;
      result.pushed = outcome.pushed;
      if (outcome.pulled) notes.push("pulled");
      if (outcome.pushed) notes.push("pushed");
      if (outcome.conflicts.length > 0) {
        notes.push(`${outcome.conflicts.length} conflict(s), both versions kept side by side`);
      }
    } else if (transport === "icloud" || this.location === "icloud") {
      const evicted = scanEvicted(this.lib.root);
      const wanted = evicted.filter((e) => input.downloadAll || e.needed).map((e) => e.rel);
      const got = await downloadEvicted(this.lib.root, wanted, {
        ...(this.opts.runner ? { runner: this.opts.runner } : {}),
      });
      result.downloaded = got.downloaded;
      result.evicted = scanEvicted(this.lib.root).map((e) => e.rel);
      if (got.downloaded.length > 0) notes.push(`downloaded ${got.downloaded.length} file(s)`);
      if (got.failed.length > 0) notes.push(`${got.failed.length} download(s) failed`);
    }
    if (result.pulled || result.downloaded.length > 0) {
      try {
        this.lib.sync();
      } catch {
        // the watcher catches up on its own
      }
    }
    result.conflicts = await listConflicts(this.lib.root);
    if (result.conflicts.length > 0 && !notes.some((n) => n.includes("conflict"))) {
      notes.push(`${result.conflicts.length} conflict(s) to resolve`);
    }
    result.message = notes.length > 0 ? notes.join(", ") : "nothing to do";
    return result;
  }

  resolveConflict(
    actor: Actor,
    input: { path: string; copy?: string | undefined; keep: "a" | "b" | "both" },
  ) {
    return this.serial(async () => {
      const conflicts = await listConflicts(this.lib.root);
      const res = resolveConflictFiles(this.lib.root, conflicts, input);
      try {
        this.lib.sync();
      } catch {
        // the watcher catches up on its own
      }
      if (this.config.versioning && this.versioner.git()) {
        for (const p of [...res.kept, ...res.removed]) {
          this.versioner.note(actor, p, "sync.resolveConflict");
        }
        await this.versioner.commitNow();
      }
      return res;
    });
  }

  /** Downloads an evicted iCloud file when it is needed. Returns true when the file is local. */
  async ensureLocal(rel: string): Promise<boolean> {
    if (!isEvicted(this.lib.root, rel)) return true;
    const got = await downloadEvicted(this.lib.root, [rel], {
      ...(this.opts.runner ? { runner: this.opts.runner } : {}),
    });
    return got.downloaded.length > 0;
  }

  async status(): Promise<SyncStatusResult> {
    const git = this.versioner.git();
    const state = this.versioner.state();
    const lfsOnDisk = git ? this.lfsTracking() : false;
    const info: SyncStatusResult["git"] = {
      initialised: git !== undefined,
      gitDir: state.kind,
      ...(state.gitDir ? { gitDirPath: state.gitDir } : {}),
      uncommitted: 0,
      lfs: {
        mode: this.config.lfs,
        installed: await this.lfsAvailable(),
        tracking: lfsOnDisk,
      },
    };
    if (git) {
      const branch = await currentBranch(git);
      if (branch) info.branch = branch;
      const head = await git.exec(["log", "-1", "--format=%h%x00%s%x00%cI"], { allowFail: true });
      if (head.code === 0 && head.stdout.trim()) {
        const [sha = "", message = "", at = ""] = head.stdout.trim().split("\0");
        info.head = sha;
        info.lastCommit = { sha, message, at };
      }
      info.uncommitted = (await this.versioner.changedPaths(git).catch(() => [])).length;
      const url = await git.exec(["remote", "get-url", "origin"], { allowFail: true });
      if (url.code === 0) {
        const remote: NonNullable<SyncStatusResult["git"]["remote"]> = { url: url.stdout.trim() };
        if (branch) {
          const counts = await git.exec(
            ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${branch}`],
            { allowFail: true },
          );
          const m = /^(\d+)\s+(\d+)/.exec(counts.stdout.trim());
          if (counts.code === 0 && m) {
            remote.ahead = Number(m[1]);
            remote.behind = Number(m[2]);
          }
        }
        info.remote = remote;
      }
    }
    return {
      transport: this.config.transport,
      location: this.location,
      versioning: this.config.versioning,
      intervalMinutes: this.config.intervalMinutes,
      git: info,
      evicted:
        this.location === "icloud" || this.config.transport === "icloud"
          ? scanEvicted(this.lib.root).map((e) => e.rel)
          : [],
      conflicts: await listConflicts(this.lib.root),
      ...(this.last ? { lastSync: this.last } : {}),
    };
  }

  private lfsTracking(): boolean {
    const file = join(this.lib.root, ".gitattributes");
    return existsSync(file) && readFileSync(file, "utf8").includes("filter=lfs");
  }
}

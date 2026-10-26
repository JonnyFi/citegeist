import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Sync and versioning (docs/decisions/0005-sync-and-versioning.md). Exactly one sync transport is active at a
// time: a synced folder (iCloud or Dropbox) or a git remote. git history is always allowed.

export const SyncTransport = z.enum(["none", "icloud", "dropbox", "git"]);
export type SyncTransport = z.infer<typeof SyncTransport>;

const FileInfo = z.object({
  /** Library-relative path with forward slashes. */
  path: z.string(),
  size: z.number().int().nonnegative(),
  modified: z.string(),
});

/**
 * Two versions of one file. `a` is the file under its own name (after a git sync: the version
 * of this Mac), `b` is the conflict copy next to it (after a git sync: the version of the
 * remote; for iCloud and Dropbox: the copy the service made).
 */
export const SyncConflict = z.object({
  path: z.string(),
  copy: z.string(),
  a: FileInfo,
  b: FileInfo,
  identical: z.boolean(),
  /** Unified line diff from a to b for text files, cut off at 8000 characters. */
  diff: z.string().optional(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;

const CommitInfo = z.object({
  sha: z.string(),
  message: z.string(),
  actor: z.string(),
  files: z.number().int().nonnegative(),
});

export const SyncStatusResult = z.object({
  transport: SyncTransport,
  /** Where the library folder sits: a plain folder, iCloud Drive or Dropbox. */
  location: z.enum(["local", "icloud", "dropbox"]),
  versioning: z.boolean(),
  intervalMinutes: z.number().int().positive(),
  git: z.object({
    initialised: z.boolean(),
    /** "separate" means the .git directory lives in the machine-local folder. */
    gitDir: z.enum(["none", "embedded", "separate", "broken"]),
    gitDirPath: z.string().optional(),
    branch: z.string().optional(),
    head: z.string().optional(),
    /** Files with changes that are not committed yet. */
    uncommitted: z.number().int().nonnegative(),
    lastCommit: z.object({ sha: z.string(), message: z.string(), at: z.string() }).optional(),
    remote: z
      .object({
        url: z.string(),
        ahead: z.number().int().nonnegative().optional(),
        behind: z.number().int().nonnegative().optional(),
      })
      .optional(),
    lfs: z.object({
      mode: z.enum(["auto", "on", "off"]),
      installed: z.boolean(),
      tracking: z.boolean(),
    }),
  }),
  /** iCloud files that are not on this Mac yet. */
  evicted: z.array(z.string()),
  conflicts: z.array(SyncConflict),
  lastSync: z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).optional(),
});
export type SyncStatusResult = z.infer<typeof SyncStatusResult>;

export const syncStatus = defineContract({
  name: "sync.status",
  summary: "Sync transport, git history state, evicted iCloud files and file conflicts",
  access: "read",
  input: z.object({}),
  output: SyncStatusResult,
});

export const syncConfigure = defineContract({
  name: "sync.configure",
  summary:
    "Choose the one sync transport (iCloud folder, Dropbox folder or git remote) and turn git versioning on or off; a git remote is refused while the library sits in iCloud or Dropbox",
  access: "write",
  input: z.object({
    transport: SyncTransport.optional(),
    /** Remote URL, required for the transport "git" unless one is stored. */
    remote: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    /** How often the background sync runs. */
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    /** Keep a git history of the library with one commit per actor. Default: on once a transport is set. */
    versioning: z.boolean().optional(),
    /** Store PDFs in git LFS. "auto" uses it when git-lfs is installed. */
    lfs: z.enum(["auto", "on", "off"]).optional(),
  }),
  output: SyncStatusResult,
});

export const syncNow = defineContract({
  name: "sync.now",
  summary:
    "Commit pending changes, then sync once: git pull with rebase and push, or download iCloud files and look for conflicts",
  access: "write",
  input: z.object({
    /** iCloud: also download source PDFs, not only the files the index needs. */
    downloadAll: z.boolean().default(false),
  }),
  output: z.object({
    transport: SyncTransport,
    commits: z.array(CommitInfo),
    pulled: z.boolean(),
    pushed: z.boolean(),
    downloaded: z.array(z.string()),
    evicted: z.array(z.string()),
    conflicts: z.array(SyncConflict),
    message: z.string(),
  }),
});

export const syncResolveConflict = defineContract({
  name: "sync.resolveConflict",
  summary:
    "Resolve a file conflict: keep a (the file under its name), keep b (the conflict copy) or keep both (the copy becomes its own file)",
  access: "write",
  input: z.object({
    /** Library-relative path of the file that has a conflict copy. */
    path: z.string().min(1),
    /** Conflict copy, needed only when the file has more than one. */
    copy: z.string().min(1).optional(),
    keep: z.enum(["a", "b", "both"]),
  }),
  output: z.object({
    path: z.string(),
    keep: z.enum(["a", "b", "both"]),
    /** Files that exist after the resolution. */
    kept: z.array(z.string()),
    removed: z.array(z.string()),
  }),
});

export const SYNC_CONTRACTS: readonly OperationContract[] = [
  syncStatus,
  syncConfigure,
  syncNow,
  syncResolveConflict,
];

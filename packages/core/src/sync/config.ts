import { readFileSync } from "node:fs";
import { CitegeistError } from "@citegeist/schema";
import { writeFileAtomic } from "../fsutil.js";

export type Transport = "none" | "icloud" | "dropbox" | "git";

/** Machine-local sync settings of one library (`<local dir>/sync.json`). */
export interface SyncConfig {
  transport: Transport;
  remote?: string;
  branch?: string;
  intervalMinutes: number;
  versioning: boolean;
  /** Seconds without changes before the pending changes are committed. */
  quietSeconds: number;
  lfs: "auto" | "on" | "off";
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  transport: "none",
  intervalMinutes: 10,
  versioning: false,
  quietSeconds: 30,
  lfs: "auto",
};

const TRANSPORTS = new Set(["none", "icloud", "dropbox", "git"]);

export function loadSyncConfig(path: string): SyncConfig {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncConfig>;
    const out: SyncConfig = { ...DEFAULT_SYNC_CONFIG };
    if (typeof raw.transport === "string" && TRANSPORTS.has(raw.transport)) {
      out.transport = raw.transport;
    }
    if (typeof raw.remote === "string" && raw.remote) out.remote = raw.remote;
    if (typeof raw.branch === "string" && raw.branch) out.branch = raw.branch;
    if (Number.isInteger(raw.intervalMinutes) && (raw.intervalMinutes as number) > 0) {
      out.intervalMinutes = raw.intervalMinutes as number;
    }
    if (typeof raw.versioning === "boolean") out.versioning = raw.versioning;
    if (Number.isFinite(raw.quietSeconds) && (raw.quietSeconds as number) >= 0) {
      out.quietSeconds = raw.quietSeconds as number;
    }
    if (raw.lfs === "on" || raw.lfs === "off" || raw.lfs === "auto") out.lfs = raw.lfs;
    return out;
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

export function saveSyncConfig(path: string, config: SyncConfig): void {
  writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** Accepts https, ssh, git and file URLs, scp-style addresses and absolute paths. */
export function validateRemote(url: string): void {
  const ok =
    /^(https?|ssh|git|file):\/\/\S+$/.test(url) ||
    /^[\w.-]+@[\w.-]+:\S+$/.test(url) ||
    url.startsWith("/");
  if (!ok || url.startsWith("-")) {
    throw new CitegeistError({
      code: "SYNC_REMOTE_INVALID",
      message: `"${url}" is not a usable git remote address`,
      fix: "Pass an address like https://github.com/you/library.git, git@github.com:you/library.git or an absolute path to a bare repository.",
      recovery: "fix-and-retry",
      context: { remote: url },
    });
  }
}

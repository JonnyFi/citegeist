import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * One core per library. `core.lock` (pid and port) sits in the machine-local directory of the
 * library, `core.token` next to it with mode 0600. This file is pure fs on purpose: the Electron
 * main process uses it without loading the native modules of the core. A test pins the paths to
 * `LocalPaths` of @citegeist/core.
 */

export interface LockInfo {
  pid: number;
  /** 0 while the core is starting and has not bound its port yet. */
  port: number;
  started: string;
}

export function defaultLocalBase(): string {
  return join(homedir(), "Library", "Application Support", "citegeist");
}

export function localDir(localBase: string, libraryId: string): string {
  return join(localBase, libraryId);
}
export const lockFile = (dir: string) => join(dir, "core.lock");
export const tokenFile = (dir: string) => join(dir, "core.token");

/** Library id from citegeist.json, or undefined if the folder is not a library. */
export function readLibraryId(libraryPath: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(libraryPath, "citegeist.json"), "utf8")) as {
      id?: unknown;
    };
    return typeof manifest.id === "string" && manifest.id.length >= 8 ? manifest.id : undefined;
  } catch {
    return undefined;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(dir: string): LockInfo | undefined {
  try {
    const v = JSON.parse(readFileSync(lockFile(dir), "utf8")) as Partial<LockInfo>;
    if (typeof v.pid === "number" && typeof v.port === "number") {
      return { pid: v.pid, port: v.port, started: String(v.started ?? "") };
    }
  } catch {
    // missing or half-written: treated as no lock
  }
  return undefined;
}

export function readToken(dir: string): string | undefined {
  try {
    return readFileSync(tokenFile(dir), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export class LockHeldError extends Error {
  constructor(readonly holder: LockInfo) {
    super(`library is served by core pid ${holder.pid} (port ${holder.port})`);
    this.name = "LockHeldError";
  }
}

function writeAtomic(path: string, content: string, mode: number): void {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/**
 * Takes the lock for this process or throws LockHeldError when a live core holds it. A lock whose
 * pid is dead is stale and gets replaced.
 */
export function acquireLock(dir: string, pid = process.pid): void {
  // The folder holds the token of the core, so no other user of the Mac may list or enter it. An
  // existing folder from an older version gets the same mode.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const info: LockInfo = { pid, port: 0, started: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(lockFile(dir), `${JSON.stringify(info)}\n`, { flag: "wx", mode: 0o600 });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = readLock(dir);
      if (holder && pidAlive(holder.pid)) throw new LockHeldError(holder);
      rmSync(lockFile(dir), { force: true });
    }
  }
  throw new Error(`could not take ${lockFile(dir)}`);
}

/** Publishes port and token once the server listens. */
export function publishLock(dir: string, port: number, token: string, pid = process.pid): void {
  writeAtomic(tokenFile(dir), `${token}\n`, 0o600);
  const info: LockInfo = { pid, port, started: new Date().toISOString() };
  writeAtomic(lockFile(dir), `${JSON.stringify(info)}\n`, 0o600);
}

/** Removes lock and token, but only if this process still owns them. */
export function releaseLock(dir: string, pid = process.pid): void {
  if (readLock(dir)?.pid !== pid) return;
  rmSync(lockFile(dir), { force: true });
  if (existsSync(tokenFile(dir))) rmSync(tokenFile(dir), { force: true });
}

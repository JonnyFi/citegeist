import { readFileSync } from "node:fs";
import { CitegeistError } from "@citegeist/schema";

export interface CoreLock {
  pid: number;
  port?: number;
}

/**
 * Reads core.lock. The architecture says it holds PID and port; this accepts JSON
 * (`{"pid":1,"port":2}`) or plain text with the pid first (`1 2`, `1\n2`). Returns undefined when
 * the file is missing or unreadable.
 */
export function readCoreLock(path: string): CoreLock | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json === "number") return { pid: json };
    if (typeof json === "object" && json !== null && "pid" in json) {
      const { pid, port } = json as { pid: unknown; port?: unknown };
      if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
        return typeof port === "number" ? { pid, port } : { pid };
      }
    }
    return undefined;
  } catch {
    const nums = text.match(/\d+/g)?.map(Number) ?? [];
    const [pid, port] = nums;
    if (pid === undefined || pid <= 0) return undefined;
    return port === undefined ? { pid } : { pid, port };
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lock when it names a live process other than this one, else undefined. */
export function liveForeignLock(path: string): CoreLock | undefined {
  const lock = readCoreLock(path);
  if (!lock || lock.pid === process.pid || !isAlive(lock.pid)) return undefined;
  return lock;
}

export function ownedByApp(operation: string, lock: CoreLock, lockPath: string): CitegeistError {
  return new CitegeistError({
    code: "LIBRARY_OWNED_BY_APP",
    message: `The citegeist app (pid ${lock.pid}${lock.port ? `, port ${lock.port}` : ""}) owns this library, so ${operation} was not run.`,
    fix: "Ask the user to make this change in the citegeist app, or to quit the app and run the command again. Read operations still work.",
    recovery: "ask-human",
    sideEffects: "none",
    context: { operation, pid: lock.pid, lock: lockPath },
  });
}

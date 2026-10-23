import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Name pattern of temp files used by atomic writes. The watcher ignores them. */
export const TEMP_FILE = /^\..*\.[0-9a-f]{8}\.tmp$/;

/** Writes through a temp file in the same directory, then renames. Readers never see half a file. */
export function writeFileAtomic(absPath: string, content: string | Uint8Array): void {
  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(absPath)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, absPath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

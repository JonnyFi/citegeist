import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { CitegeistError } from "@citegeist/schema";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** `prefix` plus a 26 character ULID: sortable by creation time, unique enough for local use. */
export function newId(prefix: string, now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let tail = "";
  for (let i = 0; i < 16; i++) tail += CROCKFORD.charAt((rnd[i] ?? 0) % 32);
  return `${prefix}${time}${tail}`;
}

/**
 * Atomic write through a temp file next to the target. The temp name matches the core's
 * TEMP_FILE pattern, so the library watcher ignores it.
 */
export function writeAtomic(absPath: string, content: string): void {
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

/** Root-relative path with forward slashes, or undefined when `abs` is outside `root`. */
export function relativeInside(root: string, abs: string): string | undefined {
  if (!isAbsolute(abs)) return undefined;
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

export function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "chat";
}

export function chatError(
  code: string,
  message: string,
  fix: string,
  recovery: "retry" | "fix-and-retry" | "do-first" | "ask-human" = "fix-and-retry",
  context: Record<string, unknown> = {},
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, sideEffects: "none", context });
}

/** Cut long text so errors and details stay one readable line. */
export function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

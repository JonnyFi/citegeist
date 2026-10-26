import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Size of one log file before it rotates, and how many files are kept (core.log, .1, .2). */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_FILES = 3;

const MARK = "[redacted]";

/**
 * Removes what must not reach a log file: bearer tokens, API keys, and values of fields named
 * like a secret (`token=...`, `"apiKey": "..."`, `Authorization: ...`).
 */
export function redact(text: string): string {
  return text
    .replace(
      /\b(authorization|x-api-key|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|cookie)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',&;]+/gi,
      (_whole, name: string, sep: string) => `${name}${sep}${MARK}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${MARK}`)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, MARK)
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, MARK)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, MARK)
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MARK);
}

export interface RotatingLogOptions {
  maxBytes?: number;
  files?: number;
  /** Clock for the time stamps; tests pass a fixed one. */
  now?: () => Date;
}

/**
 * Appends lines to a file and rotates it at `maxBytes`: `core.log` becomes `core.log.1`, that
 * one `core.log.2`, and the oldest file is dropped. Every line passes through `redact`.
 */
export class RotatingLog {
  private size = 0;
  private readonly maxBytes: number;
  private readonly files: number;
  private readonly now: () => Date;

  constructor(
    readonly file: string,
    options: RotatingLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
    this.files = options.files ?? LOG_FILES;
    this.now = options.now ?? (() => new Date());
    try {
      mkdirSync(dirname(file), { recursive: true });
      this.size = existsSync(file) ? statSync(file).size : 0;
    } catch {
      this.size = 0;
    }
  }

  /** Writes `message` as one line per input line, each tagged with the time and `source`. */
  write(source: string, message: string): void {
    const stamp = this.now().toISOString();
    const lines = redact(message)
      .replace(/\r?\n$/, "")
      .split(/\r?\n/)
      .map((line) => `${stamp} [${source}] ${line}\n`)
      .join("");
    try {
      if (this.size > 0 && this.size + Buffer.byteLength(lines) > this.maxBytes) this.rotate();
      appendFileSync(this.file, lines);
      this.size += Buffer.byteLength(lines);
    } catch {
      // a log that cannot be written must never take the app down
    }
  }

  private rotate(): void {
    const last = `${this.file}.${this.files - 1}`;
    rmSync(last, { force: true });
    for (let i = this.files - 2; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`);
    this.size = 0;
  }
}

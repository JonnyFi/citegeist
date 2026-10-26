import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RotatingLog, redact } from "./log.js";

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-log-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("redact", () => {
  it("hides bearer tokens, header values and key fields", () => {
    expect(redact("Authorization: Bearer abcdef123456")).toBe("Authorization: [redacted]");
    expect(redact("connect ws://127.0.0.1:5000/?token=s3cr3t&x=1")).toBe(
      "connect ws://127.0.0.1:5000/?token=[redacted]&x=1",
    );
    expect(redact('{"apiKey": "abc123", "ok": true}')).toBe('{"apiKey": "[redacted]", "ok": true}');
    expect(redact("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe("key [redacted]");
    expect(redact("sent Bearer abcdefghijkl to hook")).toBe("sent Bearer [redacted] to hook");
  });

  it("leaves ordinary lines alone", () => {
    expect(redact("library opened: /Users/a/Papers")).toBe("library opened: /Users/a/Papers");
  });
});

describe("RotatingLog", () => {
  it("tags every line with time and source", () => {
    const file = join(tmp(), "logs", "core.log");
    const log = new RotatingLog(file, { now: () => new Date("2026-01-02T03:04:05.000Z") });
    log.write("core", "hello\nsecond");
    expect(readFileSync(file, "utf8")).toBe(
      "2026-01-02T03:04:05.000Z [core] hello\n2026-01-02T03:04:05.000Z [core] second\n",
    );
  });

  it("never writes a secret", () => {
    const file = join(tmp(), "core.log");
    new RotatingLog(file).write("core", "token=abc123def");
    expect(readFileSync(file, "utf8")).not.toContain("abc123def");
  });

  it("rotates at the size limit and keeps three files", () => {
    const file = join(tmp(), "core.log");
    const log = new RotatingLog(file, { maxBytes: 200, files: 3, now: () => new Date(0) });
    for (let i = 0; i < 12; i++) log.write("core", `line number ${i} with some padding to fill up`);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    expect(existsSync(`${file}.3`)).toBe(false);
    expect(readFileSync(file, "utf8")).toContain("line number 11");
  });

  it("continues an existing file", () => {
    const file = join(tmp(), "core.log");
    writeFileSync(file, "old\n");
    new RotatingLog(file).write("main", "new");
    expect(readFileSync(file, "utf8")).toMatch(/^old\n.* \[main\] new\n$/);
  });
});

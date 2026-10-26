import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, publishLock, releaseLock, tokenFile } from "./lockfile.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-lock-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const mode = (path: string) => statSync(path).mode & 0o777;

describe("lock folder", () => {
  it("is created private, and so are the lock and the token inside it", () => {
    const dir = join(tmp, "app", "library-id");
    acquireLock(dir);
    publishLock(dir, 4711, "secret-token");
    expect(mode(dir)).toBe(0o700);
    expect(mode(tokenFile(dir))).toBe(0o600);
    releaseLock(dir);
  });

  it("is tightened when an older version created it with the default mask", () => {
    const dir = join(tmp, "old");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    acquireLock(dir);
    expect(mode(dir)).toBe(0o700);
    releaseLock(dir);
  });
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isTransient } from "../jobs/queue.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { ChildProcessConvertWorker, createStubWorker } from "./worker.js";

const workers: ChildProcessConvertWorker[] = [];
afterEach(async () => {
  for (const w of workers.splice(0)) await w.close();
  cleanTmpDirs();
});

function stub(opts: Parameters<typeof createStubWorker>[0] = {}) {
  const w = createStubWorker(opts);
  workers.push(w);
  return w;
}

function params(dir = tmpDir("cg-w-")) {
  const sourcePath = join(dir, "in.pdf");
  writeFileSync(sourcePath, "%PDF-1.4\n");
  return { sourcePath, source: "0123456789ab", outDir: join(dir, "out"), kind: "pdf" as const };
}

describe("ChildProcessConvertWorker", () => {
  it("answers health and convert over JSON-RPC and writes the derived files", async () => {
    const w = stub();
    const health = await w.health();
    expect(health).toMatchObject({ ready: true, version: "stub-1.0.0" });
    const p = params();
    const progress: Array<[number | undefined, string | undefined]> = [];
    const res = await w.convert(p, { onProgress: (v, message) => progress.push([v, message]) });
    expect(res.manifest).toMatchObject({ source: "0123456789ab", path: "digital" });
    expect(progress).toEqual([
      [0.5, "stub converting"],
      [undefined, "stub writing files"],
    ]);
    expect(existsSync(join(p.outDir, "doc.md"))).toBe(true);
    expect(readFileSync(join(p.outDir, "doc.md"), "utf8")).toContain("<!-- page 0 label=10 -->");
  });

  it("treats a crash as a transient error and starts a fresh process for the next call", async () => {
    const crash = join(tmpDir("cg-w-"), "crashed");
    const w = stub({ env: { CG_STUB_CRASH_ONCE: crash } });
    const err = await w.convert(params()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isTransient(err)).toBe(true);
    expect((err as Error).message).toContain("exited with code 3");
    const res = await w.convert(params());
    expect(res.manifest.path).toBe("digital");
  });

  it("reports a worker error as permanent with an agent-ready message", async () => {
    const w = stub({ env: { CG_STUB_FAIL: "1" } });
    const err = await w.convert(params()).catch((e: unknown) => e);
    expect(isTransient(err)).toBe(false);
    expect(err).toMatchObject({
      detail: { code: "CONVERT_FAILED", context: { method: "convert", rpcCode: -32001 } },
    });
  });

  it("kills the process when the request is cancelled and recovers afterwards", async () => {
    const w = stub();
    const controller = new AbortController();
    const slow = new ChildProcessConvertWorker({
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
    });
    workers.push(slow);
    const pending = slow.convert(params(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // an aborted signal fails before any process starts
    await expect(slow.convert(params(), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect((await w.convert(params())).manifest.source).toBe("0123456789ab");
  });

  it("stops an idle child and starts it again on demand", async () => {
    const w = stub({ idleMs: 30 });
    await w.health();
    await new Promise((r) => setTimeout(r, 120));
    expect((await w.health()).ready).toBe(true);
  });

  it("rejects an answer that does not match the schema", async () => {
    const script = `
      require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
        const req = JSON.parse(l);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { nope: 1 } }) + "\\n");
      });`;
    const w = new ChildProcessConvertWorker({ command: process.execPath, args: ["-e", script] });
    workers.push(w);
    await expect(w.health()).rejects.toMatchObject({ detail: { code: "WORKER_PROTOCOL" } });
  });

  it("treats a retryable JSON-RPC error as transient", async () => {
    const script = `
      require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
        const req = JSON.parse(l);
        process.stdout.write("warming up\\n");
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "model loading", data: { retryable: true } } }) + "\\n");
      });`;
    const w = new ChildProcessConvertWorker({ command: process.execPath, args: ["-e", script] });
    workers.push(w);
    const err = await w.health().catch((e: unknown) => e);
    expect(isTransient(err)).toBe(true);
    expect((err as Error).message).toContain("model loading");
  });

  it("fails clearly when the command does not exist", async () => {
    const w = new ChildProcessConvertWorker({ command: "/nonexistent/worker-binary" });
    workers.push(w);
    const err = await w.health().catch((e: unknown) => e);
    expect(isTransient(err)).toBe(true);
    expect((err as Error).message).toContain("could not start");
  });
});

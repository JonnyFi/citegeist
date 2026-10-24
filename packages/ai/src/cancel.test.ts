import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CitegeistError } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeCodeCliBackend } from "./backends/claude-cli.js";
import { OpenAiCompatBackend } from "./backends/openai-http.js";
import { nodeRunner } from "./runner.js";
import { runTask } from "./tasks/registry.js";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "cg-cancel-"));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * A fake CLI that starts a grandchild (`sleep`) and then waits itself. It writes both pids to
 * `pids.json`, so a test can look for them after the cancel.
 */
function fakeCli(dir: string, body = ""): string {
  const file = join(dir, "fake-claude");
  writeFileSync(
    file,
    `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.307 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
${body}
const child = spawn("sleep", ["60"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(join(dir, "pids.json"))}, JSON.stringify({ parent: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function pids(dir: string): { parent: number; child: number } {
  return JSON.parse(readFileSync(join(dir, "pids.json"), "utf8")) as {
    parent: number;
    child: number;
  };
}

describe("cancelling a CLI call", () => {
  it("kills the process and the children it started", async () => {
    const dir = workdir();
    const controller = new AbortController();
    const run = nodeRunner({
      command: fakeCli(dir),
      args: ["-p"],
      cwd: dir,
      env: process.env,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    await until(() => existsSync(join(dir, "pids.json")));
    const { parent, child } = pids(dir);
    expect(alive(parent)).toBe(true);
    expect(alive(child)).toBe(true);

    controller.abort();
    const result = await run;

    expect(result.aborted).toBe(true);
    await until(() => !alive(parent) && !alive(child));
  });

  it("does not start a process when the signal is already aborted", async () => {
    const dir = workdir();
    const result = await nodeRunner({
      command: fakeCli(dir),
      args: ["-p"],
      cwd: dir,
      env: process.env,
      timeoutMs: 60_000,
      signal: AbortSignal.abort(),
    });
    expect(result.aborted).toBe(true);
    expect(existsSync(join(dir, "pids.json"))).toBe(false);
  });

  it("kills the group on a timeout as well", async () => {
    const dir = workdir();
    const result = await nodeRunner({
      command: fakeCli(dir),
      args: ["-p"],
      cwd: dir,
      env: process.env,
      timeoutMs: 400,
    });
    expect(result.timedOut).toBe(true);
    const { parent, child } = pids(dir);
    await until(() => !alive(parent) && !alive(child));
  });

  it("ends a claude -p task with AI_CANCELLED and leaves no process behind", async () => {
    const dir = workdir();
    const backend = new ClaudeCodeCliBackend({
      command: fakeCli(dir),
      cwd: dir,
      pinnedVersion: null,
      env: { PATH: process.env.PATH },
    });
    const controller = new AbortController();
    const Out = z.object({ paraphrase: z.string(), core: z.string() });
    const call = backend.complete({
      task: "card.paraphrase",
      prompt: "x",
      schema: Out,
      signal: controller.signal,
    });
    await until(() => existsSync(join(dir, "pids.json")));
    const { parent, child } = pids(dir);

    controller.abort();
    const err = await call.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CitegeistError);
    expect((err as CitegeistError).detail.code).toBe("AI_CANCELLED");
    await until(() => !alive(parent) && !alive(child));
  });

  it("reports a cancelled task to the usage record as failed", async () => {
    const dir = workdir();
    const backend = new ClaudeCodeCliBackend({
      command: fakeCli(dir),
      cwd: dir,
      pinnedVersion: null,
      env: { PATH: process.env.PATH },
    });
    const controller = new AbortController();
    const records: Array<{ ok: boolean; error?: string | undefined }> = [];
    const run = runTask(
      backend,
      "card.paraphrase",
      { passage: "A passage that is long enough for the task to accept it as input." },
      { signal: controller.signal, record: (r) => records.push(r) },
    ).catch((e: unknown) => e);
    await until(() => existsSync(join(dir, "pids.json")));
    controller.abort();
    await run;
    expect(records).toEqual([expect.objectContaining({ ok: false, error: "AI_CANCELLED" })]);
  });
});

describe("cancelling an HTTP call", () => {
  it("aborts the request and reports AI_CANCELLED", async () => {
    let seen: AbortSignal | undefined;
    const backend = new OpenAiCompatBackend({
      id: "ollama",
      baseUrl: "http://localhost:11434/v1",
      models: { fast: "a", smart: "b" },
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          seen = init.signal as AbortSignal;
          seen.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });
    const controller = new AbortController();
    const call = backend
      .complete({
        task: "card.paraphrase",
        prompt: "x",
        schema: z.object({ a: z.string() }),
        signal: controller.signal,
      })
      .catch((e: unknown) => e);
    await until(() => seen !== undefined);
    controller.abort();
    const err = await call;
    expect((err as CitegeistError).detail.code).toBe("AI_CANCELLED");
    expect(seen?.aborted).toBe(true);
  });
});

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeCliBackend, MockBackend } from "@citegeist/ai";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createStubWorker } from "../ingest/worker.js";
import { Library } from "../library.js";
import { createRuntime, type Runtime } from "../runtime.js";
import { InMemoryKeychain } from "../settings/index.js";
import { cleanTmpDirs, itemData, itemFile, tmpDir, until, writeRaw } from "../test-helpers.js";
import { UsageLedger } from "./ledger.js";

afterEach(cleanTmpDirs);

describe("UsageLedger", () => {
  const T0 = new Date("2026-10-24T12:00:00.000Z");
  const entry = {
    source: "task" as const,
    task: "card.paraphrase",
    backend: "claude-code-cli",
    model: "claude-haiku-5-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    ms: 1200,
    ok: true,
    actor: "human",
  };

  it("sums by day, task and backend inside the window", () => {
    const ledger = new UsageLedger(join(tmpDir(), "state.sqlite"), () => T0);
    ledger.record({ ...entry, costUsd: 0.001, at: new Date("2026-10-24T09:00:00Z") });
    ledger.record({ ...entry, costUsd: 0.002, at: new Date("2026-10-24T10:00:00Z") });
    ledger.record({
      ...entry,
      task: "note.proposeLinks",
      backend: "codex-exec",
      at: new Date("2026-10-20T10:00:00Z"),
    });
    ledger.record({
      ...entry,
      ok: false,
      error: "AI_TIMEOUT",
      at: new Date("2026-10-01T10:00:00Z"),
    });

    const week = ledger.summary(7);
    expect(week.totals).toMatchObject({
      calls: 3,
      failed: 0,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 1500,
      pricedCalls: 2,
      ms: 3600,
    });
    expect(week.totals.costUsd).toBeCloseTo(0.003, 8);
    expect(week.byDay.map((d) => [d.day, d.calls])).toEqual([
      ["2026-10-20", 1],
      ["2026-10-24", 2],
    ]);
    expect(week.byTask.map((t) => [t.task, t.calls])).toEqual([
      ["card.paraphrase", 2],
      ["note.proposeLinks", 1],
    ]);
    expect(week.byBackend.map((b) => [b.backend, b.calls])).toEqual([
      ["claude-code-cli", 2],
      ["codex-exec", 1],
    ]);

    const month = ledger.summary(30);
    expect(month.totals).toMatchObject({ calls: 4, failed: 1 });
    ledger.close();
  });

  it("answers an empty window with zeros", () => {
    const ledger = new UsageLedger(join(tmpDir(), "state.sqlite"), () => T0);
    const s = ledger.summary(7);
    expect(s.totals).toMatchObject({ calls: 0, costUsd: 0, inputTokens: 0 });
    expect(s.byTask).toEqual([]);
    ledger.close();
  });
});

const human = { actor: "human" as Actor };
const CITEKEY = "luhmann1984soziale";
const QUOTE = "Soziale Systeme bestehen aus Kommunikationen.";

const open: Array<{ lib: Library; rt: Runtime }> = [];
afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
});

async function setup(backend: MockBackend | ClaudeCodeCliBackend) {
  const lib = await Library.init(tmpDir("cg-usage-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  writeRaw(lib.root, `items/${CITEKEY}/${CITEKEY}.md`, itemFile(itemData(CITEKEY)));
  lib.sync();
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    ai: { backends: [backend], routing: { routing: { "*": backend.id } } },
    settings: { keychain: new InMemoryKeychain() },
  });
  open.push({ lib, rt });
  const call = <T>(name: string, input: unknown) =>
    rt.registry.call(name, human, input) as Promise<T>;
  const createCard = () =>
    call<{ job: string }>("cards.create", {
      citekey: CITEKEY,
      anchor: { text: { exact: QUOTE } },
      quote: QUOTE,
    });
  return { rt, call, createCard };
}

describe("usage after an AI task", () => {
  it("shows the paraphrase in usage.summary", async () => {
    const backend = new MockBackend({
      "card.paraphrase": { paraphrase: "Systeme sind Kommunikation.", kind: "finding" },
    });
    backend.usage = {
      inputTokens: 40,
      outputTokens: 12,
      cacheReadTokens: 900,
      cacheWriteTokens: 30,
      costUsd: 0.0004,
      model: "claude-haiku-5-5",
    };
    const s = await setup(backend);
    const { job } = await s.createCard();
    expect((await s.rt.ingest.queue.waitFor(job)).status).toBe("succeeded");

    const summary = await s.call<{
      totals: { calls: number; cacheReadTokens: number; costUsd: number };
      byTask: Array<{ task: string; calls: number; inputTokens: number }>;
      byBackend: Array<{ backend: string }>;
    }>("usage.summary", { days: 7 });
    expect(summary.totals).toMatchObject({ calls: 1, cacheReadTokens: 900 });
    expect(summary.totals.costUsd).toBeCloseTo(0.0004, 8);
    expect(summary.byTask).toMatchObject([{ task: "card.paraphrase", calls: 1, inputTokens: 40 }]);
    expect(summary.byBackend).toMatchObject([{ backend: "mock" }]);

    const row = s.rt.usage.summary(1);
    expect(row.byDay).toHaveLength(1);
  });

  it("records the actor of the job and a failed call", async () => {
    const backend = new MockBackend({ "card.paraphrase": { nonsense: true } });
    const s = await setup(backend);
    const { job } = await s.createCard();
    expect((await s.rt.ingest.queue.waitFor(job)).status).toBe("failed");
    const summary = s.rt.usage.summary(1);
    expect(summary.totals).toMatchObject({ calls: 1, failed: 1 });
  });
});

/** A fake `claude` that answers the probes, then starts a `sleep` and waits. */
function fakeClaude(dir: string): string {
  const file = join(dir, "fake-claude");
  writeFileSync(
    file,
    `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.307 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const child = spawn("sleep", ["60"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(join(dir, "pids.json"))}, JSON.stringify({ parent: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("cancelling a job with a running AI call", () => {
  it("kills the CLI and its children and ends the job as cancelled", async () => {
    const dir = tmpDir("cg-fakecli-");
    const backend = new ClaudeCodeCliBackend({
      command: fakeClaude(dir),
      cwd: dir,
      pinnedVersion: null,
      env: { PATH: process.env.PATH },
      timeoutMs: 120_000,
    });
    const s = await setup(backend);
    const { job } = await s.createCard();

    // The job is running and the model call is in flight: the fake CLI has started its child.
    await until(() => existsSync(join(dir, "pids.json")), 8000);
    const pids = JSON.parse(readFileSync(join(dir, "pids.json"), "utf8")) as {
      parent: number;
      child: number;
    };
    expect(alive(pids.parent)).toBe(true);
    expect(alive(pids.child)).toBe(true);
    expect(s.rt.ingest.queue.get(job)?.status).toBe("running");

    const cancelled = s.rt.ingest.queue.cancel(job);
    expect(cancelled.status).toBe("cancelled");

    await until(() => !alive(pids.parent) && !alive(pids.child), 8000);
    // The call ends as cancelled in the ledger, not as a backend failure.
    await until(() => s.rt.usage.summary(1).totals.calls === 1, 8000);
    expect(s.rt.usage.summary(1).totals).toMatchObject({ calls: 1, failed: 1 });
    expect(s.rt.ingest.queue.get(job)?.status).toBe("cancelled");
  });
});

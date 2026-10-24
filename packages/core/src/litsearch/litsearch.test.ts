import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { JobQueue } from "../jobs/queue.js";
import { Library } from "../library.js";
import { IGNORE_LINES } from "../sync/versioning.js";
import { cleanTmpDirs, itemData, tmpDir, until } from "../test-helpers.js";
import { parseCsv } from "./csv.js";
import { bindLitsearchOperations } from "./ops.js";
import { runPipeline, runScript } from "./runner.js";
import { runIdFor } from "./service.js";
import { progressOf, readProgressEvents, readRunPapers, stagesFromEvents } from "./store.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "workers",
  "research",
  "tests",
  "fixtures",
);
const SAMPLE = join(FIXTURES, "run-sample");

const libs: Library[] = [];
afterEach(async () => {
  for (const lib of libs.splice(0)) await lib.close();
  cleanTmpDirs();
});

async function library(): Promise<Library> {
  const lib = await Library.init(tmpDir("cg-lit-"), {
    localBase: tmpDir("cg-local-"),
    watch: false,
  });
  libs.push(lib);
  return lib;
}

function copyRun(lib: Library, runId: string, from = SAMPLE): string {
  const dir = lib.paths.litsearchRunDir(runId);
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(from, dir, { recursive: true });
  return dir;
}

describe("parseCsv", () => {
  it("reads quoted fields with commas, doubled quotes, line breaks and a BOM", () => {
    // protects: titles and abstracts with commas, quotes or line breaks arrive whole
    // fails_when: a quoted comma splits a field, "" is not unescaped, or the BOM sticks to the first header
    // no_claim: none beyond protects
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n1,,3');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["1", "", "3"],
    ]);
  });
});

describe("readRunPapers", () => {
  it("types every row of papers.csv and keys papers exactly like papers.py", () => {
    // protects: the same paper has the same key in TypeScript and in workers/research (watch diffs, inbox state)
    // fails_when: a key differs from papers.paper_key, a section or number is mistyped, or HTML abstracts change
    // no_claim: the fixture is written by render.write_csv from hand-made rows (tests/make_fixture.py), not by a live run
    const papers = readRunPapers(SAMPLE);
    expect(papers.map((p) => p.key)).toEqual([
      "W4400000001",
      "W4200000002",
      "W4600000003",
      "p44d6258ece7a",
      "W4300000005",
    ]);
    expect(papers.map((p) => p.section)).toEqual(["main", "main", "preprint", "grey", "rejected"]);
    const [first, snowballed, preprint, grey, rejected] = papers;
    expect(first).toMatchObject({
      rank: 1,
      score: 81.4,
      scoreParts: { relevance: 27, venue: 30, author: 12.4, citations: 12 },
      authors: ["Ana Ruiz", "Tom Becker"],
      year: 2025,
      venueTier: 1,
      doi: "10.1145/3700001",
      verified: true,
      openalex: "W4400000001",
      citedBy: 120,
      fwci: 3.1,
      link: "https://doi.org/10.1145/3700001",
    });
    expect(snowballed?.foundVia).toBe("snowballing (cited by W4400000001)");
    expect(snowballed?.fwci).toBeUndefined();
    expect(snowballed?.abstract).toBe("We study emergent protocols.");
    expect(preprint).toMatchObject({ arxiv: "2601.01234", reviewStatus: "under review" });
    expect(grey?.openalex).toBeUndefined();
    expect(rejected).toMatchObject({
      verified: false,
      doi: "10.9999/fake.1",
      rejectedReason: "DOI not found at Crossref or DataCite",
    });
    expect(rejected?.rank).toBeUndefined();
  });
});

describe("stagesFromEvents", () => {
  it("rebuilds the stages of a real run that hit the OpenAlex daily limit", () => {
    // protects: the progress view shows which stages finished, which failed and why
    // fails_when: a finished stage reads as pending, the failed stage or the error message is lost
    // no_claim: the fixture is a recorded live run (timestamps zeroed, traceback removed)
    const events = readProgressEvents(join(FIXTURES, "progress"));
    expect(events).toEqual([]);
    const lines = readFileSync(join(FIXTURES, "progress", "rate-limited.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const { stages, error } = stagesFromEvents(lines);
    expect(stages).toHaveLength(18);
    expect(stages.slice(0, 10).every((s) => s.status === "done")).toBe(true);
    expect(stages.find((s) => s.id === "snowball")?.status).toBe("failed");
    expect(stages.find((s) => s.id === "write")?.status).toBe("pending");
    expect(stages.find((s) => s.id === "search")).toMatchObject({ done: 2, total: 2 });
    expect(error).toMatch(/^RateLimited: Tageslimit von api\.openalex\.org/);
    expect(progressOf(stages)).toBeCloseTo(11 / 18, 5);
  });
});

/** A stand-in for pipeline.py: prints progress events, then exits as the mode says. */
function stubPipeline(dir: string, mode: "done" | "fail" | "hang"): string {
  const path = join(dir, `stub-${mode}.cjs`);
  const body = {
    done: `
      const out = process.argv[process.argv.indexOf("--out") + 1];
      const fs = require("node:fs");
      fs.writeFileSync(out + "/papers.csv", "section,title\\nmain,A\\n");
      emit({ type: "plan", stages: [{ id: "search", label: "Search" }] });
      emit({ type: "stage", stage: "search", status: "started" });
      emit({ type: "stage", stage: "search", status: "finished", seconds: 0.1 });
      emit({ type: "done", counts: { main: 1, preprint: 0, grey: 0, rejected: 0, candidates: 9 } });
      emit({ env: process.env.CITEGEIST_LITSEARCH_DIR, key: process.env.OPENALEX_API_KEY ?? null });`,
    fail: `
      emit({ type: "error", msg: "RateLimited: Tageslimit" });
      process.stderr.write("Traceback ...\\n");
      process.exit(1);`,
    hang: `
      emit({ type: "plan", stages: [] });
      setInterval(() => {}, 1000);`,
  }[mode];
  writeFileSync(path, `const emit = (e) => console.log(JSON.stringify(e));\n${body}\n`);
  return path;
}

describe("runPipeline", () => {
  const command = { command: process.execPath, args: [] as string[] };
  const request = { topic: "agent protocols", queries: ['"agent protocol"'], top: 5 };

  it("passes the library folder and key, logs progress and records a finished run", async () => {
    // protects: run.json goes running -> done with section counts; progress.jsonl keeps every event
    // fails_when: the scripts do not get CITEGEIST_LITSEARCH_DIR or the key, or run.json misses status/counts
    // no_claim: a node stub stands in for pipeline.py; the real CLI flags are checked in the next test
    const lib = await library();
    const dir = lib.paths.litsearchRunDir("run-a");
    const events: Array<Record<string, unknown>> = [];
    const out = await runPipeline({
      script: stubPipeline(tmpDir(), "done"),
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir(), openalexKey: "oa-key" },
      dir,
      runId: "run-a",
      request,
      onEvent: (e) => events.push(e),
      now: () => new Date("2026-10-24T14:00:00Z"),
    });
    expect(out).toEqual({ status: "done", counts: { main: 1, preprint: 0, grey: 0, rejected: 0 } });
    const meta = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    expect(meta).toMatchObject({
      id: "run-a",
      topic: "agent protocols",
      queries: ['"agent protocol"'],
      top: 5,
      status: "done",
      attempts: 1,
      created: "2026-10-24T14:00:00",
      finished: "2026-10-24T14:00:00",
      counts: { main: 1, preprint: 0, grey: 0, rejected: 0 },
    });
    expect(events.at(-1)).toEqual({ env: lib.paths.researchDir, key: "oa-key" });
    expect(readFileSync(join(dir, "progress.jsonl"), "utf8").trim().split("\n")).toHaveLength(5);
  });

  it("hands pipeline.py the flags of research-pipeline's server", async () => {
    // protects: topic, every query, since, top, disabled sources, out folder, progress and query cache reach the CLI,
    //   in the --flag=value form so a value that starts with "-" is no option, and Python writes no bytecode
    // fails_when: a flag is missing or renamed, a value is a separate argument, or PYTHONDONTWRITEBYTECODE is not 1
    // no_claim: a node stub echoes argv; pipeline.py's own argument parsing is not run
    const lib = await library();
    const echo = join(tmpDir(), "echo.mjs");
    writeFileSync(
      echo,
      "console.log(JSON.stringify({ argv: process.argv.slice(2), bytecode: process.env.PYTHONDONTWRITEBYTECODE }));\n",
    );
    const dir = lib.paths.litsearchRunDir("run-flags");
    const seen: unknown[] = [];
    await runPipeline({
      script: echo,
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-flags",
      request: {
        ...request,
        topic: "-agents",
        queries: ["a", "-b c"],
        since: 2022,
        disableSources: ["dblp"],
      },
      onEvent: (e) => seen.push(e),
    });
    expect(seen[0]).toEqual({
      bytecode: "1",
      argv: [
        "--topic=-agents",
        "--query=a",
        "--query=-b c",
        "--since",
        "2022",
        "--top",
        "5",
        "--disable-source=dblp",
        "--out",
        dir,
        "--progress-jsonl",
        "--query-cache",
        join(dir, "query-cache"),
      ],
    });
  });

  it("records a failed run with the pipeline's last error message and keeps stderr", async () => {
    // protects: a failed run shows why it failed (rate limit, TLS) instead of a bare exit code
    // fails_when: run.json says done, or the error message is not the one the pipeline emitted
    // no_claim: a node stub stands in for pipeline.py
    const lib = await library();
    const dir = lib.paths.litsearchRunDir("run-b");
    const out = await runPipeline({
      script: stubPipeline(tmpDir(), "fail"),
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-b",
      request,
    });
    expect(out).toMatchObject({ status: "failed", error: "RateLimited: Tageslimit" });
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf8"))).toMatchObject({
      status: "failed",
      error: "RateLimited: Tageslimit",
    });
    expect(readFileSync(join(dir, "stderr.log"), "utf8")).toContain("Traceback");
  });

  it("stops a hanging run on cancel and counts the attempt when it is resumed", async () => {
    // protects: cancel ends the Python process within the grace period; a resumed run keeps created and counts attempts
    // fails_when: the process survives the abort, run.json does not say cancelled, or attempts resets
    // no_claim: SIGKILL after the grace period is exercised with a short grace, not the 5 s default
    const lib = await library();
    const dir = lib.paths.litsearchRunDir("run-c");
    const ctl = new AbortController();
    const started = Date.now();
    const pending = runPipeline({
      script: stubPipeline(tmpDir(), "hang"),
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-c",
      request,
      signal: ctl.signal,
      killAfterMs: 200,
      now: () => new Date("2026-10-24T14:00:00Z"),
    });
    setTimeout(() => ctl.abort(), 300);
    expect((await pending).status).toBe("cancelled");
    expect(Date.now() - started).toBeLessThan(6000);
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).status).toBe("cancelled");

    await runPipeline({
      script: stubPipeline(tmpDir(), "done"),
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-c",
      request,
      now: () => new Date("2026-10-24T15:00:00Z"),
    });
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf8"))).toMatchObject({
      status: "done",
      attempts: 2,
      created: "2026-10-24T14:00:00",
    });
  });

  it("reports a missing interpreter as a failed run instead of throwing", async () => {
    // protects: a machine without uv gets a readable failed run
    // fails_when: the promise rejects or run.json stays "running"
    // no_claim: none beyond protects
    const lib = await library();
    const dir = lib.paths.litsearchRunDir("run-d");
    const out = await runPipeline({
      script: "pipeline.py",
      command: { command: join(tmpDir(), "no-such-uv"), args: [] },
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-d",
      request,
    });
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/could not start the literature search/);
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).status).toBe("failed");
  });
});

describe("runScript", () => {
  const env = () => ({ dataDir: tmpDir(), cacheDir: tmpDir() });

  it("names uv and how to install it when the command does not exist", async () => {
    // protects: a machine without uv gets a fix instead of "spawn uv ENOENT"
    // fails_when: the promise resolves, or the error has no install hint
    // no_claim: none beyond protects
    await expect(
      runScript({
        command: { command: join(tmpDir(), "no-such-uv"), args: [] },
        script: "report.py",
        args: [],
        env: env(),
      }),
    ).rejects.toMatchObject({
      detail: { code: "LITSEARCH_UV_MISSING", fix: expect.stringContaining("brew install uv") },
    });
  });

  it("stops the whole process group on timeout, not only the first process", async () => {
    // protects: a timeout leaves no orphaned python behind uv
    // fails_when: the grandchild of the script is still alive after the timeout
    // no_claim: node stands in for uv and python; the process group is what is exercised
    const script = join(tmpDir(), "tree.cjs");
    writeFileSync(
      script,
      `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       console.log(child.pid);
       setInterval(() => {}, 1000);`,
    );
    const res = await runScript({
      command: { command: process.execPath, args: [] },
      script,
      args: [],
      env: env(),
      timeoutMs: 500,
    });
    expect(res.code).toBeNull();
    const grandchild = Number.parseInt(res.stdout.trim(), 10);
    expect(grandchild).toBeGreaterThan(0);
    await until(() => {
      try {
        process.kill(grandchild, 0);
        return false;
      } catch {
        return true;
      }
    });
  });
});

describe("litsearch.runs and litsearch.get", () => {
  it("lists runs newest first, pages them and marks papers against the library", async () => {
    // protects: the run list and the paper badges ("in library", "in inbox") come from the library folder
    // fails_when: order or paging is wrong, or a paper the library holds reads as new
    // no_claim: matching reuses graph/marking.ts; its title and author matching is tested in graph.test.ts
    const lib = await library();
    const older = copyRun(lib, "2026-10-01-older");
    writeFileSync(
      join(older, "run.json"),
      JSON.stringify({ topic: "older", status: "failed", created: "2026-10-01T09:00:00" }),
    );
    copyRun(lib, "run-sample");
    mkdirSync(lib.paths.litsearchRunDir("not-a-run"), { recursive: true });
    lib.writeItem(itemData("ruiz2025", { type: "article-journal", DOI: "10.1145/3700001" }));
    lib.writeItem(
      itemData("wei2022", {
        type: "article-journal",
        DOI: "10.5555/3535850.3535900",
        inbox: { by: "system", why: "Literatursuche" },
      }),
    );
    const registry = bindLitsearchOperations(new Registry(), lib);
    const call = <T>(name: string, input: unknown) =>
      registry.call(name, { actor: "human" }, input) as Promise<T>;

    const page1 = await call<{ runs: Array<{ id: string }>; next?: string }>("litsearch.runs", {
      limit: 1,
    });
    expect(page1.runs.map((r) => r.id)).toEqual(["run-sample"]);
    expect(page1.next).toBe("1");
    const page2 = await call<{ runs: Array<{ id: string; status: string }>; next?: string }>(
      "litsearch.runs",
      { limit: 5, cursor: page1.next },
    );
    expect(page2.runs).toMatchObject([{ id: "2026-10-01-older", status: "failed" }]);
    expect(page2.next).toBeUndefined();

    const got = await call<{
      run: { topic: string; counts: Record<string, number> };
      papers: Array<{ key: string; status: string; citekey?: string }>;
    }>("litsearch.get", { runId: "run-sample" });
    expect(got.run).toMatchObject({ topic: "agent communication protocols", counts: { main: 2 } });
    expect(got.papers.slice(0, 3)).toMatchObject([
      { key: "W4400000001", status: "library", citekey: "ruiz2025" },
      { key: "W4200000002", status: "inbox", citekey: "wei2022" },
      { key: "W4600000003", status: "new" },
    ]);
  });

  it("refuses ids that would leave the runs folder and names a missing run", async () => {
    // protects: a run id can never point outside <library>/research/runs
    // fails_when: "../x" is accepted, or a missing run returns an empty result instead of an error
    // no_claim: none beyond protects
    const lib = await library();
    const registry = bindLitsearchOperations(new Registry(), lib);
    await expect(
      registry.call("litsearch.get", { actor: "human" }, { runId: "../items" }),
    ).rejects.toThrow();
    await expect(
      registry.call("litsearch.get", { actor: "human" }, { runId: "nope" }),
    ).rejects.toMatchObject({ detail: { code: "LITSEARCH_RUN_NOT_FOUND" } });
    expect(existsSync(lib.paths.litsearchRunsDir)).toBe(false);
  });
});

describe("litsearch.runs with damaged folders", () => {
  it("skips folders that are no runs and run.json files that do not parse", async () => {
    // protects: one sync conflict copy or half-written run.json does not break the whole run list
    // fails_when: litsearch.runs throws, or lists "<id> (conflicted copy)" or the folder with a broken run.json
    // no_claim: the broken folders stay on disk; the list only ignores them
    const lib = await library();
    const good = copyRun(lib, "2026-10-01-good");
    writeFileSync(join(good, "run.json"), JSON.stringify({ topic: "good", status: "done" }));
    const conflict = copyRun(lib, "2026-10-01-good (conflicted copy 2)");
    writeFileSync(join(conflict, "run.json"), JSON.stringify({ topic: "copy", status: "done" }));
    const broken = lib.paths.litsearchRunDir("2026-10-02-broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "run.json"), '{"topic": "cut off');
    const registry = bindLitsearchOperations(new Registry(), lib);
    const out = (await registry.call("litsearch.runs", { actor: "human" }, { limit: 10 })) as {
      runs: Array<{ id: string }>;
    };
    expect(out.runs.map((r) => r.id)).toEqual(["2026-10-01-good"]);
  });
});

describe("library folder", () => {
  it("keeps the refetchable parts of a run out of git", () => {
    // protects: synced libraries carry results, not query caches, OpenAlex records, logs, locks or half-written files
    // fails_when: one of the paths is missing from the ignore block
    // no_claim: git's matching of the patterns is exercised by the sync tests, not here
    expect(IGNORE_LINES).toEqual(
      expect.arrayContaining([
        "research/runs/*/query-cache/",
        "research/runs/*/stderr.log",
        "research/runs/*/works/",
        "research/watches/logs/",
        "research/watches/.lock",
        "research/**/*.tmp",
      ]),
    );
  });
});

describe("litsearch.start, cancel and resume", () => {
  async function wired(mode: "done" | "hang") {
    const lib = await library();
    const queue = new JobQueue({ dbPath: join(tmpDir(), "state.sqlite") });
    queue.start();
    const scriptsDir = tmpDir();
    writeFileSync(join(scriptsDir, "pipeline.py"), readFileSync(stubPipeline(tmpDir(), mode)));
    const registry = bindLitsearchOperations(new Registry(), lib, {
      queue,
      command: { command: process.execPath, args: [] },
      scriptsDir,
      cacheDir: tmpDir(),
      credentials: async () => ({ openalexKey: "oa-key", mailto: "me@example.org" }),
      now: () => new Date("2026-10-24T14:00:00Z"),
      ai: {
        run: async () => ({
          output: {
            queries: [
              { query: '"agent protocol"', variants: ['"agent protocols"', '"agents protocol"'] },
              { query: '"multi-agent communication"', variants: [] },
            ],
          },
        }),
      },
    });
    const call = <T>(name: string, input: unknown) =>
      registry.call(name, { actor: "human" }, input) as Promise<T>;
    return { lib, queue, call };
  }

  it("runs a search as a job, reports progress and lists the run as done", async () => {
    // protects: litsearch.start makes a dated run folder and a litsearch.run job that ends with the pipeline
    // fails_when: the job does not succeed, the run id ignores date and topic, or the run lists as running
    // no_claim: a node stub stands in for pipeline.py; uv and the real scripts are not started
    const { queue, call } = await wired("done");
    const started = await call<{ runId: string; job: string }>("litsearch.start", {
      topic: "Agent Protocols: A Survey!",
      queries: ['  "agent  protocol" '],
    });
    expect(started.runId).toBe("2026-10-24-agent-protocols-a-survey");
    const job = await queue.waitFor(started.job);
    expect(job).toMatchObject({ kind: "litsearch.run", status: "succeeded", progress: 1 });
    const runs = await call<{ runs: Array<{ id: string; status: string; queries: string[] }> }>(
      "litsearch.runs",
      { limit: 10 },
    );
    expect(runs.runs).toMatchObject([
      { id: started.runId, status: "done", queries: ['"agent protocol"'] },
    ]);
    queue.close();
  });

  it("writes run.json before start returns, so the run opens at once", async () => {
    // protects: the app opens /litsearch/<runId> right after start; the run is there, queued as running
    // fails_when: litsearch.get throws LITSEARCH_RUN_NOT_FOUND or the run is missing from litsearch.runs
    // no_claim: a node stub that never ends keeps the job from writing run.json itself
    const { queue, call } = await wired("hang");
    const started = await call<{ runId: string; job: string }>("litsearch.start", {
      topic: "Fresh Topic",
      queries: ["  a   b "],
      since: 2020,
    });
    const got = await call<{ run: { status: string; topic: string; queries: string[] } }>(
      "litsearch.get",
      { runId: started.runId },
    );
    expect(got.run).toMatchObject({ status: "running", topic: "Fresh Topic", queries: ["a b"] });
    const runs = await call<{ runs: Array<{ id: string }> }>("litsearch.runs", { limit: 10 });
    expect(runs.runs.map((r) => r.id)).toEqual([started.runId]);
    queue.cancel(started.job);
    await queue.idle();
    queue.close();
  });

  it("rejects a search without a usable query", async () => {
    // protects: blank queries do not start a run that has nothing to search
    // fails_when: a run folder is made, or the error is not LITSEARCH_QUERIES_EMPTY
    // no_claim: none beyond protects
    const { lib, queue, call } = await wired("done");
    await expect(
      call("litsearch.start", { topic: "empty", queries: ["  ", "\t "] }),
    ).rejects.toMatchObject({ detail: { code: "LITSEARCH_QUERIES_EMPTY" } });
    expect(existsSync(lib.paths.litsearchRunsDir)).toBe(false);
    queue.close();
  });

  it("ends a litsearch job that a crash left queued, so the run can be resumed", async () => {
    // protects: after a restart the old job does not block new runs; the run reads as interrupted
    // fails_when: the recovered job stays open, litsearch.start answers LITSEARCH_RUN_ACTIVE, or the run does not resume
    // no_claim: the queue is restarted by hand; a real crash is simulated by a job in the database
    const lib = await library();
    const queue = new JobQueue({ dbPath: join(tmpDir(), "state.sqlite") });
    const dir = copyRun(lib, "2026-10-03-crashed");
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        topic: "crashed",
        queries: ["x"],
        status: "running",
        created: "2026-10-03T09:00:00",
      }),
    );
    const old = queue.enqueue({
      kind: "litsearch.run",
      input: { runId: "2026-10-03-crashed", request: { topic: "crashed", queries: ["x"] } },
      by: "human",
    });
    queue.start();
    expect(queue.get(old.id)?.status).toBe("queued");
    const scriptsDir = tmpDir();
    writeFileSync(join(scriptsDir, "pipeline.py"), readFileSync(stubPipeline(tmpDir(), "done")));
    const registry = bindLitsearchOperations(new Registry(), lib, {
      queue,
      command: { command: process.execPath, args: [] },
      scriptsDir,
      cacheDir: tmpDir(),
    });
    const call = <T>(name: string, input: unknown) =>
      registry.call(name, { actor: "human" }, input) as Promise<T>;
    expect(queue.get(old.id)).toMatchObject({ status: "cancelled" });
    expect(queue.open()).toEqual([]);
    const got = await call<{ run: { status: string } }>("litsearch.get", {
      runId: "2026-10-03-crashed",
    });
    expect(got.run.status).toBe("interrupted");
    const resumed = await call<{ job: string }>("litsearch.resume", {
      runId: "2026-10-03-crashed",
    });
    expect((await queue.waitFor(resumed.job)).status).toBe("succeeded");
    queue.close();
  });

  it("refuses a second run while one is open and cancels the open one", async () => {
    // protects: one search at a time per library; cancel ends it and run.json says cancelled
    // fails_when: a second start is accepted, or the cancelled run stays running
    // no_claim: a node stub that never ends stands in for a slow pipeline.py
    const { lib, queue, call } = await wired("hang");
    const first = await call<{ runId: string; job: string }>("litsearch.start", {
      topic: "slow topic",
      queries: ["a"],
    });
    await until(() => queue.get(first.job)?.status === "running");
    await expect(
      call("litsearch.start", { topic: "another topic", queries: ["b"] }),
    ).rejects.toMatchObject({ detail: { code: "LITSEARCH_RUN_ACTIVE" } });
    await call("litsearch.cancel", { runId: first.runId });
    expect((await queue.waitFor(first.job)).status).toBe("cancelled");
    await until(
      () =>
        JSON.parse(readFileSync(join(lib.paths.litsearchRunDir(first.runId), "run.json"), "utf8"))
          .status === "cancelled",
    );
    await expect(call("litsearch.cancel", { runId: first.runId })).rejects.toMatchObject({
      detail: { code: "LITSEARCH_RUN_NOT_RUNNING" },
    });
    queue.close();
  });

  it("resumes a cancelled run in the same folder and refuses to resume a finished one", async () => {
    // protects: resume keeps the folder (and its query cache) and the run's own settings
    // fails_when: resume makes a new folder, loses the queries, or reruns a done run
    // no_claim: the cache reuse itself happens inside pipeline.py and is not exercised by the stub
    const { lib, queue, call } = await wired("done");
    const dir = copyRun(lib, "2026-10-01-older");
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        topic: "older",
        queries: ["x y"],
        status: "cancelled",
        created: "2026-10-01T09:00:00",
        attempts: 1,
        disabled_sources: ["dblp"],
      }),
    );
    const resumed = await call<{ runId: string; job: string }>("litsearch.resume", {
      runId: "2026-10-01-older",
    });
    expect(resumed.runId).toBe("2026-10-01-older");
    expect((await queue.waitFor(resumed.job)).status).toBe("succeeded");
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf8"))).toMatchObject({
      status: "done",
      attempts: 2,
      queries: ["x y"],
      disabled_sources: ["dblp"],
      created: "2026-10-01T09:00:00",
    });
    await expect(call("litsearch.resume", { runId: "2026-10-01-older" })).rejects.toMatchObject({
      detail: { code: "LITSEARCH_RUN_NOT_RESUMABLE" },
    });
    queue.close();
  });

  it("reads a run left running by a dead process as interrupted", async () => {
    // protects: after a crash or quit the list does not show a run as running forever
    // fails_when: status stays running although no job and no process is alive
    // no_claim: pid 999999 is assumed not to exist on the test machine
    const { lib, call } = await wired("done");
    const dir = copyRun(lib, "2026-10-02-dead");
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        topic: "dead",
        status: "running",
        created: "2026-10-02T09:00:00",
        pid: 999999,
        host: hostname(),
      }),
    );
    const got = await call<{ run: { status: string } }>("litsearch.get", {
      runId: "2026-10-02-dead",
    });
    expect(got.run.status).toBe("interrupted");
  });

  it("trusts a pid in run.json only on the host that wrote it", async () => {
    // protects: run.json synced from another Mac does not read as running because the pid exists here
    // fails_when: a live pid with a foreign or missing host reads as running, or the own host does not
    // no_claim: the own pid stands for a live run process; nothing is spawned
    const { lib, call } = await wired("done");
    const status = async (id: string, extra: Record<string, unknown>) => {
      const dir = copyRun(lib, id);
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({
          topic: id,
          status: "running",
          created: "2026-10-02T09:00:00",
          pid: process.pid,
          ...extra,
        }),
      );
      return (await call<{ run: { status: string } }>("litsearch.get", { runId: id })).run.status;
    };
    expect(await status("2026-10-02-own", { host: hostname() })).toBe("running");
    expect(await status("2026-10-02-other", { host: "another-mac.local" })).toBe("interrupted");
    expect(await status("2026-10-02-nohost", {})).toBe("interrupted");
  });

  it("answers with an error, not a SyntaxError, when a script prints no JSON", async () => {
    // protects: a Python or uv problem that prints text on stdout reaches the user as a CitegeistError
    // fails_when: the call rejects with a bare SyntaxError
    // no_claim: a node stub stands in for preprints.py
    const { lib, queue } = await wired("done");
    const scriptsDir = tmpDir();
    writeFileSync(join(scriptsDir, "preprints.py"), 'console.log("Downloading Python 3.12...");\n');
    const registry = bindLitsearchOperations(new Registry(), lib, {
      queue,
      command: { command: process.execPath, args: [] },
      scriptsDir,
      cacheDir: tmpDir(),
    });
    await expect(
      registry.call("litsearch.preprints", { actor: "human" }, {}),
    ).rejects.toMatchObject({
      detail: { code: "LITSEARCH_SCRIPT_OUTPUT_INVALID" },
    });
    queue.close();
  });

  it("suggests queries through the AI router, core queries first and without plural duplicates", async () => {
    // protects: the suggestion list follows research-pipeline's rule (cap, cores first, no plural/case twins)
    // fails_when: "agent protocols" survives next to "agent protocol", or the cap is exceeded
    // no_claim: the model is a stub; prompt quality is the eval's job
    const { call } = await wired("done");
    const out = await call<{ queries: string[] }>("litsearch.suggest", {
      topic: "agent protocols",
      maxQueries: 2,
    });
    expect(out.queries).toEqual(['"agent protocol"', '"multi-agent communication"']);
  });
});

describe("runIdFor", () => {
  it("dates and slugs the topic and counts up when the folder exists", () => {
    // protects: run folders are readable, sortable and never overwrite each other
    // fails_when: umlauts or punctuation leak into the id, or an existing id is reused
    // no_claim: none beyond protects
    const date = new Date("2026-10-24T23:30:00Z");
    expect(runIdFor("Systemtheorie & Plattformökonomie", date, () => false)).toBe(
      "2026-10-24-systemtheorie-plattformokonomie",
    );
    const taken = new Set(["2026-10-24-x", "2026-10-24-x-2"]);
    expect(runIdFor("x", date, (id) => taken.has(id))).toBe("2026-10-24-x-3");
    expect(runIdFor("!!!", date, () => false)).toBe("2026-10-24-run");
  });
});

describe("litsearch.export and litsearch.report", () => {
  it("hands out the run's files with a download name and refuses runs without results", async () => {
    // protects: the four downloads carry the file of the run folder, named after the run
    // fails_when: a format maps to the wrong file, or a running run returns an empty file
    // no_claim: the files are the fixture's; their content is the pipeline's (render.py)
    const lib = await library();
    copyRun(lib, "run-sample");
    writeFileSync(join(lib.paths.litsearchRunDir("run-sample"), "references.bib"), "@article{x}\n");
    const registry = bindLitsearchOperations(new Registry(), lib);
    const out = (await registry.call(
      "litsearch.export",
      { actor: "human" },
      { runId: "run-sample", format: "csv" },
    )) as { filename: string; content: string };
    expect(out.filename).toBe("run-sample-papers.csv");
    expect(out.content).toContain("A Survey of Agent Interoperability Protocols");
    const bib = (await registry.call(
      "litsearch.export",
      { actor: "human" },
      { runId: "run-sample", format: "bib" },
    )) as { content: string };
    expect(bib.content).toBe("@article{x}\n");
    await expect(
      registry.call("litsearch.export", { actor: "human" }, { runId: "run-sample", format: "md" }),
    ).rejects.toMatchObject({ detail: { code: "LITSEARCH_OUTPUT_MISSING" } });
  });

  it.skipIf(!python3())("writes the HTML report with report.py from the run folder", async () => {
    // protects: "Bericht (HTML)" runs the pipeline's own report.py on the run and returns one self-contained page
    // fails_when: the script path or arguments are wrong, or the page lacks the run's papers
    // no_claim: runs the system python3 instead of the uv environment; skipped where there is none
    const lib = await library();
    copyRun(lib, "run-sample");
    const scriptsDir = join(FIXTURES, "..", "..", "scripts");
    const registry = bindLitsearchOperations(new Registry(), lib, {
      command: { command: python3() as string, args: [] },
      scriptsDir,
    });
    const out = (await registry.call(
      "litsearch.report",
      { actor: "human" },
      { runId: "run-sample" },
    )) as {
      path: string;
      filename: string;
      html: string;
    };
    expect(out.filename).toBe("run-sample-report.html");
    expect(existsSync(out.path)).toBe(true);
    expect(out.html).toMatch(/^<!doctype html>/i);
    expect(out.html).toContain("A Survey of Agent Interoperability Protocols");
    expect(out.html).toContain("agent communication protocols");
    expect(out.html).not.toMatch(/<script[^>]+src=/);
  });
});

function python3(): string | undefined {
  for (const p of ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

describe("litsearch.toInbox", () => {
  it("adds papers as system with the search as the reason and remembers them across restarts", async () => {
    // protects: a human's selection waits in the inbox with "Literatursuche ..." as reason; the run keeps knowing which item it became
    // fails_when: the paper lands in the library, the reason is missing, or after a fresh service the paper reads as new
    // no_claim: addItem is a stand-in that writes the inbox item itself; the real ingest is tested in ingest tests
    const lib = await library();
    copyRun(lib, "run-sample");
    const calls: Array<{ actor: string; input: Record<string, unknown> }> = [];
    const deps = {
      addItem: async (actor: string, input: { identifier: string; why?: string }) => {
        calls.push({ actor, input });
        const citekey = input.identifier.startsWith("arXiv") ? "okafor2026llm" : "ruiz2025survey";
        lib.writeItem(
          itemData(citekey, {
            type: "article-journal",
            // the stand-in stores no DOI, so only inbox.json can tie the item to the paper
            inbox: { by: "system", why: input.why },
          }),
        );
        return { citekey, job: "j_01JBZZZZZZZZZZZZZZZZZZZZZZ" };
      },
    };
    const registry = bindLitsearchOperations(new Registry(), lib, deps as never);
    const out = (await registry.call(
      "litsearch.toInbox",
      { actor: "human" },
      { runId: "run-sample", keys: ["W4400000001", "W4600000003", "p44d6258ece7a", "nope"] },
    )) as { added: number; failed: number; results: Array<{ key: string; status: string }> };
    expect(out.added).toBe(3);
    expect(out.failed).toBe(1);
    expect(calls.map((c) => c.actor)).toEqual(["system", "system", "system"]);
    expect(calls[0]?.input).toMatchObject({
      identifier: "10.1145/3700001",
      target: "inbox",
      why: "Literatursuche „agent communication protocols“: Score 81.4, Tier-1 venue, high relevance, FWCI 3.1",
    });
    expect(calls[1]?.input.identifier).toBe("10.48550/arXiv.2601.01234");

    const fresh = bindLitsearchOperations(new Registry(), lib);
    const got = (await fresh.call(
      "litsearch.get",
      { actor: "human" },
      { runId: "run-sample" },
    )) as {
      papers: Array<{ key: string; status: string; citekey?: string }>;
    };
    expect(got.papers.find((p) => p.key === "W4400000001")).toMatchObject({
      status: "inbox",
      citekey: "ruiz2025survey",
    });
    expect(got.papers.find((p) => p.key === "W4200000002")?.status).toBe("new");
  });
});

describe("litsearch.compare", () => {
  it("lists new, dropped and re-ranked papers between two runs, matching by DOI, OpenAlex id or title", async () => {
    // protects: the compare view says what a newer run found, lost and moved, the way watch.py diffs runs
    // fails_when: a paper matched by title only counts as new, a rejected paper counts, or a rank change is missed
    // no_claim: the second run is a hand-written papers.csv with only the columns the matching reads
    const lib = await library();
    copyRun(lib, "run-sample");
    const b = lib.paths.litsearchRunDir("run-newer");
    mkdirSync(b, { recursive: true });
    writeFileSync(
      join(b, "run.json"),
      JSON.stringify({
        topic: "agent communication protocols",
        status: "done",
        created: "2026-10-31T10:00:00",
      }),
    );
    writeFileSync(
      join(b, "papers.csv"),
      [
        "section,rank,score,title,doi,verified_doi,openalex_id",
        // same paper, other rank, found by OpenAlex id although the DOI changed
        "main,2,70,A Survey of Agent Interoperability Protocols,,10.1145/9999999,W4400000001",
        // same paper by title only (no DOI, no OpenAlex id), rank 2 -> 1
        "main,1,72,Emergent Communication in Multi-Agent Reinforcement Learning,,,",
        // new
        "main,3,60,A Brand New Protocol Benchmark for Agents,10.1/new,,W5000000009",
        // rejected papers never count
        "rejected,,10,Agent Protocol Interop Notes,10.5281/zenodo.1234567,,",
      ].join("\n"),
    );
    const registry = bindLitsearchOperations(new Registry(), lib);
    const out = (await registry.call(
      "litsearch.compare",
      { actor: "human" },
      { a: "run-sample", b: "run-newer" },
    )) as {
      added: Array<{ title: string }>;
      dropped: Array<{ title: string }>;
      moved: Array<{ paper: { title: string }; from: number; to: number }>;
    };
    expect(out.added.map((p) => p.title)).toEqual(["A Brand New Protocol Benchmark for Agents"]);
    expect(out.dropped.map((p) => p.title).sort()).toEqual([
      "Agent Protocol Interop Notes",
      "LLM Agents Talking: A Benchmark",
    ]);
    expect(out.moved).toEqual([
      expect.objectContaining({ paper: expect.objectContaining({ rank: 1 }), from: 2, to: 1 }),
      expect.objectContaining({ paper: expect.objectContaining({ rank: 2 }), from: 1, to: 2 }),
    ]);
  });
});

describe("runs of an alert", () => {
  it("flags the papers that alert.json lists as new, and still reads the watch.json of former watchlists", async () => {
    // protects: the "new" badge in the run of a pipeline alert comes from its alert.json; runs of former watchlists keep theirs
    // fails_when: a paper listed in the file is not marked, others are, or watch.json is no longer read
    // no_claim: both files are written by hand here; alert.json is made by the alert check (alerts/pipeline.test.ts)
    const lib = await library();
    const registry = bindLitsearchOperations(new Registry(), lib);
    const flagged = async (runId: string) =>
      (
        (await registry.call("litsearch.get", { actor: "human" }, { runId })) as {
          papers: Array<{ key: string; newInAlert?: boolean }>;
        }
      ).papers
        .filter((p) => p.newInAlert)
        .map((p) => p.key);
    const dir = copyRun(lib, "run-sample");
    writeFileSync(
      join(dir, "alert.json"),
      JSON.stringify({ alert: "a", new: [{ key: "W4600000003" }] }),
    );
    expect(await flagged("run-sample")).toEqual(["W4600000003"]);
    const old = copyRun(lib, "run-old");
    writeFileSync(
      join(old, "watch.json"),
      JSON.stringify({
        watchlist: "w",
        status: "done",
        new: [{ key: "W4400000001" }],
        dropped: [],
      }),
    );
    expect(await flagged("run-old")).toEqual(["W4400000001"]);
  });

  it("reads the alert of a run from run.json, also under the former key watchlist", async () => {
    // protects: runs started by former watchlists still say which saved search they belong to
    // fails_when: the alert of a run is lost
    // no_claim: none beyond protects
    const lib = await library();
    const registry = bindLitsearchOperations(new Registry(), lib);
    for (const [id, extra] of [
      ["run-new", { alert: "a" }],
      ["run-old", { watchlist: "w" }],
    ] as const) {
      const dir = lib.paths.litsearchRunDir(id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({ topic: id, status: "done", created: "2026-10-01T09:00:00", ...extra }),
      );
    }
    const { runs } = (await registry.call("litsearch.runs", { actor: "human" }, { limit: 10 })) as {
      runs: Array<{ id: string; alert?: string }>;
    };
    expect(Object.fromEntries(runs.map((r) => [r.id, r.alert]))).toEqual({
      "run-new": "a",
      "run-old": "w",
    });
  });
});

describe.skipIf(!python3())("litsearch preprints", () => {
  it("lists the preprints of the runs and tracks those of an imported reference list", async () => {
    // protects: the preprint tab shows every preprint of the library's runs; importing a .bib adds its preprints
    // fails_when: a run's preprint is missing, a journal paper is tracked, or the import count is wrong
    // no_claim: no network; the published check is a job that calls OpenAlex and Crossref and is not run here
    const lib = await library();
    copyRun(lib, "run-sample");
    const registry = bindLitsearchOperations(new Registry(), lib, {
      command: { command: python3() as string, args: [] },
      scriptsDir: join(FIXTURES, "..", "..", "scripts"),
    });
    const call = <T>(name: string, input: unknown) =>
      registry.call(name, { actor: "human" }, input) as Promise<T>;
    const first = await call<{
      tracked: Array<{ id: string; status: string; from: string[] }>;
      published: unknown[];
    }>("litsearch.preprints", {});
    expect(first.tracked).toEqual([
      expect.objectContaining({
        id: "arxiv:2601.01234",
        status: "preprint",
        from: ["run:run-sample"],
      }),
    ]);
    expect(first.published).toEqual([]);
    const bib = join(tmpDir(), "references.bib");
    writeFileSync(
      bib,
      "@article{a,\n  title={A Second Preprint},\n  doi={10.48550/arXiv.2602.00001}\n}\n" +
        "@article{b,\n  title={A Journal Paper},\n  doi={10.1145/3700001}\n}\n",
    );
    expect(await call("litsearch.preprintsImport", { path: bib })).toEqual({ added: 1 });
    const after = await call<{ tracked: Array<{ id: string }> }>("litsearch.preprints", {});
    expect(after.tracked.map((p) => p.id).sort()).toEqual(["arxiv:2601.01234", "arxiv:2602.00001"]);
    await expect(
      call("litsearch.preprintsImport", { path: "/no/such/file.bib" }),
    ).rejects.toMatchObject({
      detail: { code: "LITSEARCH_IMPORT_FILE_MISSING" },
    });
  });
});

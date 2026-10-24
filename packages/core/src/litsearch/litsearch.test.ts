import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { runPipeline } from "./runner.js";
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
    // protects: topic, every query, since, top, disabled sources, out folder, progress and query cache reach the CLI
    // fails_when: a flag is missing or renamed (pipeline.py would reject or ignore it)
    // no_claim: a node stub echoes argv; pipeline.py's own argument parsing is not run
    const lib = await library();
    const echo = join(tmpDir(), "echo.mjs");
    writeFileSync(echo, "console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n");
    const dir = lib.paths.litsearchRunDir("run-flags");
    const seen: unknown[] = [];
    await runPipeline({
      script: echo,
      command,
      env: { dataDir: lib.paths.researchDir, cacheDir: tmpDir() },
      dir,
      runId: "run-flags",
      request: { ...request, queries: ["a", "b c"], since: 2022, disableSources: ["dblp"] },
      onEvent: (e) => seen.push(e),
    });
    expect(seen[0]).toEqual({
      argv: [
        "--topic",
        "agent protocols",
        "--query",
        "a",
        "--query",
        "b c",
        "--since",
        "2022",
        "--top",
        "5",
        "--disable-source",
        "dblp",
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

describe("library folder", () => {
  it("keeps the refetchable parts of a run out of git", () => {
    // protects: synced libraries carry results, not query caches, OpenAlex records or logs
    // fails_when: one of the three paths is missing from the ignore block
    // no_claim: git's matching of the patterns is exercised by the sync tests, not here
    expect(IGNORE_LINES).toEqual(
      expect.arrayContaining([
        "research/runs/*/query-cache/",
        "research/runs/*/stderr.log",
        "research/runs/*/works/",
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
      }),
    );
    const got = await call<{ run: { status: string } }>("litsearch.get", {
      runId: "2026-10-02-dead",
    });
    expect(got.run.status).toBe("interrupted");
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

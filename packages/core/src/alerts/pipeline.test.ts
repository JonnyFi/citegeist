import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AlertInfo, AlertRunResult } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "../ingest/testing.js";
import { bindLitsearchOperations } from "../litsearch/index.js";
import { cleanTmpDirs, itemData, tmpDir, until } from "../test-helpers.js";
import { type AlertService, bindAlertOperations } from "./index.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-24T08:00:00Z");

const HEADER = "section,rank,score,title,doi,verified_doi,openalex_id,why_selected";
type Row = [section: string, score: number, n: number];
/** A papers.csv: paper n has the OpenAlex id W<n> and the DOI 10.1/p<n>. */
function csv(rows: Row[]): string {
  const lines = rows.map(
    ([section, score, n], i) =>
      `${section},${section === "rejected" ? "" : i + 1},${score},Paper number ${n} on agent protocols,,10.1/p${n},W${n},tier 1`,
  );
  return `${[HEADER, ...lines].join("\n")}\n`;
}

interface Env extends TestEnv {
  alerts: AlertService;
  clock: { now: number };
  /** The papers.csv the next stub run writes, or "hang" / "fail". */
  stub: { csv: string; mode: "write" | "hang" | "fail" };
  added: Array<{ actor: Actor; identifier: string; projects: string[]; why?: string }>;
  litsearch: ReturnType<typeof bindLitsearchOperations>["litsearch"];
}

const envs: Env[] = [];
afterEach(async () => {
  for (const e of envs.splice(0)) {
    await e.svc.close();
    await e.lib.close();
  }
  cleanTmpDirs();
});

/**
 * An alert service wired to a litsearch service whose pipeline.py is a node stub: it copies the
 * csv of the test into the run folder, so a check goes through the real job queue and run folders.
 */
async function setup(): Promise<Env> {
  const base = await createTestEnv();
  const clock = { now: T0 };
  const added: Env["added"] = [];
  const stub: Env["stub"] = { csv: csv([]), mode: "write" };
  const scriptsDir = tmpDir();
  writeFileSync(
    join(scriptsDir, "pipeline.py"),
    `const fs = require("node:fs");
const out = process.argv[process.argv.indexOf("--out") + 1];
const emit = (e) => console.log(JSON.stringify(e));
if (process.env.STUB_MODE === "hang") { emit({ type: "plan", stages: [] }); setInterval(() => {}, 1000); }
else if (process.env.STUB_MODE === "fail") { emit({ type: "error", msg: "RateLimited: daily limit" }); process.exit(1); }
else { fs.writeFileSync(out + "/papers.csv", process.env.STUB_CSV); emit({ type: "done", counts: { main: 1 } }); }
`,
  );
  const env: Record<string, string> = {};
  const record = async (
    actor: Actor,
    input: { identifier: string; projects: string[]; why?: string },
  ) => {
    added.push({
      actor,
      identifier: input.identifier,
      projects: input.projects,
      ...(input.why ? { why: input.why } : {}),
    });
    return { citekey: `added${added.length}`, job: "j_01JB8Z3QK7ABCDEFGH" };
  };
  const registry = bindLitsearchOperations(base.registry, base.lib, {
    queue: base.svc.queue,
    command: { command: process.execPath, args: [], env },
    scriptsDir,
    cacheDir: tmpDir(),
    addItem: record as never,
    now: () => new Date(clock.now),
  });
  const alerts = bindAlertOperations(base.registry, base.lib, {
    lookup: { alertWorks: async () => [] },
    addItem: record as never,
    queue: base.svc.queue,
    pipeline: registry.litsearch,
    now: () => clock.now,
  });
  // the stub reads its input from the environment of the spawned process
  Object.defineProperty(env, "STUB_CSV", { get: () => stub.csv, enumerable: true });
  Object.defineProperty(env, "STUB_MODE", { get: () => stub.mode, enumerable: true });
  const e: Env = Object.assign(base, { alerts, clock, stub, added, litsearch: registry.litsearch });
  envs.push(e);
  return e;
}

const create = (e: Env, input: Record<string, unknown> = {}) =>
  e.call<AlertInfo>("alerts.create", {
    name: "Agent protocols",
    source: {
      kind: "pipeline",
      value: "agent protocols",
      pipeline: { queries: ['"agent protocol"'], top: 20 },
    },
    limit: 2,
    ...input,
  });

async function check(e: Env, id: string): Promise<AlertRunResult> {
  const { job } = await e.call<{ job: string }>("alerts.runNow", { id });
  const done = await e.svc.queue.waitFor(job);
  if (done.status !== "succeeded") throw new Error(done.error?.message ?? done.status);
  return done.result as AlertRunResult;
}

describe("pipeline alerts", () => {
  it("are stored like the other alerts, weekly and with ten papers by default", async () => {
    // protects: a saved search is an entry of alerts.yaml next to the feeds, with the week as interval
    // fails_when: the queries are lost, the defaults are the daily five of the feeds, or the kind is refused
    // no_claim: none beyond protects
    const e = await setup();
    const a = await create(e, { limit: undefined });
    expect(a).toMatchObject({
      id: "agent-protocols",
      intervalHours: 168,
      limit: 10,
      enabled: true,
      source: { kind: "pipeline", value: "agent protocols" },
    });
    const yaml = readFileSync(e.lib.paths.abs("alerts.yaml"), "utf8");
    expect(yaml).toContain("kind: pipeline");
    expect(yaml).toContain('"agent protocol"');
    await expect(
      create(e, { source: { kind: "pipeline", value: "no queries" } }),
    ).rejects.toThrow();
  });

  it("do not run at once when they were saved from a run, but one interval later", async () => {
    // protects: saving a finished run as an alert does not start an expensive search a minute later
    // fails_when: the timer queues a job right away, or the next run is not a week after saving
    // no_claim: the timer itself is covered by the alert tests; here tick() is called by hand
    const e = await setup();
    const a = await create(e, {
      source: {
        kind: "pipeline",
        value: "agent protocols",
        pipeline: { queries: ["x"], fromRun: "2026-10-23-agent-protocols" },
      },
    });
    expect(a.lastRun).toMatchObject({ runId: "2026-10-23-agent-protocols" });
    expect(Date.parse(a.nextRun ?? "") - T0).toBe(7 * DAY);
    expect(e.alerts.tick()).toEqual([]);
    e.clock.now = T0 + 7 * DAY;
    expect(e.alerts.tick()).toHaveLength(1);
    await e.svc.queue.idle();
  });

  it("run the search as a job and put the best new papers into the inbox with score and run", async () => {
    // protects: a check starts a litsearch.run tagged with the alert; the top papers by score go to the inbox as system
    // fails_when: the run is not tagged, a paper in the library or a rejected one is offered, or the order is not by score
    // no_claim: addItem is a recorder; the pipeline is a node stub that copies a papers.csv
    const e = await setup();
    e.lib.writeItem(itemData("gamma2025", { DOI: "10.1/p3" }));
    e.stub.csv = csv([
      ["main", 70, 2],
      ["main", 90, 1],
      ["main", 80, 3],
      ["preprint", 60, 4],
      ["rejected", 99, 9],
    ]);
    const a = await create(e);
    const out = await check(e, a.id);
    expect(out).toMatchObject({ ok: true, fetched: 4, found: 3, added: 2, ranked: false });
    expect(out.runId).toBe("2026-10-24-agent-protocols");
    expect(e.added).toEqual([
      {
        actor: "system",
        identifier: "10.1/p1",
        projects: [],
        why: "Alert: Agent protocols, Score 90.0, Lauf 2026-10-24-agent-protocols",
      },
      {
        actor: "system",
        identifier: "10.1/p2",
        projects: [],
        why: "Alert: Agent protocols, Score 70.0, Lauf 2026-10-24-agent-protocols",
      },
    ]);
    const run = await e.call<{ run: { alert?: string; status: string } }>("litsearch.get", {
      runId: out.runId as string,
    });
    expect(run.run).toMatchObject({ alert: "agent-protocols", status: "done" });
    const listed = await e.call<{ alerts: AlertInfo[] }>("alerts.list", {});
    expect(listed.alerts[0]?.lastRun).toMatchObject({ ok: true, added: 2, runId: out.runId });
  });

  it("deliver only what the previous run of the alert lacked, and never offer a paper twice", async () => {
    // protects: the second check compares with the first run; a paper that left and came back stays out
    // fails_when: a paper of the first run is offered again, or a paper offered before returns as new
    // no_claim: none beyond protects
    const e = await setup();
    const a = await create(e, { limit: 5 });
    e.stub.csv = csv([
      ["main", 90, 1],
      ["main", 80, 2],
    ]);
    expect(await check(e, a.id)).toMatchObject({ found: 2, added: 2 });

    e.clock.now += 7 * DAY;
    e.stub.csv = csv([
      ["main", 90, 1],
      ["main", 95, 5],
      ["main", 80, 2],
    ]);
    const second = await check(e, a.id);
    expect(second).toMatchObject({ fetched: 3, found: 1, added: 1 });
    const secondRun = second.runId as string;
    expect(e.added.at(-1)?.identifier).toBe("10.1/p5");
    const flagged = await e.call<{ papers: Array<{ key: string; newInAlert?: boolean }> }>(
      "litsearch.get",
      { runId: secondRun },
    );
    expect(flagged.papers.filter((p) => p.newInAlert).map((p) => p.key)).toEqual(["W5"]);
    const dir = e.lib.paths.litsearchRunDir(secondRun);
    expect(JSON.parse(readFileSync(join(dir, "alert.json"), "utf8"))).toMatchObject({
      alert: "agent-protocols",
      previous: "2026-10-24-agent-protocols",
    });

    // paper 2 drops out of the third run and returns in the fourth: new against the run before, but offered already
    e.clock.now += 7 * DAY;
    e.stub.csv = csv([["main", 90, 1]]);
    await check(e, a.id);
    e.clock.now += 7 * DAY;
    e.stub.csv = csv([
      ["main", 90, 1],
      ["main", 80, 2],
    ]);
    expect(await check(e, a.id)).toMatchObject({ found: 0, added: 0 });
  });

  it("compare the first check with the run they were saved from", async () => {
    // protects: a search saved from a run does not offer that run's papers again
    // fails_when: the first check treats every paper as new
    // no_claim: none beyond protects
    const e = await setup();
    e.stub.csv = csv([
      ["main", 90, 1],
      ["main", 80, 2],
    ]);
    const first = await e.call<{ runId: string; job: string }>("litsearch.start", {
      topic: "agent protocols",
      queries: ["x"],
    });
    await e.svc.queue.waitFor(first.job);
    const a = await create(e, {
      limit: 5,
      source: {
        kind: "pipeline",
        value: "agent protocols",
        pipeline: { queries: ["x"], fromRun: first.runId },
      },
    });
    e.clock.now += 7 * DAY;
    e.stub.csv = csv([
      ["main", 90, 1],
      ["main", 80, 2],
      ["main", 70, 3],
    ]);
    expect(await check(e, a.id)).toMatchObject({ found: 1, added: 1 });
    expect(e.added.map((x) => x.identifier)).toEqual(["10.1/p3"]);
  });

  it("wait while another search runs, and are not tried by the timer meanwhile", async () => {
    // protects: one search at a time; a busy library delays the alert without marking it failed
    // fails_when: the timer queues the alert during a search, or the refusal is booked as a failed run
    // no_claim: none beyond protects
    const e = await setup();
    const a = await create(e, {
      source: { kind: "pipeline", value: "t", pipeline: { queries: ["x"] } },
    });
    e.stub.mode = "hang";
    const manual = await e.call<{ runId: string; job: string }>("litsearch.start", {
      topic: "manual",
      queries: ["y"],
    });
    await until(() => e.svc.queue.get(manual.job)?.status === "running");
    expect(e.alerts.tick()).toEqual([]);
    await expect(check(e, a.id)).rejects.toThrow(/already running/);
    expect(
      (await e.call<{ alerts: AlertInfo[] }>("alerts.list", {})).alerts[0]?.lastRun,
    ).toBeUndefined();
    e.svc.queue.cancel(manual.job);
    await e.svc.queue.idle();
    e.stub.mode = "write";
    expect(e.alerts.tick()).toEqual([expect.any(String)]);
    await e.svc.queue.idle();
  });

  it("book a failed search as a failed run and try again at the next interval", async () => {
    // protects: the alert list shows why the last check failed
    // fails_when: the error is lost or the run counts as done
    // no_claim: none beyond protects
    const e = await setup();
    const a = await create(e);
    e.stub.mode = "fail";
    await expect(check(e, a.id)).rejects.toThrow(/RateLimited/);
    const listed = await e.call<{ alerts: AlertInfo[] }>("alerts.list", {});
    expect(listed.alerts[0]?.lastRun).toMatchObject({ ok: false });
    expect(listed.alerts[0]?.lastRun?.error).toMatch(/RateLimited/);
    expect(Date.parse(listed.alerts[0]?.nextRun ?? "") - T0).toBe(7 * DAY);
  });

  it("stop the search when the check is cancelled", async () => {
    // protects: cancelling the alert's job also ends its litsearch run
    // fails_when: the run keeps going after the alert job was cancelled
    // no_claim: none beyond protects
    const e = await setup();
    const a = await create(e);
    e.stub.mode = "hang";
    const { job } = await e.call<{ job: string }>("alerts.runNow", { id: a.id });
    await until(() => e.svc.queue.open().some((j) => j.kind === "litsearch.run"));
    e.svc.queue.cancel(job);
    await until(() => !e.litsearch.busy());
    expect(e.svc.queue.get(job)?.status).toBe("cancelled");
  });
});

describe("watchlists of earlier versions", () => {
  function writeWatches(e: Env, watchlists: unknown[]): string {
    const dir = e.lib.paths.litsearchWatchesDir;
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "watchlists.json");
    writeFileSync(path, JSON.stringify({ watchlists }));
    return path;
  }
  const watch = (extra: Record<string, unknown> = {}) => ({
    id: "agent-communication",
    topic: "Agent communication",
    queries: ['"agent protocol"', "multi-agent"],
    since: 2022,
    top: 50,
    weekday: 1,
    time: "08:00",
    paused: true,
    created: "2026-10-01T09:00:00",
    base_run: "run-a",
    runs: ["run-a", "run-b"],
    last_run: "2026-10-20T08:00:03",
    last_status: "done",
    last_new: 3,
    ...extra,
  });

  it("become pipeline alerts once, and the file is renamed", async () => {
    // protects: no saved search is lost; background on means active, off means paused; the file is not read twice
    // fails_when: a queue is dropped, the compare run is not the last finished one, or a second start duplicates alerts
    // no_claim: weekday and time are dropped on purpose; the scheduler decides
    const e = await setup();
    for (const [id, status] of [
      ["run-a", "done"],
      ["run-b", "failed"],
    ] as const) {
      const dir = e.lib.paths.litsearchRunDir(id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "run.json"), JSON.stringify({ topic: "t", status }));
    }
    const path = writeWatches(e, [
      watch(),
      watch({ id: "second", topic: "Second topic", paused: false, runs: [], base_run: null }),
      { id: "broken", topic: "No queries", queries: [] },
    ]);
    const out = e.alerts.adoptWatchlists();
    expect(out.adopted).toEqual(["agent-communication", "second"]);
    expect(out.skipped.map((s) => s.id)).toEqual(["broken"]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.migrated`)).toBe(true);

    const { alerts } = await e.call<{ alerts: AlertInfo[] }>("alerts.list", {});
    expect(alerts[0]).toMatchObject({
      id: "agent-communication",
      name: "Agent communication",
      enabled: false,
      intervalHours: 168,
      source: {
        kind: "pipeline",
        value: "Agent communication",
        pipeline: {
          queries: ['"agent protocol"', "multi-agent"],
          since: 2022,
          top: 50,
          fromRun: "run-a",
        },
      },
    });
    expect(alerts[0]?.lastRun).toMatchObject({ ok: true });
    expect(alerts[1]).toMatchObject({ id: "second", enabled: true });
    expect(alerts[1]?.source.pipeline?.fromRun).toBeUndefined();
    expect(e.alerts.adoptWatchlists()).toEqual({ adopted: [], skipped: [] });
    expect((await e.call<{ alerts: AlertInfo[] }>("alerts.list", {})).alerts).toHaveLength(2);
  });

  it("get another id when an alert has the id of the watchlist", async () => {
    // protects: an alert made by hand is not overwritten by a watchlist of the same name
    // fails_when: the alert is replaced or the watchlist is dropped
    // no_claim: none beyond protects
    const e = await setup();
    await e.call("alerts.create", {
      name: "Agent communication",
      source: { kind: "arxiv-category", value: "cs.CL" },
    });
    writeWatches(e, [watch()]);
    expect(e.alerts.adoptWatchlists().adopted).toEqual(["agent-communication-2"]);
  });
});

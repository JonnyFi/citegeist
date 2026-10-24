import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AlertLookup, AlertQuery, AlertWork } from "@citegeist/metadata";
import type { AlertInfo, AlertRunResult } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import type { AddItem } from "../graph/candidates.js";
import { createTestEnv, type TestEnv } from "../ingest/testing.js";
import { cleanTmpDirs, itemData } from "../test-helpers.js";
import {
  type AlertDeps,
  type AlertService,
  alertWhy,
  bindAlertOperations,
  dedupe,
  isDue,
  nextRunAt,
  rankWorks,
  scheduleAlerts,
  windowStart,
} from "./index.js";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-24T08:00:00Z");
const NUMPY = "10.1038/s41586-020-2649-2";

interface Env extends TestEnv {
  alerts: AlertService;
  clock: { now: number };
  queries: AlertQuery[];
  /** Works the fake source returns on the next call. */
  source: { works: AlertWork[]; error?: Error; gate?: Promise<void> };
  added: Array<{ actor: Actor; identifier: string; projects: string[]; why?: string }>;
  scores: { fn?: (query: string, texts: string[]) => number[] | undefined; queries: string[] };
}

const envs: Env[] = [];
afterEach(async () => {
  for (const e of envs.splice(0)) {
    await e.svc.close();
    await e.lib.close();
  }
  cleanTmpDirs();
});

const work = (n: number, extra: Partial<AlertWork> = {}): AlertWork => ({
  arxiv: `2610.${String(n).padStart(5, "0")}`,
  title: `Paper ${n}`,
  abstract: `Abstract of paper ${n}.`,
  published: "2026-10-23",
  ...extra,
});

/**
 * An alert service on a fresh library. By default `addItem` is a recorder, so that the tests of
 * ordering and dedupe see exactly what would go into the inbox; `real` uses the ingest pipeline.
 */
async function setup(opts: { real?: boolean } = {}): Promise<Env> {
  const base = await createTestEnv();
  const queries: AlertQuery[] = [];
  const source: Env["source"] = { works: [] };
  const added: Env["added"] = [];
  const scores: Env["scores"] = { queries: [] };
  const clock = { now: T0 };
  const lookup: AlertLookup = {
    async alertWorks(query) {
      queries.push(query);
      await source.gate;
      if (source.error) throw source.error;
      return source.works;
    },
  };
  let n = 0;
  const record: AddItem = async (actor, input) => {
    added.push({
      actor,
      identifier: input.identifier,
      projects: input.projects,
      ...(input.why ? { why: input.why } : {}),
    });
    n++;
    return { citekey: `added${n}`, job: "j_01JB8Z3QK7ABCDEFGH" };
  };
  const deps: AlertDeps = {
    lookup,
    addItem: opts.real ? (actor, input) => base.svc.addItem(actor, input) : record,
    queue: base.svc.queue,
    rank: async (query, texts) => {
      scores.queries.push(query);
      return scores.fn?.(query, texts);
    },
    now: () => clock.now,
  };
  const alerts = bindAlertOperations(base.registry, base.lib, deps);
  const env: Env = Object.assign(base, { alerts, clock, queries, source, added, scores });
  envs.push(env);
  return env;
}

const call = <T>(e: Env, name: string, input: unknown, actor?: Actor) =>
  e.call<T>(name, input, actor);

async function runJob(e: Env, id: string): Promise<AlertRunResult> {
  const { job } = await call<{ job: string }>(e, "alerts.runNow", { id });
  const done = await e.svc.queue.waitFor(job);
  if (done.status !== "succeeded") throw new Error(done.error?.message ?? done.status);
  return done.result as AlertRunResult;
}

const create = (e: Env, input: Record<string, unknown> = {}) =>
  call<AlertInfo>(e, "alerts.create", {
    name: "Neue Paper",
    source: { kind: "arxiv-category", value: "cs.CL" },
    rank: false,
    ...input,
  });

describe("alert files", () => {
  it("keeps library-wide alerts in alerts.yaml and project alerts in the project folder", async () => {
    const e = await setup();
    e.lib.createProject("human", { slug: "rag", title: "RAG", brief: "Retrieval." });
    const root = await create(e);
    const inProject = await create(e, { name: "Neue Paper", project: "rag" });
    expect(root).toMatchObject({ id: "neue-paper", intervalHours: 24, limit: 5, enabled: true });
    expect(root.project).toBeUndefined();
    expect(inProject).toMatchObject({ id: "neue-paper-2", project: "rag" });

    const rootYaml = readFileSync(e.lib.paths.abs("alerts.yaml"), "utf8");
    expect(rootYaml).toContain("id: neue-paper\n");
    expect(rootYaml).toContain("kind: arxiv-category");
    expect(rootYaml).not.toContain("neue-paper-2");
    const projectYaml = readFileSync(e.lib.paths.abs("projects/rag/alerts.yaml"), "utf8");
    expect(projectYaml).toContain("id: neue-paper-2");

    const all = await call<{ alerts: AlertInfo[] }>(e, "alerts.list", {});
    expect(all.alerts.map((a) => a.id)).toEqual(["neue-paper", "neue-paper-2"]);
    const mine = await call<{ alerts: AlertInfo[] }>(e, "alerts.list", { project: "rag" });
    expect(mine.alerts.map((a) => a.id)).toEqual(["neue-paper-2"]);
    const lib = await call<{ alerts: AlertInfo[] }>(e, "alerts.list", { libraryOnly: true });
    expect(lib.alerts.map((a) => a.id)).toEqual(["neue-paper"]);
  });

  it("reads a file written by hand and leaves entries it cannot read alone", async () => {
    const e = await setup();
    writeFileSync(
      e.lib.paths.abs("alerts.yaml"),
      `alerts:
  - id: by-hand
    name: By hand
    source: { kind: openalex-search, value: citation graph }
    created: 2026-10-01T00:00:00Z
  - id: broken
    name: Broken
    source: { kind: openalex-topic, value: not-a-topic }
    created: 2026-10-01T00:00:00Z
`,
    );
    const listed = await call<{ alerts: AlertInfo[] }>(e, "alerts.list", {});
    expect(listed.alerts).toHaveLength(1);
    expect(listed.alerts[0]).toMatchObject({
      id: "by-hand",
      intervalHours: 24,
      limit: 5,
      rank: true,
    });

    await call(e, "alerts.update", { id: "by-hand", patch: { limit: 9 } });
    const text = readFileSync(e.lib.paths.abs("alerts.yaml"), "utf8");
    expect(text).toContain("limit: 9");
    expect(text).toContain("id: broken");
    expect(text).toContain("not-a-topic");
  });

  it("updates, pauses and deletes, and removes the file with the last alert", async () => {
    const e = await setup();
    const a = await create(e);
    const updated = await call<AlertInfo>(e, "alerts.update", {
      id: a.id,
      patch: { name: "Anders", intervalHours: 6, enabled: false },
    });
    expect(updated).toMatchObject({ id: a.id, name: "Anders", intervalHours: 6, enabled: false });
    expect(updated.nextRun).toBeUndefined();
    await call(e, "alerts.delete", { id: a.id });
    expect(existsSync(e.lib.paths.abs("alerts.yaml"))).toBe(false);
    await expect(call(e, "alerts.delete", { id: a.id })).rejects.toThrow(/no alert/);
  });

  it("refuses a source that does not fit its kind and a project that does not exist", async () => {
    const e = await setup();
    await expect(create(e, { source: { kind: "openalex-topic", value: "nlp" } })).rejects.toThrow(
      /topic id/,
    );
    await expect(create(e, { source: { kind: "author", value: "Bengio" } })).rejects.toThrow(
      /ORCID/,
    );
    await expect(create(e, { project: "nope" })).rejects.toThrow(/no project/);
    await expect(create(e, { source: { kind: "cites", value: "missing2020" } })).rejects.toThrow();
  });
});

describe("dedupe", () => {
  it("drops works in the library, in the inbox, proposed before, repeated or without identifier", async () => {
    const e = await setup();
    e.lib.writeItem(itemData("known2020", { type: "article-journal", DOI: "10.1000/known" }));
    e.lib.writeItem(
      itemData("waiting2020", {
        type: "article-journal",
        ids: { arxiv: "2610.00002" },
        inbox: { at: "2026-10-23T10:00:00.000Z", by: "system", why: "Alert: x" },
      }),
    );
    const out = dedupe(
      e.lib,
      [
        { doi: "10.1000/KNOWN", title: "Known" },
        work(2),
        work(3),
        work(3),
        work(4),
        { title: "No identifier" },
        { title: "Only OpenAlex", openalex: "W1" },
      ],
      new Set(["arxiv:2610.00004"]),
    );
    expect(out.fresh.map((w) => w.arxiv)).toEqual(["2610.00003"]);
    expect(out).toMatchObject({ inLibrary: 2, seen: 1, unaddable: 2 });
  });

  it("does not offer a rejected work again", async () => {
    const e = await setup();
    const a = await create(e);
    e.source.works = [work(1), work(2)];
    const first = await runJob(e, a.id);
    expect(first).toMatchObject({ fetched: 2, found: 2, added: 2 });
    // The user rejected both, so neither is in the library or the inbox any more.
    e.clock.now += 25 * HOUR;
    e.source.works = [work(1), work(2), work(3)];
    const second = await runJob(e, a.id);
    expect(second).toMatchObject({ fetched: 3, found: 1, added: 1 });
    expect(e.added.map((x) => x.identifier)).toEqual([
      "arXiv:2610.00001",
      "arXiv:2610.00002",
      "arXiv:2610.00003",
    ]);
  });

  it("asks the source only for what is new since the last successful run", async () => {
    const e = await setup();
    const a = await create(e);
    await runJob(e, a.id);
    expect(e.queries[0]?.since).toBe("2026-10-17");
    e.clock.now = Date.parse("2026-10-26T08:00:00Z");
    await runJob(e, a.id);
    expect(e.queries[1]?.since).toBe("2026-10-23");
  });
});

describe("window", () => {
  const now = Date.parse("2026-10-24T08:00:00Z");
  it("looks a week back at first, one day before the cursor after that, and never past 30 days", () => {
    expect(windowStart(undefined, now)).toBe("2026-10-17");
    expect(windowStart("2026-10-22T20:00:00Z", now)).toBe("2026-10-21");
    expect(windowStart("2026-01-01T00:00:00Z", now)).toBe("2026-09-24");
    expect(windowStart("not a date", now)).toBe("2026-10-17");
  });
});

describe("interval scheduling", () => {
  it("is due when it never ran or its interval has passed, and never when paused", () => {
    const alert = { enabled: true, intervalHours: 24 };
    expect(isDue(alert, undefined, T0)).toBe(true);
    const at = new Date(T0).toISOString();
    expect(isDue(alert, { at }, T0 + 23 * HOUR)).toBe(false);
    expect(isDue(alert, { at }, T0 + 24 * HOUR)).toBe(true);
    expect(isDue({ ...alert, intervalHours: 6 }, { at }, T0 + 7 * HOUR)).toBe(true);
    expect(isDue({ ...alert, enabled: false }, undefined, T0)).toBe(false);
    expect(nextRunAt(alert, { at }, T0 + HOUR)).toBe(new Date(T0 + 24 * HOUR).toISOString());
    expect(nextRunAt({ ...alert, enabled: false }, { at }, T0)).toBeUndefined();
  });

  it("queues a job only for the alerts that are due", async () => {
    const e = await setup();
    const daily = await create(e, { name: "Daily" });
    const quick = await create(e, { name: "Quick", intervalHours: 6 });
    const paused = await create(e, { name: "Paused", enabled: false });

    // Never ran: both enabled alerts are due, the paused one is not.
    const first = e.alerts.tick();
    expect(first).toHaveLength(2);
    for (const id of first) await e.svc.queue.waitFor(id);
    const jobs = (id: string) =>
      e.svc.queue
        .list({ status: "succeeded", limit: 50 })
        .jobs.filter((j) => (j.input as { alert?: string }).alert === id);
    expect(jobs(daily.id)).toHaveLength(1);
    expect(jobs(quick.id)).toHaveLength(1);
    expect(jobs(paused.id)).toHaveLength(0);

    e.clock.now += 5 * HOUR;
    expect(e.alerts.tick()).toEqual([]);
    e.clock.now += 2 * HOUR;
    const second = e.alerts.tick();
    expect(second).toHaveLength(1);
    await e.svc.queue.waitFor(second[0] ?? "");
    expect(jobs(quick.id)).toHaveLength(2);
    expect(jobs(daily.id)).toHaveLength(1);

    e.clock.now = T0 + 25 * HOUR;
    expect(e.alerts.tick()).toHaveLength(2);
  });

  it("does not queue a second job while one waits or runs", async () => {
    const e = await setup();
    const a = await create(e);
    let release: () => void = () => {};
    e.source.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = e.alerts.enqueue(a.id);
    expect(e.alerts.enqueue(a.id)).toBe(job);
    expect(e.alerts.tick()).toEqual([job]);
    release();
    await e.svc.queue.waitFor(job);
  });

  it("starts a timer that ticks and stops it again", async () => {
    const e = await setup();
    await create(e);
    const schedule = scheduleAlerts(e.alerts, { firstDelayMs: 5, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 60));
    schedule.stop();
    const done = e.svc.queue
      .list({ status: "succeeded", limit: 20 })
      .jobs.filter((j) => j.kind === "alerts");
    expect(done.length).toBe(1);
    expect(e.queries).toHaveLength(1);
  });

  it("records what the last run found", async () => {
    const e = await setup();
    const a = await create(e);
    e.source.works = [work(1), work(2), work(3)];
    await runJob(e, a.id);
    const [listed] = (await call<{ alerts: AlertInfo[] }>(e, "alerts.list", {})).alerts;
    expect(listed?.lastRun).toMatchObject({
      ok: true,
      fetched: 3,
      found: 3,
      added: 3,
      ranked: false,
      at: new Date(T0).toISOString(),
    });
    expect(listed?.nextRun).toBe(new Date(T0 + 24 * HOUR).toISOString());
  });

  it("keeps the failure of a run and the window of the last good one", async () => {
    const e = await setup();
    const a = await create(e);
    await runJob(e, a.id);
    e.clock.now += 25 * HOUR;
    e.source.error = new Error("OpenAlex is down");
    await expect(runJob(e, a.id)).rejects.toThrow(/OpenAlex is down/);
    const [listed] = (await call<{ alerts: AlertInfo[] }>(e, "alerts.list", {})).alerts;
    expect(listed?.lastRun).toMatchObject({ ok: false, error: "OpenAlex is down", added: 0 });
    delete e.source.error;
    e.clock.now += 25 * HOUR;
    await runJob(e, a.id);
    expect(e.queries.map((q) => q.since)).toEqual(["2026-10-17", "2026-10-23", "2026-10-23"]);
  });
});

describe("ranking", () => {
  it("orders works by their score, ties by source order", async () => {
    const works = [work(1), work(2), work(3), work(4)];
    const ranked = await rankWorks(works, "brief", async () => [0.2, 0.9, 0.2, 0.5]);
    expect(ranked?.map((w) => w.arxiv)).toEqual([
      "2610.00002",
      "2610.00004",
      "2610.00001",
      "2610.00003",
    ]);
  });

  it("cannot rank without a ranker, a brief or scores", async () => {
    const works = [work(1), work(2)];
    expect(await rankWorks(works, "brief", undefined)).toBeUndefined();
    expect(await rankWorks(works, "  ", async () => [1, 2])).toBeUndefined();
    expect(await rankWorks(works, "brief", async () => undefined)).toBeUndefined();
    expect(await rankWorks(works, "brief", async () => [1])).toBeUndefined();
    expect(
      await rankWorks(works, "brief", async () => {
        throw new Error("model gone");
      }),
    ).toBeUndefined();
  });

  it("puts the best matches for the project brief into the inbox, best first", async () => {
    const e = await setup();
    e.lib.createProject("human", {
      slug: "quantum",
      title: "Quantum error correction",
      brief: "We study surface codes and decoders.",
    });
    const a = await create(e, { project: "quantum", rank: true, limit: 2 });
    e.source.works = [
      work(1, { title: "Cooking with graphs" }),
      work(2, { title: "Surface code decoders" }),
      work(3, { title: "Football analytics" }),
      work(4, { title: "Decoders for surface codes at scale" }),
    ];
    e.scores.fn = (_q, texts) =>
      texts.map((t) => (/decoder/i.test(t) ? (/scale/.test(t) ? 0.9 : 0.7) : 0.1));
    const out = await runJob(e, a.id);
    expect(out).toMatchObject({ fetched: 4, found: 4, added: 2, ranked: true });
    expect(e.added.map((x) => x.identifier)).toEqual(["arXiv:2610.00004", "arXiv:2610.00002"]);
    expect(e.scores.queries[0]).toContain("Quantum error correction");
    expect(e.scores.queries[0]).toContain("surface codes");
  });

  it("keeps the order of the source when no embedder is ready, and says so", async () => {
    const e = await setup();
    e.lib.createProject("human", { slug: "p", title: "P", brief: "Something." });
    const a = await create(e, { project: "p", rank: true, limit: 2 });
    e.source.works = [work(1), work(2), work(3)];
    const out = await runJob(e, a.id);
    expect(out).toMatchObject({ added: 2, ranked: false });
    expect(e.added.map((x) => x.identifier)).toEqual(["arXiv:2610.00001", "arXiv:2610.00002"]);
  });

  it("does not rank a library-wide alert, which has no brief", async () => {
    const e = await setup();
    const a = await create(e, { rank: true, limit: 1 });
    e.scores.fn = (_q, texts) => texts.map((_t, i) => i);
    e.source.works = [work(1), work(2)];
    const out = await runJob(e, a.id);
    expect(out.ranked).toBe(false);
    expect(e.scores.queries).toEqual([]);
    expect(e.added.map((x) => x.identifier)).toEqual(["arXiv:2610.00001"]);
  });
});

describe("inbox provenance", () => {
  it("adds as system with the why 'Alert: <name>' and the project", async () => {
    const e = await setup();
    e.lib.createProject("human", { slug: "rag", title: "RAG", brief: "Retrieval." });
    const a = await create(e, { name: "Neue RAG-Paper", project: "rag" });
    e.source.works = [work(1)];
    await runJob(e, a.id);
    expect(e.added).toEqual([
      {
        actor: "system",
        identifier: "arXiv:2610.00001",
        projects: ["rag"],
        why: "Alert: Neue RAG-Paper",
      },
    ]);
    expect(alertWhy("Neue RAG-Paper")).toBe("Alert: Neue RAG-Paper");
  });

  it("lands the works in the inbox of the library through the real ingest", async () => {
    const e = await setup({ real: true });
    e.lib.createProject("human", { slug: "np", title: "NumPy", brief: "Arrays." });
    const a = await create(e, { name: "Arrays", project: "np" });
    e.source.works = [
      { doi: NUMPY, title: "Array programming with NumPy" },
      { arxiv: "1706.03762", title: "Attention Is All You Need" },
    ];
    const out = await runJob(e, a.id);
    expect(out).toMatchObject({ found: 2, added: 2 });
    expect(out.citekeys).toHaveLength(2);
    for (const citekey of out.citekeys) {
      const fm = e.lib.getItem(citekey).frontmatter;
      expect(fm.inbox).toMatchObject({ by: "system", why: "Alert: Arrays" });
      expect(fm.created.by).toBe("system");
    }
    const inbox = await call<{ items: Array<{ inboxBy?: string; inboxWhy?: string }> }>(
      e,
      "items.list",
      { inbox: true, limit: 10 },
    );
    expect(inbox.items.map((i) => i.inboxWhy)).toEqual(["Alert: Arrays", "Alert: Arrays"]);

    // Both are in the inbox now, so the next run finds nothing new.
    e.clock.now += 25 * HOUR;
    const again = await runJob(e, a.id);
    expect(again).toMatchObject({ fetched: 2, found: 0, added: 0 });
  });

  it("looks up the works that cite an item by the ids of that item", async () => {
    const e = await setup();
    e.lib.writeItem(
      itemData("vaswani2017", {
        type: "article-journal",
        ids: { openalex: "W2963403868", arxiv: "1706.03762" },
        DOI: "10.48550/ARXIV.1706.03762",
      }),
    );
    const a = await create(e, {
      name: "Cites attention",
      source: { kind: "cites", value: "vaswani2017" },
    });
    e.source.works = [work(1)];
    await runJob(e, a.id);
    expect(e.queries[0]).toMatchObject({
      kind: "cites",
      key: { doi: "10.48550/arxiv.1706.03762", openalex: "W2963403868", arxiv: "1706.03762" },
    });
  });
});

import { join } from "node:path";
import { CitegeistError, type Job } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir, until } from "../test-helpers.js";
import { JobQueue, TransientError } from "./queue.js";
import { currentJobScope } from "./scope.js";

afterEach(cleanTmpDirs);

function queue(dbPath = join(tmpDir(), "state.sqlite")) {
  return { q: new JobQueue({ dbPath, backoffMs: () => 5 }), dbPath };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("JobQueue", () => {
  it("runs a job, stores the result and emits progress events", async () => {
    const { q } = queue();
    const events: Job[] = [];
    q.on("job", (j: Job) => events.push(j));
    q.register("ingest", async (ctx) => {
      ctx.progress(0.5, "halfway");
      return { done: true };
    });
    q.start();
    const job = q.enqueue({ kind: "ingest", by: "human", input: { x: 1 } });
    const done = await q.waitFor(job.id);
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ done: true });
    expect(done.progress).toBe(1);
    expect(done.attempts).toBe(1);
    expect(events.some((e) => e.progress === 0.5 && e.message === "halfway")).toBe(true);
    expect(q.get(job.id)?.input).toEqual({ x: 1 });
    await q.close();
  });

  it("limits concurrency per kind", async () => {
    const { q } = queue();
    let running = 0;
    let peak = 0;
    const work = async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(15);
      running--;
    };
    q.register("convert", work, { concurrency: 1 });
    q.register("embed", work, { concurrency: 3 });
    q.start();
    for (let i = 0; i < 4; i++) q.enqueue({ kind: "convert", by: "system" });
    await q.idle();
    expect(peak).toBe(1);
    for (let i = 0; i < 6; i++) q.enqueue({ kind: "embed", by: "system" });
    await q.idle();
    expect(peak).toBe(3);
    await q.close();
  });

  it("retries a transient failure with backoff and then succeeds", async () => {
    const { q } = queue();
    let calls = 0;
    q.register("fetch-source", async () => {
      calls++;
      if (calls < 3) throw new TransientError("network down");
      return "ok";
    });
    q.start();
    const job = q.enqueue({ kind: "fetch-source", by: "human" });
    const done = await q.waitFor(job.id);
    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(3);
    expect(done.result).toBe("ok");
    await q.close();
  });

  it("gives up after the maximum number of attempts", async () => {
    const { q } = queue();
    q.register("fetch-source", async () => {
      throw new TransientError("still down");
    });
    q.start();
    const job = q.enqueue({ kind: "fetch-source", by: "human", maxAttempts: 2 });
    const done = await q.waitFor(job.id);
    expect(done.status).toBe("failed");
    expect(done.attempts).toBe(2);
    expect(done.error?.message).toBe("still down");
    await q.close();
  });

  it("does not retry a permanent failure and keeps the error code", async () => {
    const { q } = queue();
    q.register("ingest", async () => {
      throw new CitegeistError({
        code: "BAD_INPUT",
        message: "nope",
        fix: "Fix it.",
        recovery: "fix-and-retry",
      });
    });
    q.start();
    const done = await q.waitFor(q.enqueue({ kind: "ingest", by: "human" }).id);
    expect(done.status).toBe("failed");
    expect(done.attempts).toBe(1);
    expect(done.error?.code).toBe("BAD_INPUT");
    await q.close();
  });

  it("retries errors whose recovery is retry", async () => {
    const { q } = queue();
    let calls = 0;
    q.register("ingest", async () => {
      calls++;
      if (calls === 1) {
        throw new CitegeistError({
          code: "BUSY",
          message: "busy",
          fix: "Wait.",
          recovery: "retry",
        });
      }
    });
    q.start();
    const done = await q.waitFor(q.enqueue({ kind: "ingest", by: "human" }).id);
    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(2);
    await q.close();
  });

  it("cancels a queued job and aborts a running one", async () => {
    const { q } = queue();
    let aborted = false;
    q.register("convert", async (ctx) => {
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
      return "late";
    });
    q.start();
    const first = q.enqueue({ kind: "convert", by: "human" });
    const second = q.enqueue({ kind: "convert", by: "human" });
    while (q.get(first.id)?.status !== "running") await sleep(2);
    expect(q.cancel(second.id).status).toBe("cancelled");
    expect(q.cancel(first.id).status).toBe("cancelled");
    await q.idle();
    expect(aborted).toBe(true);
    expect(q.get(first.id)?.status).toBe("cancelled");
    expect(q.get(first.id)?.result).toBeUndefined();
    await q.close();
  });

  it("keeps jobs across a restart and resumes jobs that were running", async () => {
    const dbPath = join(tmpDir(), "state.sqlite");
    const a = queue(dbPath).q;
    let started!: () => void;
    const hasStarted = new Promise<void>((r) => {
      started = r;
    });
    a.register("convert", async (ctx) => {
      started();
      await new Promise((_r, reject) =>
        ctx.signal.addEventListener("abort", () => reject(new Error("stop"))),
      );
    });
    a.start();
    const queuedOnly = a.enqueue({ kind: "embed", by: "system" });
    const running = a.enqueue({ kind: "convert", by: "human", input: { n: 1 } });
    await hasStarted;
    await a.close();

    const b = queue(dbPath).q;
    expect(b.get(queuedOnly.id)?.status).toBe("queued");
    expect(b.get(running.id)?.status).toBe("running");
    const ran: string[] = [];
    b.register("convert", async (ctx) => {
      ran.push(`convert#${ctx.job.attempts}`);
      return "recovered";
    });
    b.register("embed", async () => {
      ran.push("embed");
    });
    b.start();
    await b.idle();
    expect(b.get(running.id)?.status).toBe("succeeded");
    expect(b.get(running.id)?.result).toBe("recovered");
    expect(b.get(queuedOnly.id)?.status).toBe("succeeded");
    expect(ran).toContain("convert#2");
    await b.close();
  });

  it("lists jobs newest first with a cursor and a status filter", async () => {
    const { q } = queue();
    q.register("ingest", async () => "x");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        q.enqueue({ kind: "ingest", by: "human", id: `j_0000000000${String(i)}${"A".repeat(10)}` })
          .id,
      );
    }
    const page1 = q.list({ limit: 2 });
    expect(page1.jobs.map((j) => j.id)).toEqual([ids[4], ids[3]]);
    expect(page1.next).toBe(ids[3]);
    const page2 = q.list({ limit: 2, cursor: page1.next });
    expect(page2.jobs.map((j) => j.id)).toEqual([ids[2], ids[1]]);
    expect(q.list({ status: "queued", limit: 10 }).jobs).toHaveLength(5);
    expect(q.list({ status: "failed", limit: 10 }).jobs).toHaveLength(0);
    await q.close();
  });

  it("keeps the partial result of a job that a handler ended on purpose", async () => {
    const { q } = queue();
    q.register("research", async () => {
      throw new CitegeistError({
        code: "RESEARCH_LOOP",
        message: "the same call three times",
        fix: "start again",
        recovery: "ask-human",
        context: { partial: { added: ["paper1"] } },
      });
    });
    q.start();
    const job = q.enqueue({ kind: "research", by: "human" });
    const done = await q.waitFor(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ code: "RESEARCH_LOOP" });
    expect(done.result).toEqual({ added: ["paper1"] });
    await q.close();
  });

  it("gives code below a handler the job, its actor and its abort signal", async () => {
    const { q } = queue();
    let seen: { job: string; actor: string; aborted: boolean } | undefined;
    q.register("ingest", async (ctx) => {
      await sleep(5);
      const scope = currentJobScope();
      if (scope) seen = { job: scope.job, actor: scope.actor, aborted: scope.signal.aborted };
      await new Promise<void>((resolve) =>
        scope?.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return ctx.job.id;
    });
    q.start();
    const job = q.enqueue({ kind: "ingest", by: "agent:grok" });
    await until(() => seen !== undefined);
    expect(seen).toEqual({ job: job.id, actor: "agent:grok", aborted: false });
    q.cancel(job.id);
    await q.idle();
    expect(q.get(job.id)?.status).toBe("cancelled");
    expect(currentJobScope()).toBeUndefined();
    await q.close();
  });
});

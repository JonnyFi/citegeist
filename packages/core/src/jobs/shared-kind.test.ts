import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { JobQueue } from "./queue.js";
import { shareKind } from "./shared-kind.js";

afterEach(cleanTmpDirs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tagged = (input: unknown): boolean =>
  typeof input === "object" && input !== null && "tagged" in input;

function setup() {
  const q = new JobQueue({ dbPath: join(tmpDir(), "state.sqlite"), backoffMs: () => 5 });
  const shared = shareKind(q, "research");
  return { q, shared };
}

describe("shareKind", () => {
  it("runs each job with the handler of the port that owns it", async () => {
    const { q, shared } = setup();
    const plain = shared.port((input) => !tagged(input));
    const other = shared.port(tagged);
    plain.register("research", async () => "chat result");
    other.register("research", async () => "webhook result", { concurrency: 1000 });
    q.start();

    const a = plain.enqueue({ kind: "research", by: "human", input: { prompt: "x" } });
    const b = other.enqueue({ kind: "research", by: "agent:grok", input: { tagged: true } });
    expect((await q.waitFor(a.id)).result).toBe("chat result");
    expect((await q.waitFor(b.id)).result).toBe("webhook result");
    expect(q.get(a.id)?.kind).toBe("research");
    expect(q.get(b.id)?.kind).toBe("research");
    await q.close();
  });

  it("does not let one port replace the handler of another", async () => {
    const { q, shared } = setup();
    const first = shared.port((input) => !tagged(input));
    const second = shared.port(tagged);
    first.register("research", async () => "first");
    second.register("research", async () => "second");
    // registering again on the same port replaces only its own handler
    first.register("research", async () => "first again");
    q.start();
    const a = first.enqueue({ kind: "research", by: "human", input: {} });
    const b = second.enqueue({ kind: "research", by: "human", input: { tagged: true } });
    expect((await q.waitFor(a.id)).result).toBe("first again");
    expect((await q.waitFor(b.id)).result).toBe("second");
    await q.close();
  });

  it("keeps the concurrency limit of each port", async () => {
    const { q, shared } = setup();
    const serial = shared.port((input) => !tagged(input));
    const wide = shared.port(tagged);
    let running = 0;
    const peaks = { serial: 0, wide: 0 };
    const work = (which: "serial" | "wide") => async () => {
      running++;
      peaks[which] = Math.max(peaks[which], running);
      await sleep(15);
      running--;
    };
    serial.register("research", work("serial"), { concurrency: 1 });
    wide.register("research", work("wide"), { concurrency: 1000 });
    q.start();

    for (let i = 0; i < 4; i++) serial.enqueue({ kind: "research", by: "human", input: {} });
    await q.idle();
    expect(peaks.serial).toBe(1);

    for (let i = 0; i < 5; i++) {
      wide.enqueue({ kind: "research", by: "human", input: { tagged: true } });
    }
    await q.idle();
    expect(peaks.wide).toBe(5);
    await q.close();
  });

  it("fails a job that no port owns", async () => {
    const { q, shared } = setup();
    shared.port(tagged).register("research", async () => "x");
    q.start();
    const job = q.enqueue({ kind: "research", by: "human", input: { prompt: "plain" } });
    const done = await q.waitFor(job.id);
    expect(done.status).toBe("failed");
    expect(done.error?.message).toMatch(/no handler for this research job/);
    await q.close();
  });
});

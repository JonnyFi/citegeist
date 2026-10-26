import { describe, expect, it } from "vitest";
import { MockBackend } from "./backends/mock.js";
import { aiErrors } from "./errors.js";
import { BackendHealth, DEFAULT_PAUSE_MS } from "./health.js";
import { AiRouter, type AiRoutingSettings } from "./routing.js";
import type { FallbackInfo, UsageRecord } from "./tasks/registry.js";

const OK = { paraphrase: "ok", kind: "finding" };
const TASK = "card.paraphrase";
const INPUT = { passage: "x" };

const limit = (id: string, text = "You've hit your limit · resets 3pm") =>
  aiErrors.backendFailed(id, TASK, text, { exitCode: 1 });

/** A backend that answers `OK` unless `fail` says otherwise. */
function fake(id: string, fail?: (n: number) => Error | undefined): MockBackend {
  let n = 0;
  return new MockBackend(
    {
      [TASK]: () => {
        const err = fail?.(++n);
        if (err) throw err;
        return { ...OK, paraphrase: id };
      },
    },
    id,
  );
}

function setup(
  backends: MockBackend[],
  settings: AiRoutingSettings,
  clock = { now: 1_000_000_000_000 },
) {
  const health = new BackendHealth(() => clock.now);
  const router = new AiRouter(backends, settings, { health });
  const records: UsageRecord[] = [];
  const notes: FallbackInfo[] = [];
  const opts = {
    record: (r: UsageRecord) => records.push(r),
    onFallback: (i: FallbackInfo) => notes.push(i),
  };
  return { router, health, records, notes, opts, clock };
}

describe("AiRouter fallback", () => {
  it("moves a task to the next backend when the first hits its limit", async () => {
    const claude = fake("claude", () => limit("claude"));
    const cursor = fake("cursor");
    const { router, records, notes, opts } = setup([claude, cursor], {
      routing: { "*": "claude" },
      fallback: ["cursor"],
    });
    const res = await router.run(TASK, INPUT, opts);
    expect(res.output.paraphrase).toBe("cursor");
    expect(res.via).toEqual({ from: "claude", kind: "limit" });
    expect(res.stamp.by).toMatch(/^cursor:/);
    expect(notes).toMatchObject([{ from: "claude", to: "cursor", kind: "limit" }]);
    expect(records.map((r) => [r.backend, r.ok, r.error])).toEqual([
      ["claude", false, "AI_USAGE_LIMIT"],
      ["cursor", true, undefined],
    ]);
  });

  it("skips a paused backend on later tasks without trying it", async () => {
    const claude = fake("claude", () => limit("claude"));
    const cursor = fake("cursor");
    const { router, health, notes, opts } = setup([claude, cursor], {
      routing: { "*": "claude" },
      fallback: ["cursor"],
    });
    await router.run(TASK, INPUT, opts);
    await router.run(TASK, INPUT, opts);
    expect(claude.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(2);
    expect(health.get("claude")).toMatchObject({ kind: "limit" });
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatchObject({ from: "claude", to: "cursor", kind: "limit" });
  });

  it("tries the backend again after the cool-down of 30 minutes", async () => {
    const claude = fake("claude", (n) =>
      n === 1 ? limit("claude", "usage limit reached") : undefined,
    );
    const cursor = fake("cursor");
    const { router, clock, opts } = setup([claude, cursor], {
      routing: { "*": "claude" },
      fallback: ["cursor"],
    });
    await router.run(TASK, INPUT, opts);
    clock.now += DEFAULT_PAUSE_MS.limit - 1000;
    expect((await router.run(TASK, INPUT, opts)).output.paraphrase).toBe("cursor");
    clock.now += 2000;
    expect((await router.run(TASK, INPUT, opts)).output.paraphrase).toBe("claude");
    expect(claude.calls).toHaveLength(2);
  });

  it("pauses until the reset time the backend names", async () => {
    // Epoch 1_000_000_000_000 ms plus one hour, written as the old Claude Code message does.
    const reset = Math.floor((1_000_000_000_000 + 3_600_000) / 1000);
    const claude = fake("claude", () => limit("claude", `Claude AI usage limit reached|${reset}`));
    const { router, health, opts } = setup([claude, fake("cursor")], {
      routing: { "*": "claude" },
      fallback: ["cursor"],
    });
    await router.run(TASK, INPUT, opts);
    expect(health.get("claude")?.until).toBe(reset * 1000);
  });

  it("goes through the fallback list in order and skips the routed backend and unknown ids", async () => {
    const a = fake("a", () => limit("a"));
    const b = fake("b", () => aiErrors.backendFailed("b", TASK, "API Error: 529 overloaded_error"));
    const c = fake("c");
    const { router, notes, opts } = setup([a, b, c], {
      routing: { "*": "a" },
      fallback: ["a", "ghost", "b", "c"],
    });
    const res = await router.run(TASK, INPUT, opts);
    expect(res.output.paraphrase).toBe("c");
    expect(notes.map((n) => [n.from, n.to, n.kind])).toEqual([
      ["a", "b", "limit"],
      ["b", "c", "overloaded"],
    ]);
  });

  it("pauses a backend that is overloaded for two minutes only", async () => {
    const a = fake("a", () => aiErrors.backendFailed("a", TASK, "Overloaded", { status: 529 }));
    const { router, health, opts, clock } = setup([a, fake("b")], {
      routing: { "*": "a" },
      fallback: ["b"],
    });
    await router.run(TASK, INPUT, opts);
    expect(health.get("a")?.kind).toBe("overloaded");
    clock.now += DEFAULT_PAUSE_MS.overloaded + 1;
    expect(health.get("a")).toBeUndefined();
  });

  it("falls back from a logged-out backend", async () => {
    const a = fake("a", () => aiErrors.cliLoggedOut("claude", "claude auth login"));
    const { router, health, opts } = setup([a, fake("b")], {
      routing: { "*": "a" },
      fallback: ["b"],
    });
    expect((await router.run(TASK, INPUT, opts)).output.paraphrase).toBe("b");
    expect(health.get("a")?.kind).toBe("auth");
  });

  it("does not fall back on content errors", async () => {
    const bad = new MockBackend({ [TASK]: { nope: true } }, "a");
    const b = fake("b");
    const { router, health, records, opts } = setup([bad, b], {
      routing: { "*": "a" },
      fallback: ["b"],
    });
    await expect(router.run(TASK, INPUT, opts)).rejects.toMatchObject({
      detail: { code: "AI_SCHEMA_INVALID" },
    });
    expect(b.calls).toHaveLength(0);
    expect(health.get("a")).toBeUndefined();
    expect(records).toMatchObject([{ backend: "a", ok: false, error: "AI_SCHEMA_INVALID" }]);
  });

  it("does not fall back without a fallback list, but still remembers the pause", async () => {
    const a = fake("a", () => limit("a"));
    const { router, health, opts } = setup([a], { routing: { "*": "a" } });
    await expect(router.run(TASK, INPUT, opts)).rejects.toMatchObject({
      detail: { code: "AI_BACKEND_FAILED" },
    });
    expect(health.get("a")?.kind).toBe("limit");
    // Everything is paused, so the pause is treated as possibly stale and the backend is tried.
    await expect(router.run(TASK, INPUT, opts)).rejects.toBeDefined();
    expect(a.calls).toHaveLength(2);
  });

  it("throws the last error when every backend fails", async () => {
    const a = fake("a", () => limit("a"));
    const b = fake("b", () => aiErrors.backendFailed("b", TASK, "rate limit exceeded"));
    const { router, records, opts } = setup([a, b], { routing: { "*": "a" }, fallback: ["b"] });
    await expect(router.run(TASK, INPUT, opts)).rejects.toThrow(/Backend b failed/);
    expect(records.map((r) => r.error)).toEqual(["AI_USAGE_LIMIT", "AI_USAGE_LIMIT"]);
  });

  it("uses the fallback when the routed backend is not built, and fails clearly without one", async () => {
    const b = fake("b");
    const withFallback = setup([b], { routing: { "*": "gone" }, fallback: ["b"] });
    expect((await withFallback.router.run(TASK, INPUT)).output.paraphrase).toBe("b");
    const without = setup([b], { routing: { "*": "gone" } });
    await expect(without.router.run(TASK, INPUT)).rejects.toMatchObject({
      detail: { code: "AI_UNKNOWN_BACKEND" },
    });
  });

  it("shares the pauses between routers that share one health object", async () => {
    const claude = fake("claude", () => limit("claude"));
    const cursor = fake("cursor");
    const first = setup([claude, cursor], { routing: { "*": "claude" }, fallback: ["cursor"] });
    await first.router.run(TASK, INPUT);
    const second = new AiRouter(
      [claude, cursor],
      { routing: { "*": "claude" }, fallback: ["cursor"] },
      { health: first.health },
    );
    await second.run(TASK, INPUT);
    expect(claude.calls).toHaveLength(1);
  });
});

describe("AiRouter fallback and cancellation", () => {
  it("does not start the next backend when the call was cancelled during the first", async () => {
    const controller = new AbortController();
    const a = fake("a", () => {
      controller.abort();
      return limit("a");
    });
    const b = fake("b");
    const { router, opts } = setup([a, b], { routing: { "*": "a" }, fallback: ["b"] });
    await expect(
      router.run(TASK, INPUT, { ...opts, signal: controller.signal }),
    ).rejects.toMatchObject({
      detail: { code: "AI_CANCELLED" },
    });
    expect(b.calls).toHaveLength(0);
  });

  it("passes a cancel error of a backend through without falling back", async () => {
    const a = fake("a", () => aiErrors.cancelled("a", TASK));
    const b = fake("b");
    const { router, health, opts } = setup([a, b], { routing: { "*": "a" }, fallback: ["b"] });
    await expect(router.run(TASK, INPUT, opts)).rejects.toMatchObject({
      detail: { code: "AI_CANCELLED" },
    });
    expect(b.calls).toHaveLength(0);
    expect(health.get("a")).toBeUndefined();
  });

  it("does not start any backend when the signal is already aborted", async () => {
    const a = fake("a");
    const { router } = setup([a], { routing: { "*": "a" } });
    await expect(router.run(TASK, INPUT, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      detail: { code: "AI_CANCELLED" },
    });
    expect(a.calls).toHaveLength(0);
  });
});

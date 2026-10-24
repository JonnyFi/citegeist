import { researchStart } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { bindChatOperations } from "./ops.js";
import {
  DEFAULT_RESEARCH_BUDGET,
  type GuardStop,
  type ResearchBudget,
  RunGuard,
  resolveBudget,
  stableJson,
} from "./research-budget.js";
import type { ChatHost, ChatUsageEntry } from "./service.js";
import { createHarness, type Harness, inlineQueue } from "./testing/harness.js";

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});

async function run(topic: string, host: Partial<ChatHost> = {}, maxItems = 5) {
  const h = await createHarness({ host });
  open.push(h);
  const jobs = inlineQueue();
  bindChatOperations(h.registry, { service: h.service, queue: jobs.queue });
  await h.registry.call(
    researchStart.name,
    { actor: "human" },
    { prompt: topic, backend: "fake", maxItems },
  );
  const outcome = (await jobs.done()) as {
    ok?: { added: Array<{ citekey: string }>; budget: Record<string, unknown> };
    error?: {
      detail: { code: string; message: string; context: { partial?: Record<string, unknown> } };
    };
  };
  return { h, outcome };
}

const call = (title: string, args: object = {}) => `@fake call ${title} ${JSON.stringify(args)}`;
const budget = (b: Partial<ResearchBudget>) => ({ researchBudget: () => b });

describe("loop detection", () => {
  it("ends the job when the same call with the same arguments comes three times in a row", async () => {
    const topic = [
      "Thema",
      `@fake mcp add_item ${JSON.stringify({ identifier: "10.1/a", why: "gut" })}`,
      call("search", { q: "platforms", page: 1 }),
      call("search", { page: 1, q: "platforms" }),
      call("search", { q: "platforms", page: 1 }),
      call("search", { q: "never reached" }),
    ].join("\n");
    const { h, outcome } = await run(topic);
    expect(outcome.ok).toBeUndefined();
    expect(outcome.error?.detail.code).toBe("RESEARCH_LOOP");
    expect(outcome.error?.detail.message).toContain("search");
    // What was found before the loop stays: in the job error and in the inbox.
    expect(outcome.error?.detail.context.partial).toMatchObject({
      added: [{ citekey: "paper1", why: "gut" }],
    });
    expect(h.inbox).toHaveLength(1);
    const session = h.service.list({ kind: "research", limit: 1 })[0];
    const tools = h.service.get(session?.id ?? "").entries.filter((e) => e.type === "tool");
    // The cancel needs a moment to reach the agent, so a further call may still get through.
    expect(
      tools.filter((t) => t.type === "tool" && t.title === "search").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("lets calls that differ in between pass", async () => {
    const topic = [
      "Thema",
      call("search", { q: "a" }),
      call("search", { q: "a" }),
      call("search", { q: "b" }),
      call("search", { q: "a" }),
      call("search", { q: "a" }),
    ].join("\n");
    const { outcome } = await run(topic);
    expect(outcome.error).toBeUndefined();
    expect(outcome.ok?.budget).toMatchObject({ toolCalls: 5 });
  });
});

describe("budgets", () => {
  it("stops after the limit of tool calls", async () => {
    const topic = ["Thema", ...[1, 2, 3, 4, 5].map((n) => call("search", { q: n }))].join("\n");
    const { outcome } = await run(topic, budget({ maxToolCalls: 3 }));
    expect(outcome.error?.detail.code).toBe("RESEARCH_BUDGET_EXCEEDED");
    expect(outcome.error?.detail.message).toContain("3 tool calls");
  });

  it("stops at the wall-clock limit", async () => {
    const started = Date.now();
    const { outcome } = await run("Thema\n@fake sleep 20000", budget({ maxMinutes: 0.01 }));
    expect(outcome.error?.detail.code).toBe("RESEARCH_BUDGET_EXCEEDED");
    expect(outcome.error?.detail.message).toContain("time limit");
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("stops when the usage updates add up to more than the token limit", async () => {
    const topic = ["Thema", "@fake usage 500", "@fake usage 1500", "@fake sleep 20000"].join("\n");
    const { outcome } = await run(topic, budget({ maxTokens: 1200 }));
    expect(outcome.error?.detail.code).toBe("RESEARCH_BUDGET_EXCEEDED");
    expect(outcome.error?.detail.message).toContain("1200 tokens");
  });

  it("counts a compaction as no new tokens", async () => {
    const topic = ["Thema", "@fake usage 900", "@fake usage 100", "@fake usage 300"].join("\n");
    const { outcome } = await run(topic, budget({ maxTokens: 1200 }));
    expect(outcome.error).toBeUndefined();
    expect(outcome.ok?.budget.tokens).toBe(1100);
  });

  it("says so when the agent sends no usage, and applies the defaults", async () => {
    const { outcome } = await run("Thema\n@fake say hallo");
    expect(outcome.error).toBeUndefined();
    expect(outcome.ok?.budget.tokens).toBeUndefined();
    expect(outcome.ok?.budget.note).toContain("token limit was not checked");
  });

  it("switches a limit off with zero", async () => {
    const topic = ["Thema", ...[1, 2, 3].map((n) => call("search", { q: n }))].join("\n");
    const { outcome } = await run(topic, budget({ maxToolCalls: 0 }));
    expect(outcome.error).toBeUndefined();
  });
});

describe("usage of agent turns", () => {
  it("reports tokens from the response and the price from the usage updates", async () => {
    const entries: ChatUsageEntry[] = [];
    const topic = ["Thema", "@fake usage 4000 0.12", "@fake usage 6000 0.30", "@fake replyusage"];
    await run(topic.join("\n"), { recordUsage: (e) => entries.push(e) });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "research", backend: "fake", ok: true });
    expect(entries[0]?.job).toMatch(/^j_/);
    expect(entries[0]?.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 250,
      cacheWriteTokens: 50,
    });
    expect(entries[0]?.usage?.costUsd).toBeCloseTo(0.3, 6);
  });

  it("charges the price of a later turn as the difference to the session total", async () => {
    const entries: ChatUsageEntry[] = [];
    const h = await createHarness({ host: { recordUsage: (e) => entries.push(e) } });
    open.push(h);
    const { session } = await h.chat("@fake usage 1000 0.10");
    await h.say(session, "@fake usage 2500 0.25");
    expect(entries.map((e) => e.kind)).toEqual(["chat", "chat"]);
    expect(entries[0]?.usage?.costUsd).toBeCloseTo(0.1, 6);
    expect(entries[1]?.usage?.costUsd).toBeCloseTo(0.15, 6);
    // Without token counts in the response, the growth of the context stands in for the input.
    expect(entries[1]?.usage?.inputTokens).toBe(1500);
  });

  it("reports a turn without any usage as a call with no usage", async () => {
    const entries: ChatUsageEntry[] = [];
    const h = await createHarness({ host: { recordUsage: (e) => entries.push(e) } });
    open.push(h);
    await h.chat("@fake say hallo");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.usage).toBeUndefined();
  });
});

describe("RunGuard", () => {
  it("serialises arguments with sorted keys", () => {
    expect(stableJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("takes the defaults for missing or invalid fields", () => {
    expect(resolveBudget()).toEqual(DEFAULT_RESEARCH_BUDGET);
    expect(resolveBudget({ maxMinutes: -1, maxToolCalls: 7 })).toEqual({
      ...DEFAULT_RESEARCH_BUDGET,
      maxToolCalls: 7,
    });
  });

  it("stops only once and keeps the first reason", () => {
    const stops: GuardStop[] = [];
    const guard = new RunGuard({ maxMinutes: 0, maxTokens: 0, maxToolCalls: 1 }, (s) =>
      stops.push(s),
    );
    for (const id of ["a", "b", "c"]) {
      guard.observe({ type: "tool", callId: id, title: id, kind: "other", status: "done" });
    }
    expect(stops).toHaveLength(1);
    expect(guard.stopped?.code).toBe("RESEARCH_BUDGET_EXCEEDED");
  });
});

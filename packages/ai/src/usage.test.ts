import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeUsage } from "./backends/claude-cli.js";
import { codexUsage } from "./backends/codex-exec.js";
import { cursorUsage } from "./backends/cursor-cli.js";
import { MockBackend } from "./backends/mock.js";
import { chatCompletionUsage } from "./backends/openai-http.js";
import { runTask, type UsageRecord } from "./tasks/registry.js";

const recorded = JSON.parse(
  readFileSync(new URL("./backends/recordings/claude-p-success.json", import.meta.url), "utf8"),
);

describe("usage of the backends", () => {
  it("reads tokens, cache and list price from a claude -p result", () => {
    expect(claudeUsage(recorded)).toEqual({
      inputTokens: 1309,
      outputTokens: 289,
      cacheReadTokens: 750,
      cacheWriteTokens: 753,
      costUsd: 0.0004335,
      model: "claude-haiku-5-5",
    });
  });

  it("falls back to the usage block when modelUsage is missing", () => {
    const { modelUsage: _drop, ...rest } = recorded;
    expect(claudeUsage(rest)).toMatchObject({
      inputTokens: 2,
      outputTokens: 268,
      cacheReadTokens: 750,
      cacheWriteTokens: 753,
      costUsd: 0.0004335,
    });
  });

  it("reads tokens from an agent -p result, without a price", () => {
    const u = cursorUsage({
      usage: { inputTokens: 10349, outputTokens: 27, cacheReadTokens: 3968, cacheWriteTokens: 0 },
    });
    expect(u).toEqual({
      inputTokens: 10349,
      outputTokens: 27,
      cacheReadTokens: 3968,
      cacheWriteTokens: 0,
    });
    expect(u?.costUsd).toBeUndefined();
  });

  it("sums the turn.completed events of codex exec --json and takes the cache out of the input", () => {
    const out = [
      '{"type":"thread.started","thread_id":"t"}',
      "2026-10-24T20:10:37Z ERROR noise that is not JSON",
      '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":50}}',
    ].join("\n");
    expect(codexUsage(out)).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
    });
    expect(codexUsage('{"type":"turn.started"}')).toBeUndefined();
  });

  it("reads an OpenAI style usage block, with the price OpenRouter adds", () => {
    expect(
      chatCompletionUsage({
        model: "qwen3:8b",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          cost: 0.002,
          prompt_tokens_details: { cached_tokens: 100 },
        },
      }),
    ).toEqual({
      inputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      costUsd: 0.002,
      model: "qwen3:8b",
    });
    expect(chatCompletionUsage({})).toBeUndefined();
  });
});

describe("runTask usage", () => {
  const input = { passage: "Response rates dropped over the course of fourteen panel waves." };
  const answer = { paraphrase: "Rates fell over the waves.", core: "Rates fell.", kind: "finding" };

  it("sums the attempts into the result and the record", async () => {
    const backend = new MockBackend({
      "card.paraphrase": [{ wrong: true }, answer],
    });
    backend.usage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    };
    const records: UsageRecord[] = [];
    const res = await runTask(backend, "card.paraphrase", input, {
      record: (r) => records.push(r),
    });
    expect(res.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      costUsd: 0.002,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      task: "card.paraphrase",
      backend: "mock",
      model: "mock-fast",
      ok: true,
      inputTokens: 20,
    });
  });

  it("records a failed call with its error code", async () => {
    const backend = new MockBackend();
    const records: UsageRecord[] = [];
    await expect(
      runTask(backend, "card.paraphrase", input, { record: (r) => records.push(r) }),
    ).rejects.toThrow();
    expect(records).toEqual([
      expect.objectContaining({ ok: false, error: "AI_BACKEND_FAILED", inputTokens: 0 }),
    ]);
  });

  it("leaves usage out of the result when the backend reports none", async () => {
    const backend = new MockBackend({ "card.paraphrase": answer });
    const res = await runTask(backend, "card.paraphrase", input);
    expect(res.usage).toBeUndefined();
  });
});

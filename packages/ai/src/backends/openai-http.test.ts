import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type FetchLike, OPENAI_COMPAT_PRESETS, OpenAiCompatBackend } from "./openai-http.js";

const Out = z.object({ paraphrase: z.string(), core: z.string() });
const req = { task: "card.paraphrase", prompt: "P", system: "S", schema: Out };

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function backend(fetch: FetchLike, extra: object = {}) {
  return new OpenAiCompatBackend({
    id: "openrouter",
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test",
    models: { fast: "m-fast", smart: "m-smart" },
    fetch,
    ...extra,
  });
}

describe("OpenAiCompatBackend", () => {
  it("posts a json_schema request with the key and parses the answer", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await backend(async (url, init) => {
      seen.push({ url, init });
      return completion('{"paraphrase":"p","core":"c"}');
    }).complete(req);
    expect(out).toEqual({ paraphrase: "p", core: "c" });
    expect(seen[0]?.url).toBe("https://example.test/v1/chat/completions");
    const init = seen[0]?.init as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("m-fast");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].content).toContain("JSON Schema");
  });

  it("omits response_format in prompt mode (Anthropic compatibility endpoint)", async () => {
    let body: Record<string, unknown> = {};
    await backend(
      async (_u, init) => {
        body = JSON.parse(init.body as string);
        return completion('```json\n{"paraphrase":"p","core":"c"}\n```');
      },
      { structured: "prompt" },
    ).complete({ ...req, model: "smart" });
    expect(body.response_format).toBeUndefined();
    expect(body.model).toBe("m-smart");
  });

  it("retries once on a schema failure", async () => {
    let n = 0;
    const out = await backend(async () =>
      completion(++n === 1 ? '{"paraphrase":"p"}' : '{"paraphrase":"p","core":"c"}'),
    ).complete(req);
    expect(out.core).toBe("c");
    expect(n).toBe(2);
  });

  it("maps 401, server errors and timeouts to agent-ready errors", async () => {
    await expect(
      backend(async () => new Response("no", { status: 401 })).complete(req),
    ).rejects.toMatchObject({
      detail: { code: "AI_NOT_CONFIGURED" },
    });
    await expect(
      backend(async () => new Response("down", { status: 503 })).complete(req),
    ).rejects.toMatchObject({
      detail: { code: "AI_BACKEND_FAILED", context: { status: 503 } },
    });
    await expect(
      backend(async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      }).complete(req),
    ).rejects.toMatchObject({ detail: { code: "AI_TIMEOUT" } });
    await expect(
      backend(async () => {
        throw new Error("connect ECONNREFUSED");
      }).complete(req),
    ).rejects.toMatchObject({ detail: { code: "AI_BACKEND_FAILED" } });
  });

  it("ships presets for the named providers", () => {
    expect(Object.keys(OPENAI_COMPAT_PRESETS).sort()).toEqual([
      "anthropic",
      "ollama",
      "openai",
      "openrouter",
      "xai",
    ]);
    expect(OPENAI_COMPAT_PRESETS.anthropic.structured).toBe("prompt");
  });
});

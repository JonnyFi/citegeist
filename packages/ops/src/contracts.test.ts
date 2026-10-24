import { describe, expect, it } from "vitest";
import { CONTRACTS, itemsAdd, Registry } from "./index.js";

describe("contracts", () => {
  it("have unique names and unique MCP tool names", () => {
    const names = CONTRACTS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const tools = CONTRACTS.flatMap((c) => (c.mcp ? [c.mcp.tool] : []));
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools.length).toBeLessThanOrEqual(16);
  });

  it("never expose admin operations over MCP", () => {
    expect(CONTRACTS.filter((c) => c.access === "admin" && c.mcp)).toEqual([]);
  });

  it("validates input and output through the registry", async () => {
    const reg = new Registry().bind(itemsAdd, async (_ctx, input) => ({
      citekey: "smith2020",
      job: "j_01JB8Z3QK7ABCDEFGH",
      ...(input.target === "library" ? {} : {}),
    }));
    const out = await reg.call("items.add", { actor: "agent:grok" }, { identifier: "10.1000/x" });
    expect(out).toEqual({ citekey: "smith2020", job: "j_01JB8Z3QK7ABCDEFGH" });
    await expect(reg.call("items.add", { actor: "human" }, {})).rejects.toThrow();
  });
});

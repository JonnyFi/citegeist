import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapterLaunch, CLAUDE_CODE, CODEX, resolveAdapterEntry } from "./backends.js";

describe("bundled ACP adapters", () => {
  it("resolves the Claude and Codex adapters from node_modules, not from npx", () => {
    for (const def of [CLAUDE_CODE, CODEX]) {
      const launch = def.launch(() => undefined);
      expect(launch?.command).toBe(process.execPath);
      expect(launch?.args).toHaveLength(1);
      expect(existsSync(launch?.args[0] ?? "")).toBe(true);
    }
  });

  it("points into the unpacked copy when the package sits inside an asar archive", () => {
    const entry = resolveAdapterEntry("@agentclientprotocol/codex-acp");
    expect(entry).toBeDefined();
    expect(entry).not.toContain(".asar");
  });

  it("returns nothing for a package that is not installed", () => {
    expect(adapterLaunch("@citegeist/no-such-adapter")).toBeUndefined();
  });
});

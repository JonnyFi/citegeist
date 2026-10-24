import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("quick-insert window", () => {
  it("stays on all workspaces without turning citegeist into a Dock-less UIElement", () => {
    // protects: citegeist keeps its Dock icon on macOS while the palette window exists
    // fails_when: setVisibleOnAllWorkspaces is called without skipTransformProcessType (Electron hides the Dock icon)
    // no_claim: a source check; the process type itself is only visible in a packaged app (lsappinfo)
    const source = readFileSync(join(import.meta.dirname, "electron.ts"), "utf8");
    const calls = source.match(/setVisibleOnAllWorkspaces\([^)]*\)/gs) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("skipTransformProcessType: true");
  });
});

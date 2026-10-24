import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QI } from "../quick-insert/channels.js";

describe("main preload", () => {
  it("uses the channel names of the quick-insert settings, without importing them", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(source).toContain(`"${QI.getSettings}"`);
    expect(source).toContain(`"${QI.setSettings}"`);
    // A sandboxed preload cannot require a shared chunk, so no local module may be imported.
    expect(source).not.toMatch(/from "\.\.?\//);
  });

  it("exposes pathForFile through webUtils for dropped files", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(source).toMatch(/pathForFile:\s*\(file\)\s*=>\s*webUtils\.getPathForFile\(file\)/);
  });

  it("exposes the native path picker over its own channel", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(source).toContain('"citegeist:pick-paths"');
    const main = readFileSync(join(import.meta.dirname, "../main/index.ts"), "utf8");
    expect(main).toContain('"citegeist:pick-paths"');
  });
});

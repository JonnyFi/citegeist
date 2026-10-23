import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../library.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { renderAgentsMd, renderClaudeMd, writeAgentsMd } from "./index.js";

afterEach(cleanTmpDirs);

describe("AGENTS.md generator", () => {
  it("renders the rules for a library", () => {
    expect(renderAgentsMd({ name: "Research" })).toMatchSnapshot();
  });

  it("renders a one-line CLAUDE.md that points to AGENTS.md", () => {
    expect(renderClaudeMd()).toBe("See AGENTS.md for the rules of this library.\n");
  });

  it("names the rules agents need", () => {
    const text = renderAgentsMd();
    for (const needle of [
      "derived/",
      "add_item",
      "cg items add",
      "inbox",
      'target: "library"',
      "by: agent:<your-name>",
      "quote of a card",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it("writes both files and keeps a hand-written CLAUDE.md", async () => {
    const root = tmpDir("cg-lib-");
    const lib = await Library.init(root, {
      name: "Mine",
      localBase: tmpDir("cg-local-"),
      watch: false,
    });
    try {
      writeFileSync(lib.paths.agentsMd, "stale");
      writeFileSync(lib.paths.claudeMd, "my own notes\n");
      expect(writeAgentsMd(lib)).toEqual({ agentsMd: "written", claudeMd: "unchanged" });
      expect(readFileSync(lib.paths.agentsMd, "utf8")).toBe(renderAgentsMd({ name: "Mine" }));
      expect(readFileSync(lib.paths.claudeMd, "utf8")).toBe("my own notes\n");
      expect(writeAgentsMd(lib).agentsMd).toBe("unchanged");
    } finally {
      await lib.close();
    }
  });
});

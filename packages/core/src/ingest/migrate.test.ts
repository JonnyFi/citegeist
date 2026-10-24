import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownFile } from "../frontmatter.js";
import { Library } from "../library.js";
import { cleanTmpDirs, itemData, tmpDir, writeRaw } from "../test-helpers.js";
import { updateItem } from "./items.js";

// Older versions stored `fulltext` and `proposal` as untyped extra keys. Files in that shape are
// read as the typed fields and rewritten the next time the core saves the item.

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

function legacyFile(extra: Record<string, unknown>): string {
  const fm = itemData("smith2020legacy") as Record<string, unknown>;
  return MarkdownFile.create({ ...fm, ...extra }, "").toString();
}

async function setup(extra: Record<string, unknown>) {
  const root = tmpDir("cg-migrate-");
  writeRaw(root, "items/smith2020legacy/smith2020legacy.md", legacyFile(extra));
  const lib = await Library.init(root, { watch: false, localBase: tmpDir("cg-local-") });
  open.push(lib);
  lib.sync();
  return { lib, root };
}

const OLD_FULLTEXT = {
  status: "none",
  at: "2026-10-24T10:00:00.000Z",
  tried: [
    { source: "unpaywall", outcome: "none" },
    { source: "openalex", outcome: "failed", detail: "HTTP 500" },
  ],
};

describe("legacy item keys", () => {
  it("reads the old fulltext marker as a typed field", async () => {
    const { lib } = await setup({ fulltext: OLD_FULLTEXT });
    const fm = lib.getItem("smith2020legacy").frontmatter;
    expect(fm.fulltext).toEqual({
      status: "missing",
      tried: OLD_FULLTEXT.tried,
      checked_at: "2026-10-24T10:00:00.000Z",
    });
  });

  it("shows the migrated marker in items.list", async () => {
    const { lib } = await setup({ fulltext: OLD_FULLTEXT });
    const page = lib.listItems({ limit: 10 });
    expect(page.items[0]?.fulltext).toBe("missing");
  });

  it("rewrites the file in the new shape with the next save", async () => {
    const { lib } = await setup({ fulltext: OLD_FULLTEXT });
    const path = lib.getItem("smith2020legacy").path;
    expect(readFileSync(path, "utf8")).toContain("status: none");
    updateItem(lib, "human", "smith2020legacy", { tags: ["read-later"] });
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("status: missing");
    expect(raw).toContain("checked_at:");
    expect(raw).not.toContain("status: none");
    expect(MarkdownFile.parse(raw).data?.fulltext).not.toHaveProperty("at");
    expect(lib.getItem("smith2020legacy").frontmatter.fulltext?.status).toBe("missing");
  });

  it("keeps a current marker as it is", async () => {
    const current = { status: "found", tried: [], checked_at: "2026-10-24T10:00:00.000Z" };
    const { lib } = await setup({ fulltext: current });
    updateItem(lib, "human", "smith2020legacy", { tags: ["x"] });
    expect(lib.getItem("smith2020legacy").frontmatter.fulltext).toEqual(current);
  });

  it("types the first-page proposal", async () => {
    const proposal = {
      status: "needs-review",
      source: "pdf-first-page",
      reason: "title matching gave 'ambiguous', no confident match",
      candidates: [{ title: "A paper", DOI: null, similarity: 0.71 }],
    };
    const { lib } = await setup({ proposal });
    expect(lib.getItem("smith2020legacy").frontmatter.proposal).toEqual(proposal);
    // a proposal without a status (an early shape) reads as needing review
    const bare = await setup({ proposal: { source: "filename", reason: "no title" } });
    expect(bare.lib.getItem("smith2020legacy").frontmatter.proposal?.status).toBe("needs-review");
  });
});

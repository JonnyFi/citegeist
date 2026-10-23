import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, makePdf, type TestEnv } from "./ingest/testing.js";
import { cleanTmpDirs, tmpDir } from "./test-helpers.js";

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

interface Assets {
  source: string;
  kind: string;
  pdfUrl?: string;
  html?: string;
  blocks: Array<{ id: string; text: string }>;
  pages?: { confirmed: boolean; pages: Array<{ label: string }> };
}

async function addPdf(e: TestEnv): Promise<string> {
  const path = join(tmpDir("cg-pdf-"), "paper.pdf");
  writeFileSync(path, makePdf([["Open access PDF"]]));
  const out = await e.call<{ citekey: string; job: string }>("items.add", { identifier: path });
  await e.svc.queue.waitFor(out.job);
  return out.citekey;
}

describe("documents.assets", () => {
  it("returns the file url, html, blocks and pages of a converted PDF", async () => {
    const e = await createTestEnv();
    envs.push(e);
    const citekey = await addPdf(e);
    const hash = e.lib.getItem(citekey).frontmatter.sources[0]?.hash;
    const assets = await e.call<Assets>("documents.assets", { citekey });
    expect(assets.source).toBe(hash);
    expect(assets.kind).toBe("pdf");
    expect(assets.pdfUrl).toBe(`/files/${citekey}/sources/${hash}.pdf`);
    expect(assets.html).toContain("<title>stub</title>");
    expect(assets.blocks).toHaveLength(9);
    expect(assets.pages?.pages.map((p) => p.label)).toEqual(["10", "11", "12"]);
  });

  it("answers with an empty block list while the source is not converted", async () => {
    const e = await createTestEnv({ workerEnv: { CG_STUB_FAIL: "1" } });
    envs.push(e);
    const citekey = await addPdf(e);
    const assets = await e.call<Assets>("documents.assets", { citekey });
    expect(assets.pdfUrl).toMatch(/\.pdf$/);
    expect(assets.blocks).toEqual([]);
    expect(assets.html).toBeUndefined();
    expect(assets.pages).toBeUndefined();
  });

  it("rejects an unknown source and an item without sources", async () => {
    const e = await createTestEnv();
    envs.push(e);
    const citekey = await addPdf(e);
    await expect(
      e.call("documents.assets", { citekey, source: "0".repeat(12) }),
    ).rejects.toMatchObject({ detail: { code: "SOURCE_NOT_FOUND" } });
    await expect(e.call("documents.assets", { citekey: "nobody2020none" })).rejects.toMatchObject({
      detail: { code: "ITEM_NOT_FOUND" },
    });
  });
});

describe("library reads", () => {
  it("reports the manifest defaults in library.status", async () => {
    const e = await createTestEnv();
    envs.push(e);
    const status = await e.call<{ defaults?: { ai_language: string; style: string } }>(
      "library.status",
      {},
    );
    expect(status.defaults).toMatchObject({ ai_language: "de", style: "apa", locale: "de-DE" });
  });

  it("lists who added an inbox item and why", async () => {
    const e = await createTestEnv();
    envs.push(e);
    const out = await e.call<{ citekey: string }>(
      "items.add",
      { identifier: "10.1038/s41586-020-2649-2", target: "inbox", why: "Cited by three papers" },
      "agent:claude-code",
    );
    const list = await e.call<{ items: Array<Record<string, unknown>> }>("items.list", {
      inbox: true,
    });
    const row = list.items.find((i) => i.citekey === out.citekey);
    expect(row).toMatchObject({
      inbox: true,
      inboxBy: "agent:claude-code",
      inboxWhy: "Cited by three papers",
    });
    const library = await e.call<{ items: Array<Record<string, unknown>> }>("items.list", {
      inbox: false,
    });
    expect(library.items.every((i) => i.inboxBy === undefined)).toBe(true);
  });
});

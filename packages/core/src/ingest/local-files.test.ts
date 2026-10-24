import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv } from "./testing.js";

// M4: a caller whose token does not allow local files (a research session) cannot make the core
// read a file of this Mac through items.add or items.attach.

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(): Promise<TestEnv> {
  const e = await createTestEnv();
  envs.push(e);
  return e;
}

const restricted = { actor: "agent:research" as const, localFiles: false };
const FORBIDDEN = { detail: { code: "LOCAL_FILES_FORBIDDEN" } };

describe("callers that may not read local files", () => {
  it("refuses items.add for a path, a file URL and a bare file name", async () => {
    const e = await env();
    const path = join(tmpDir("cg-local-"), "secret.pdf");
    writeFileSync(path, makePdf([["Secret"]]));
    for (const identifier of [path, `file://${path}`, "~/Documents/thesis.pdf", "./thesis.pdf"]) {
      await expect(e.registry.call("items.add", restricted, { identifier })).rejects.toMatchObject(
        FORBIDDEN,
      );
    }
    expect(e.lib.listItems({ limit: 10 }).items).toEqual([]);
  });

  it("refuses items.attach for every path", async () => {
    const e = await env();
    const added = (await e.call("items.add", {
      identifier: "@book{k, title={A book}, author={Doe, Jane}, year={2020}}",
    })) as { citekey: string; job: string };
    await e.svc.queue.waitFor(added.job);
    const path = join(tmpDir("cg-local-"), "paper.pdf");
    writeFileSync(path, makePdf([["Text"]]));
    await expect(
      e.registry.call("items.attach", restricted, { citekey: added.citekey, path }),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(e.lib.getItem(added.citekey).frontmatter.sources).toEqual([]);
  });

  it("still adds a DOI and a BibTeX entry", async () => {
    const e = await env();
    const doi = (await e.registry.call("items.add", restricted, {
      identifier: "10.1086/225469",
    })) as { citekey: string };
    expect(doi.citekey).toBeTruthy();
    const bib = (await e.registry.call("items.add", restricted, {
      identifier: "@book{k, title={A book}, author={Doe, Jane}, year={2020}}",
    })) as { citekey: string };
    expect(bib.citekey).toBeTruthy();
  });

  it("leaves the human and callers without the flag alone", async () => {
    const e = await env();
    const path = join(tmpDir("cg-local-"), "paper.pdf");
    writeFileSync(path, makePdf([["Text"]]));
    const out = (await e.call("items.add", { identifier: path })) as { citekey: string };
    expect(out.citekey).toBeTruthy();
  });
});

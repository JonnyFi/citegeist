import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv } from "./testing.js";

// The inbox is explicit: only inbox.accept accepts, and an inbox item that is the same work as a
// library item is merged on request.

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(opts: Parameters<typeof createTestEnv>[0] = {}): Promise<TestEnv> {
  const e = await createTestEnv(opts);
  envs.push(e);
  return e;
}

interface AddOut {
  citekey: string;
  job: string;
  duplicateOf?: string;
  repaired?: boolean;
  inInbox?: boolean;
}

const DOI = "10.1086/225469";
const NUMPY_DOI = "10.1038/s41586-020-2649-2";
const NO_TEXT = async () => ({ firstPage: "", leading: "", pages: 1 });
const BIB = "@article{x1, title={Weak Ties Draft}, author={Granovetter, Mark}, year={1973}}";

async function add(e: TestEnv, identifier: string, extra: object = {}, actor = "human") {
  const out = await e.call<AddOut>("items.add", { identifier, ...extra }, actor as never);
  await e.svc.queue.waitFor(out.job);
  await e.svc.queue.idle();
  return out;
}

function pdfFile(lines: string[][]): string {
  const path = join(tmpDir("cg-pdf-"), "scan.pdf");
  writeFileSync(path, makePdf(lines));
  return path;
}

const fm = (e: TestEnv, citekey: string) => e.lib.getItem(citekey).frontmatter;
const inboxKeys = (e: TestEnv) =>
  e.lib.listItems({ inbox: true, limit: 50 }).items.map((i) => i.citekey);
const exists = (e: TestEnv, citekey: string) =>
  e.lib.index.get("SELECT 1 FROM items WHERE citekey = ?", citekey) !== undefined;

describe("only inbox.accept accepts", () => {
  it("a human duplicate add leaves the item in the inbox and says so", async () => {
    const e = await env();
    const queued = await add(e, DOI, {}, "agent:grok");
    const again = await e.call<AddOut>("items.add", { identifier: DOI });
    expect(again).toMatchObject({ duplicateOf: queued.citekey, inInbox: true });
    expect(inboxKeys(e)).toEqual([queued.citekey]);
  });

  it("a PDF that repairs an inbox item leaves it in the inbox", async () => {
    const e = await env();
    const queued = await add(e, DOI, {}, "agent:grok");
    expect(fm(e, queued.citekey).sources).toHaveLength(0);
    const out = await add(e, pdfFile([["Some paper", `doi:${DOI}`]]));
    expect(out).toMatchObject({ citekey: queued.citekey, repaired: true, inInbox: true });
    expect(fm(e, queued.citekey).sources).toHaveLength(1);
    expect(fm(e, queued.citekey).inbox).toMatchObject({ by: "agent:grok" });
  });

  it("a PDF merged into an inbox item after its conversion leaves it in the inbox", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: {
        CG_STUB_HEADER: JSON.stringify({
          title: "The strength of weak ties",
          authors: ["Mark Granovetter"],
          doi: DOI,
          date: "1973-05-01",
        }),
      },
    });
    const queued = await add(e, DOI, {}, "agent:grok");
    const out = await e.call<AddOut>("items.add", { identifier: pdfFile([["scan"]]) });
    const job = await e.svc.queue.waitFor(out.job);
    await e.svc.queue.idle();
    expect(job.result).toMatchObject({
      citekey: queued.citekey,
      merged: { from: out.citekey, into: queued.citekey, inInbox: true },
    });
    expect(inboxKeys(e)).toEqual([queued.citekey]);
    // the person decides
    await e.call("inbox.accept", { citekeys: [queued.citekey] });
    expect(inboxKeys(e)).toEqual([]);
  });
});

describe("an identifier across the inbox boundary", () => {
  /** A library item without DOI that the person edited, and an inbox item with DOI and PDF. */
  async function libraryAndInbox(e: TestEnv) {
    const library = await add(e, BIB, { tags: ["mine"], projects: [] });
    await e.call("items.update", {
      citekey: library.citekey,
      patch: { title: "My own title", tags: ["mine"] },
    });
    const inbox = await add(e, NUMPY_DOI, { tags: ["theirs"], why: "found it" }, "agent:grok");
    expect(fm(e, inbox.citekey).sources).toHaveLength(1);
    return { library: library.citekey, inbox: inbox.citekey };
  }

  it("names the inbox item instead of failing, for items.resolve, items.add and items.update", async () => {
    const e = await env();
    const { library, inbox } = await libraryAndInbox(e);
    const expected = {
      detail: {
        code: "IDENTIFIER_IN_INBOX",
        context: { citekey: library, duplicateOf: inbox, merge: { from: inbox, into: library } },
      },
    };
    await expect(
      e.call("items.resolve", { citekey: library, identifier: NUMPY_DOI }),
    ).rejects.toMatchObject(expected);
    await expect(
      e.call("items.add", { identifier: NUMPY_DOI, citekey: library }),
    ).rejects.toMatchObject(expected);
    await expect(
      e.call("items.update", { citekey: library, patch: { DOI: NUMPY_DOI } }),
    ).rejects.toMatchObject(expected);
    // nothing was stored
    expect(fm(e, library).DOI).toBeUndefined();
  });

  it("keeps IDENTIFIER_IN_USE for an agent and for two items on the same side", async () => {
    const e = await env();
    const { library, inbox } = await libraryAndInbox(e);
    await expect(
      e.call("items.resolve", { citekey: library, identifier: NUMPY_DOI }, "agent:grok"),
    ).rejects.toMatchObject({ detail: { code: "IDENTIFIER_IN_USE" } });
    const second = await add(e, "10.2139/ssrn.1462344", {}, "agent:grok");
    await expect(
      e.call("items.resolve", { citekey: second.citekey, identifier: NUMPY_DOI }),
    ).rejects.toMatchObject({
      detail: { code: "IDENTIFIER_IN_USE", context: { duplicateOf: inbox } },
    });
  });

  it("merges the inbox item into the library item", async () => {
    const e = await env();
    const { library, inbox } = await libraryAndInbox(e);
    const source = fm(e, inbox).sources[0];
    const out = await e.call<{
      citekey: string;
      job: string;
      filled: string[];
      moved: string[];
      convert?: string;
    }>("items.merge", { from: inbox, into: library });
    expect(out.citekey).toBe(library);
    expect(out.moved).toEqual([source?.hash]);
    expect(out.filled).toEqual(expect.arrayContaining(["DOI", "container-title"]));
    await e.svc.queue.idle();

    const merged = fm(e, library);
    // sources moved, and converted at the target
    expect(merged.sources.map((s) => s.hash)).toEqual([source?.hash]);
    expect(existsSync(e.lib.paths.derivedManifest(library, source?.hash ?? ""))).toBe(true);
    // empty fields filled, edited fields kept
    expect(merged.DOI).toBe(NUMPY_DOI);
    expect(merged.title).toBe("My own title");
    expect(merged.provenance.title).toMatch(/^human@/);
    expect(merged.provenance.DOI).toMatch(/^crossref@/);
    // tags united, the library item stays accepted
    expect(merged.tags).toEqual(expect.arrayContaining(["mine", "theirs"]));
    expect(merged.inbox).toBeUndefined();
    // the inbox item is in the trash and can come back
    expect(exists(e, inbox)).toBe(false);
    expect(readdirSync(join(e.root, ".trash")).some((n) => n.startsWith(`${inbox}-`))).toBe(true);
    // one history entry
    const job = await e.call<Job>("jobs.get", { job: out.job });
    expect(job).toMatchObject({
      status: "succeeded",
      by: "human",
      message: `merged the inbox item ${inbox} into ${library}`,
    });
    const records = e.svc.queue
      .list({ limit: 100 })
      .jobs.filter((j) => (j.input as { merge?: unknown } | null)?.merge !== undefined);
    expect(records).toHaveLength(1);
    expect(merged.modified?.by).toBe("human");
    await e.call("items.restore", { citekey: inbox });
    expect(exists(e, inbox)).toBe(true);
  });

  it("merges an inbox item into the library item that holds the identifier", async () => {
    const e = await env();
    const library = await add(e, NUMPY_DOI);
    const draft = await add(e, BIB, { tags: ["draft"] }, "agent:grok");
    expect(inboxKeys(e)).toEqual([draft.citekey]);
    // the inbox item is the one the person works on
    await expect(
      e.call("items.resolve", { citekey: draft.citekey, identifier: NUMPY_DOI }),
    ).rejects.toMatchObject({
      detail: {
        code: "IDENTIFIER_IN_INBOX",
        context: { citekey: draft.citekey, merge: { from: draft.citekey, into: library.citekey } },
      },
    });
    const before = fm(e, library.citekey);
    const out = await e.call<{ citekey: string; moved: string[] }>("items.merge", {
      from: draft.citekey,
      into: library.citekey,
    });
    expect(out.citekey).toBe(library.citekey);
    expect(out.moved).toEqual([]);
    const after = fm(e, library.citekey);
    expect(after.title).toBe(before.title);
    expect(after.DOI).toBe(NUMPY_DOI);
    expect(after.sources).toEqual(before.sources);
    expect(after.tags).toContain("draft");
    expect(exists(e, draft.citekey)).toBe(false);
    expect(inboxKeys(e)).toEqual([]);
  });

  it("moves a PDF of the inbox item to a library item that has none", async () => {
    const e = await env();
    const library = await add(e, BIB);
    const waiting = await add(e, pdfFile([["Some scan"]]), {}, "agent:grok");
    expect(fm(e, waiting.citekey).sources).toHaveLength(1);
    const out = await e.call<{ moved: string[] }>("items.merge", {
      from: waiting.citekey,
      into: library.citekey,
    });
    await e.svc.queue.idle();
    expect(out.moved).toHaveLength(1);
    expect(fm(e, library.citekey).sources.map((s) => s.hash)).toEqual(out.moved);
    expect(existsSync(e.lib.paths.derivedManifest(library.citekey, out.moved[0] ?? ""))).toBe(true);
  });

  it("refuses anything but an inbox item, an agent and an item with cards", async () => {
    const e = await env();
    const a = await add(e, NUMPY_DOI);
    const b = await add(e, BIB);
    await expect(e.call("items.merge", { from: a.citekey, into: b.citekey })).rejects.toMatchObject(
      { detail: { code: "NOT_IN_INBOX" } },
    );
    const waiting = await add(e, DOI, {}, "agent:grok");
    await expect(
      e.call("items.merge", { from: waiting.citekey, into: b.citekey }, "agent:grok"),
    ).rejects.toMatchObject({ detail: { code: "MERGE_NOT_ALLOWED" } });
    await expect(
      e.call("items.merge", { from: waiting.citekey, into: waiting.citekey }),
    ).rejects.toMatchObject({ detail: { code: "MERGE_SAME_ITEM" } });
    expect(exists(e, waiting.citekey)).toBe(true);
  });
});

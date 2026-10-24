import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs } from "../test-helpers.js";
import { createTestEnv, type TestEnv } from "./testing.js";

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

const DOI = "10.1038/s41586-020-2649-2";

async function addDoi(e: TestEnv): Promise<string> {
  const out = await e.call<{ citekey: string; job: string }>("items.add", { identifier: DOI });
  await e.svc.queue.waitFor(out.job);
  return out.citekey;
}

type Resolved = { citekey: string; changed: string[] };

describe("items.resolve", () => {
  it("replaces fields from earlier lookups and keeps what a person edited", async () => {
    const e = await env();
    const citekey = await addDoi(e);
    const original = e.lib.getItem(citekey).frontmatter;
    expect(original["container-title"]).toBeTruthy();

    // A person sets the title; a background process (system) left a wrong journal behind.
    await e.call("items.update", { citekey, patch: { title: "My own title" } }, "human");
    await e.call(
      "items.update",
      { citekey, patch: { "container-title": "Wrong Journal" } },
      "system",
    );
    await e.call("items.update", { citekey, patch: { tags: ["keep-me"] } }, "human");

    const out = await e.call<Resolved>("items.resolve", { citekey }, "human");
    expect(out.citekey).toBe(citekey);
    expect(out.changed).toContain("container-title");
    expect(out.changed).not.toContain("title");

    const after = e.lib.getItem(citekey).frontmatter;
    expect(after.title).toBe("My own title");
    expect(after["container-title"]).toBe(original["container-title"]);
    expect(after.tags).toEqual(["keep-me"]);
    expect(after.provenance.title).toMatch(/^human@/);
    expect(after.provenance["container-title"]).toBe(original.provenance["container-title"]);
    expect(after.modified?.by).toBe("human");
  });

  it("changes nothing when the lookup agrees with the item", async () => {
    const e = await env();
    const citekey = await addDoi(e);
    const before = e.lib.getItem(citekey).frontmatter;
    const out = await e.call<Resolved>("items.resolve", { citekey });
    expect(out.changed).toEqual([]);
    expect(e.lib.getItem(citekey).frontmatter.modified).toEqual(before.modified);
  });

  it("fills a field that is missing", async () => {
    const e = await env();
    const citekey = await addDoi(e);
    await e.call("items.update", { citekey, patch: { "container-title": null } }, "system");
    const out = await e.call<Resolved>("items.resolve", { citekey }, "agent:test");
    expect(out.changed).toContain("container-title");
    expect(e.lib.getItem(citekey).frontmatter["container-title"]).toBeTruthy();
  });

  it("names what to do when the item has nothing to look up", async () => {
    const e = await env();
    const added = await e
      .call<{ citekey: string; job: string }>("items.add", {
        identifier: "@misc{nothing, author={Doe, Jane}, year={2001}}",
      })
      .catch((err: unknown) => err);
    // A BibTeX entry without a title is refused at the door; an entry with only a title has no
    // identifier, and the title lookup finds no confident match offline.
    expect(added).toBeInstanceOf(Error);
    const withTitle = await e.call<{ citekey: string; job: string }>("items.add", {
      identifier: "@misc{lonely, title={A Quite Unremarkable Note About Nothing}, year={2001}}",
    });
    await e.svc.queue.waitFor(withTitle.job);
    await expect(e.call("items.resolve", { citekey: withTitle.citekey })).rejects.toThrow(
      /no confident match|no metadata source answered/,
    );
  });

  it("reports an unknown citekey", async () => {
    const e = await env();
    await expect(e.call("items.resolve", { citekey: "nobody1999" })).rejects.toThrow(
      /ITEM_NOT_FOUND|no item/,
    );
  });
});

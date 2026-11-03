import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./ingest/testing.js";
import { cleanTmpDirs, itemData } from "./test-helpers.js";

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

const created = (day: string) => ({ at: `2026-10-${day}T10:00:00.000Z`, by: "human" });

async function env(): Promise<TestEnv> {
  const e = await createTestEnv();
  envs.push(e);
  await e.call("projects.create", { slug: "phd", title: "PhD", brief: "" });
  await e.call("projects.create", { slug: "side", title: "Side", brief: "" });
  const project = ["phd"];
  e.lib.writeItem(itemData("a1xx", { projects: project, created: created("01") }));
  e.lib.writeItem(itemData("b2xx", { projects: project, created: created("02") }));
  e.lib.writeItem(itemData("c3xx", { projects: project, created: created("03"), status: "read" }));
  e.lib.writeItem(itemData("d4xx", { projects: project, created: created("04") }));
  e.lib.writeItem(itemData("e5xx", { created: created("05") }));
  return e;
}

interface Reading {
  entries: { item: { citekey: string; status: string }; note?: string }[];
  total: number;
  read: number;
  next?: string;
}
const reading = async (e: TestEnv, slug = "phd") =>
  (await e.call("projects.reading", { slug })) as Reading;
const keys = (r: Reading) => r.entries.map((x) => x.item.citekey);
const projectFile = (e: TestEnv, slug = "phd") =>
  readFileSync(e.lib.paths.abs(`projects/${slug}/project.md`), "utf8");

describe("projects.reading", () => {
  it("lists the items by date added until an order is stored, with progress and next", async () => {
    const e = await env();
    const r = await reading(e);
    expect(keys(r)).toEqual(["a1xx", "b2xx", "c3xx", "d4xx"]);
    expect(r.total).toBe(4);
    expect(r.read).toBe(1);
    expect(r.next).toBe("a1xx");
  });

  it("moves an item and stores the whole order in the project file", async () => {
    const e = await env();
    const r = (await e.call("projects.moveReading", {
      slug: "phd",
      citekey: "d4xx",
      position: 1,
    })) as Reading;
    expect(keys(r)).toEqual(["a1xx", "d4xx", "b2xx", "c3xx"]);
    expect(keys(await reading(e))).toEqual(["a1xx", "d4xx", "b2xx", "c3xx"]);
    expect(projectFile(e)).toMatch(/reading:\n {2}- item: a1xx\n {2}- item: d4xx/);
    expect(
      await e.call("projects.moveReading", { slug: "phd", citekey: "a1xx", position: 99 }),
    ).toMatchObject({
      next: "d4xx",
    });
    expect(keys(await reading(e))).toEqual(["d4xx", "b2xx", "c3xx", "a1xx"]);
  });

  it("finds the next item that is not read in the stored order", async () => {
    const e = await env();
    await e.call("projects.moveReading", { slug: "phd", citekey: "c3xx", position: 0 });
    expect((await reading(e)).next).toBe("a1xx");
    await e.call("items.setStatus", { citekeys: ["a1xx", "b2xx", "d4xx"], status: "read" });
    const done = await reading(e);
    expect(done.read).toBe(4);
    expect(done.next).toBeUndefined();
  });

  it("keeps an item in several projects in an order of its own for each", async () => {
    const e = await env();
    await e.call("projects.addItems", { slug: "side", citekeys: ["a1xx", "b2xx"] });
    await e.call("projects.moveReading", { slug: "side", citekey: "b2xx", position: 0 });
    expect(keys(await reading(e, "side"))).toEqual(["b2xx", "a1xx"]);
    expect(keys(await reading(e))).toEqual(["a1xx", "b2xx", "c3xx", "d4xx"]);
  });

  it("ignores entries for items that left the project and puts new items last", async () => {
    const e = await env();
    await e.call("projects.moveReading", { slug: "phd", citekey: "d4xx", position: 0 });
    await e.call("projects.removeItems", { slug: "phd", citekeys: ["d4xx"] });
    expect(keys(await reading(e))).toEqual(["a1xx", "b2xx", "c3xx"]);
    await e.call("projects.addItems", { slug: "phd", citekeys: ["e5xx"] });
    expect(keys(await reading(e))).toEqual(["a1xx", "b2xx", "c3xx", "e5xx"]);
  });

  it("leaves items of the inbox out of the list", async () => {
    const e = await env();
    e.lib.writeItem(
      itemData("f6xx", {
        projects: ["phd"],
        inbox: { by: "agent:claude" },
      }),
    );
    expect(keys(await reading(e))).toEqual(["a1xx", "b2xx", "c3xx", "d4xx"]);
  });

  it("fails for an item that is not on the list", async () => {
    const e = await env();
    await expect(
      e.call("projects.moveReading", { slug: "phd", citekey: "e5xx", position: 0 }),
    ).rejects.toMatchObject({ detail: { code: "NOT_IN_READING_LIST" } });
    await expect(
      e.call("projects.setReadingNote", { slug: "phd", citekey: "e5xx", note: "x" }),
    ).rejects.toMatchObject({ detail: { code: "NOT_IN_READING_LIST" } });
    await expect(e.call("projects.reading", { slug: "nope" })).rejects.toMatchObject({
      detail: { code: "PROJECT_NOT_FOUND" },
    });
  });
});

describe("projects.setReadingNote", () => {
  it("sets a note on one line, keeps it when the item moves and clears it", async () => {
    const e = await env();
    const r = (await e.call("projects.setReadingNote", {
      slug: "phd",
      citekey: "b2xx",
      note: "  bridge\nto  a1xx ",
    })) as Reading;
    expect(r.entries.find((x) => x.item.citekey === "b2xx")?.note).toBe("bridge to a1xx");
    await e.call("projects.moveReading", { slug: "phd", citekey: "b2xx", position: 3 });
    const moved = await reading(e);
    expect(keys(moved)).toEqual(["a1xx", "c3xx", "d4xx", "b2xx"]);
    expect(moved.entries[3]?.note).toBe("bridge to a1xx");
    const cleared = (await e.call("projects.setReadingNote", {
      slug: "phd",
      citekey: "b2xx",
      note: "",
    })) as Reading;
    expect(cleared.entries[3]?.note).toBeUndefined();
    expect(projectFile(e)).not.toContain("note:");
  });
});

describe("projects.addItems with a position", () => {
  it("puts the new items at the position and the others stay where they were", async () => {
    const e = await env();
    await e.call("projects.moveReading", { slug: "phd", citekey: "d4xx", position: 0 });
    const out = await e.call("projects.addItems", {
      slug: "phd",
      citekeys: ["e5xx", "a1xx"],
      position: 1,
    });
    expect(out).toEqual({ added: ["e5xx"], unchanged: ["a1xx"] });
    expect(keys(await reading(e))).toEqual(["d4xx", "e5xx", "a1xx", "b2xx", "c3xx"]);
  });

  it("appends without a position and does not write an order", async () => {
    const e = await env();
    await e.call("projects.addItems", { slug: "phd", citekeys: ["e5xx"] });
    expect(keys(await reading(e))).toEqual(["a1xx", "b2xx", "c3xx", "d4xx", "e5xx"]);
    expect(projectFile(e)).toContain("reading: []");
  });
});

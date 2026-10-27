import { afterEach, describe, expect, it } from "vitest";
import { Library } from "./library.js";
import { createCoreRegistry } from "./ops.js";
import { cleanTmpDirs, itemData, tmpDir } from "./test-helpers.js";

// Library views show accepted items only. The inbox shows up on request, and for agents in
// search, always marked.

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup() {
  const lib = await Library.init(tmpDir("cg-inbox-views-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  open.push(lib);
  lib.createProject("human", { slug: "thesis", title: "Thesis", brief: "" });
  lib.writeItem(
    itemData("accepted2020", {
      title: "Systems of Communication",
      projects: ["thesis"],
      tags: ["theory"],
    }),
  );
  lib.writeItem(
    itemData("waiting2021", {
      title: "Communication Between Systems",
      projects: ["thesis"],
      tags: ["theory"],
      inbox: { by: "agent:grok", why: "cited by the thesis" },
    }),
  );
  lib.sync();
  const reg = createCoreRegistry(lib);
  const call = <T>(name: string, input: unknown, actor = "human"): Promise<T> =>
    reg.call(name, { actor: actor as never }, input) as Promise<T>;
  return { lib, call };
}

type List = { items: { citekey: string; inbox: boolean }[] };
type Hits = { hits: { id: string; kind: string; citekey?: string; inbox?: true }[] };

describe("library views leave the inbox out", () => {
  it("lists accepted items only, unless the caller asks for the inbox", async () => {
    const { call } = await setup();
    const keys = async (input: object) =>
      (await call<List>("items.list", input)).items.map((i) => i.citekey);
    expect(await keys({})).toEqual(["accepted2020"]);
    expect(await keys({ inbox: false })).toEqual(["accepted2020"]);
    expect(await keys({ inbox: true })).toEqual(["waiting2021"]);
    expect(await keys({ includeInbox: true })).toEqual(["accepted2020", "waiting2021"]);
    const both = await call<List>("items.list", { includeInbox: true });
    expect(both.items.map((i) => i.inbox)).toEqual([false, true]);
  });

  it("keeps the inbox out of project reading lists and tag filters", async () => {
    const { call } = await setup();
    const keys = async (input: object) =>
      (await call<List>("items.list", input)).items.map((i) => i.citekey);
    expect(await keys({ project: "thesis" })).toEqual(["accepted2020"]);
    expect(await keys({ project: "thesis", includeInbox: true })).toEqual([
      "accepted2020",
      "waiting2021",
    ]);
    expect(await keys({ tags: ["theory"] })).toEqual(["accepted2020"]);
  });

  it("leaves the inbox out of a person's search, and marks it for an agent", async () => {
    const { call } = await setup();
    const person = await call<Hits>("search.query", { q: "communication", kinds: ["item"] });
    expect(person.hits.map((h) => h.id)).toEqual(["accepted2020"]);
    expect(person.hits.every((h) => h.inbox === undefined)).toBe(true);

    const agent = await call<Hits>(
      "search.query",
      { q: "communication", kinds: ["item"] },
      "agent:grok",
    );
    expect(agent.hits.map((h) => h.id).sort()).toEqual(["accepted2020", "waiting2021"]);
    expect(agent.hits.find((h) => h.id === "waiting2021")?.inbox).toBe(true);
    expect(agent.hits.find((h) => h.id === "accepted2020")?.inbox).toBeUndefined();

    const asked = await call<Hits>("search.query", {
      q: "communication",
      kinds: ["item"],
      includeInbox: true,
    });
    expect(asked.hits.map((h) => h.id).sort()).toEqual(["accepted2020", "waiting2021"]);
    const hidden = await call<Hits>(
      "search.query",
      { q: "communication", kinds: ["item"], includeInbox: false },
      "agent:grok",
    );
    expect(hidden.hits.map((h) => h.id)).toEqual(["accepted2020"]);
  });

  it("keeps inbox items out of the project graph", async () => {
    const { call } = await setup();
    const graph = await call<{ nodes: { id: string }[] }>("graph.project", {
      project: "thesis",
    });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("accepted2020");
    expect(ids).not.toContain("waiting2021");
  });
});

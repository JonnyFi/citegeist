import { afterEach, describe, expect, it } from "vitest";
import { Library } from "./library.js";
import { createCoreRegistry } from "./ops.js";
import {
  cardData,
  cardFile,
  cleanTmpDirs,
  itemData,
  itemFile,
  noteData,
  noteFile,
  tmpDir,
  writeRaw,
} from "./test-helpers.js";

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

const AGENT = "agent:claude-desktop" as const;

async function setup() {
  const lib = await Library.init(tmpDir("cg-linked-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  open.push(lib);
  writeRaw(
    lib.root,
    "items/luhmann1984soziale/luhmann1984soziale.md",
    itemFile(itemData("luhmann1984soziale")),
  );
  writeRaw(
    lib.root,
    "items/lewis2020rag/lewis2020rag.md",
    itemFile(
      itemData("lewis2020rag", { author: [{ family: "Lewis", given: "Patrick" }], issued: 2020 }),
    ),
  );
  const card = cardData("luhmann1984soziale", "Soziale Systeme bestehen aus Kommunikationen.");
  writeRaw(lib.root, `items/luhmann1984soziale/cards/${card.fm.id}.md`, cardFile(card));
  const a = noteData("Autopoiesis");
  const b = noteData("Beobachtung");
  writeRaw(
    lib.root,
    "notes/autopoiesis.md",
    noteFile(a, "Siehe [[luhmann1984soziale]] und [[beobachtung]].\n"),
  );
  writeRaw(lib.root, "notes/beobachtung.md", noteFile(b, "Nichts.\n"));
  lib.sync();
  const registry = createCoreRegistry(lib);
  const call = (name: string, actor: "human" | typeof AGENT, input: unknown) =>
    // biome-ignore lint/suspicious/noExplicitAny: the tests read nested fields of many shapes
    registry.call(name, { actor }, input) as Promise<any>;
  return { lib, call, a, b, card };
}

describe("links.create", () => {
  it("writes a typed link into the note and stamps the caller", async () => {
    const { lib, call, b } = await setup();
    const note = await call("links.create", AGENT, {
      from: b.id,
      link: { to: "[[luhmann1984soziale]]", rel: "supports", why: "Primary source" },
    });
    expect(note.frontmatter.links).toHaveLength(1);
    expect(note.frontmatter.links[0]).toMatchObject({ rel: "supports", by: AGENT });
    expect(lib.getNote(b.id).frontmatter.links[0]?.by).toBe(AGENT);
  });

  it("returns the note unchanged when the same link exists", async () => {
    const { call, b } = await setup();
    const link = { to: "[[luhmann1984soziale]]", rel: "supports" };
    await call("links.create", AGENT, { from: b.id, link });
    const again = await call("links.create", "human", { from: b.id, link });
    expect(again.frontmatter.links).toHaveLength(1);
  });

  it("refuses a target that does not exist and writes nothing", async () => {
    const { lib, call, b } = await setup();
    const err = await call("links.create", AGENT, {
      from: b.id,
      link: { to: "[[nowhere9999]]", rel: "related" },
    }).catch((e: unknown) => e as { detail: { code: string } });
    expect(err.detail.code).toBe("LINK_TARGET_NOT_FOUND");
    expect(lib.getNote(b.id).frontmatter.links).toHaveLength(0);
  });
});

describe("cite.format", () => {
  it("formats a citation with a locator from the library defaults", async () => {
    const { call } = await setup();
    const out = await call("cite.format", "human", {
      items: [{ citekey: "luhmann1984soziale", locator: "31" }],
    });
    expect(out.text).toContain("Luhmann");
    expect(out.text).toContain("31");
  });

  it("builds a pandoc cluster and a bibliography", async () => {
    const { call } = await setup();
    const pandoc = await call("cite.format", "human", {
      items: [{ citekey: "luhmann1984soziale", locator: "31" }, { citekey: "lewis2020rag" }],
      format: "pandoc",
    });
    expect(pandoc.text).toMatch(/^\[.*@luhmann1984soziale.*; @lewis2020rag\]$/);
    const bib = await call("cite.format", "human", {
      items: [{ citekey: "luhmann1984soziale" }, { citekey: "lewis2020rag" }],
      mode: "bibliography",
    });
    expect(bib.text).toContain("Lewis");
    expect(bib.text).toContain("Luhmann");
  });

  it("names the missing item", async () => {
    const { call } = await setup();
    const err = await call("cite.format", "human", {
      items: [{ citekey: "missing2000x" }],
    }).catch((e: unknown) => e as { detail: { code: string } });
    expect(err.detail.code).toBe("CITE_UNKNOWN_ITEM");
  });
});

describe("graph.neighbors", () => {
  it("returns the wiki links of a note in both directions", async () => {
    const { call, a, b } = await setup();
    const out = await call("graph.neighbors", "human", { node: b.id });
    expect(out.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(out.edges).toEqual([{ from: a.id, to: b.id, rel: "mentions", status: "accepted" }]);
  });

  it("walks to the next level and filters by relation", async () => {
    const { call, a, b, card } = await setup();
    const shallow = await call("graph.neighbors", "human", { node: b.id, depth: 1 });
    expect(shallow.nodes.map((n: { id: string }) => n.id)).not.toContain("luhmann1984soziale");
    const deep = await call("graph.neighbors", "human", { node: b.id, depth: 2 });
    const ids = deep.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain("luhmann1984soziale");
    expect(ids).not.toContain(card.fm.id);
    const three = await call("graph.neighbors", "human", { node: b.id, depth: 3 });
    expect(three.nodes.map((n: { id: string }) => n.id)).toContain(card.fm.id);
    expect(three.edges.some((e: { rel: string }) => e.rel === "excerpt-of")).toBe(true);

    await call("links.create", AGENT, {
      from: a.id,
      link: { to: "[[lewis2020rag]]", rel: "opposes" },
    });
    const typed = await call("graph.neighbors", "human", { node: a.id, rel: ["opposes"] });
    expect(typed.edges).toEqual([
      { from: a.id, to: "lewis2020rag", rel: "opposes", status: "accepted" },
    ]);
  });

  it("answers an unknown node with an empty graph", async () => {
    const { call } = await setup();
    expect(await call("graph.neighbors", "human", { node: "nothing" })).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

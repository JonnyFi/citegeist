import { describe, expect, it } from "vitest";
import type { SemanticLink, SemanticNode } from "./contracts/index.js";
import { aggregateGraph, noteExcerpt } from "./project-graph.js";

const nodes: SemanticNode[] = [
  { id: "a", kind: "item", label: "A", cards: 2 },
  { id: "b", kind: "item", label: "B", cards: 0 },
  { id: "c", kind: "item", label: "C", cards: 0 },
  { id: "n", kind: "note", label: "Note", noteType: "permanent" },
  { id: "c_1", kind: "card", label: "one", item: "a", cardKind: "critique" },
  { id: "c_2", kind: "card", label: "two", item: "a", cardKind: "thesis" },
];
const link = (from: string, to: string, rel: string, evidence: string[] = []): SemanticLink => ({
  id: `${from}>${to}:${rel}`,
  from,
  to,
  rel,
  status: "accepted",
  evidence,
  notes: [],
});
const links = [
  link("c_1", "b", "opposes", ["c_1"]),
  link("c_2", "b", "opposes", ["c_2"]),
  link("c_2", "c", "supports", ["c_2"]),
  link("n", "a", "mentions"),
];

describe("aggregateGraph", () => {
  it("folds cards into their source and keeps every source and note", () => {
    const view = aggregateGraph({ nodes, links });
    expect(view.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "n"]);
    const opposes = view.edges.find((e) => e.rel === "opposes");
    expect(opposes).toMatchObject({ from: "a", to: "b", evidence: ["c_1", "c_2"] });
    expect(opposes?.links).toHaveLength(2);
    expect(view.members).toEqual([]);
  });

  it("shows the cards of an expanded source with their own edges", () => {
    const view = aggregateGraph({ nodes, links }, { expanded: ["a"] });
    expect(view.edges.filter((e) => e.to === "b").map((e) => e.from)).toEqual(["c_1", "c_2"]);
    expect(view.members).toEqual([
      { card: "c_1", item: "a" },
      { card: "c_2", item: "a" },
    ]);
  });

  it("filters by relation and drops the nodes that lose every edge", () => {
    const view = aggregateGraph({ nodes, links }, { relations: new Set(["supports"]) });
    expect(view.edges.map((e) => e.id)).toEqual(["a>c:supports"]);
    expect(view.nodes.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("filters by card kind through the evidence and keeps links without cards", () => {
    const view = aggregateGraph({ nodes, links }, { kinds: new Set(["critique"]) });
    expect(view.edges.map((e) => e.id).sort()).toEqual(["a>b:opposes", "n>a:mentions"]);
    expect(view.edges.find((e) => e.rel === "opposes")?.evidence).toEqual(["c_1"]);
  });
});

describe("noteExcerpt", () => {
  it("drops headings, embeds and wiki brackets", () => {
    expect(noteExcerpt("# Title\n\nSee [[luhmann|Luhmann]] and [[habermas]].\n![[c_1]]\n")).toBe(
      "See Luhmann and habermas.",
    );
  });
});

import type { NumberedNode } from "@citegeist/ops";
import { describe, expect, it } from "vitest";
import {
  findGaps,
  insightText,
  linkTargets,
  nodesOfInsight,
  parseInsights,
  placeOf,
} from "./insights";

const node = (id: string, number: string, parent: string | null, doc?: string): NumberedNode => ({
  id,
  title: `Titel ${number}`,
  parent,
  order: 1,
  status: "idea",
  questions: [],
  number,
  depth: number.split(".").length - 1,
  ...(doc ? { doc } : {}),
});

const NODES = [
  node("k_01JC2C9KQ1", "1", null, "plans/p/nodes/eins.md"),
  node("k_01JC2C9KQ2", "1.1", "k_01JC2C9KQ1"),
  node("k_01JC2C9KQ3", "2", null, "plans/p/nodes/zwei.md"),
];

describe("parseInsights", () => {
  it("finds the paragraphs that end in a block id and cuts date and id off", () => {
    const body =
      "Fließtext ohne Block-ID.\n\n2026-10-18: Erste [[luhmann1984soziale]] Einsicht. ^i-01JC5Q2M9A\n\nEine undatierte. ^i-01JC5Q2MAB\n";
    expect(parseInsights(body)).toEqual([
      {
        block: "i-01JC5Q2M9A",
        date: "2026-10-18",
        text: "Erste [[luhmann1984soziale]] Einsicht.",
      },
      { block: "i-01JC5Q2MAB", text: "Eine undatierte." },
    ]);
  });

  it("shows a hit without its date and block id", () => {
    expect(insightText({ text: "2026-10-18: Text hier. ^i-01JC5Q2M9A" })).toBe("Text hier.");
  });
});

describe("where an insight belongs", () => {
  it("names the node whose document holds it, the plan or the project file", () => {
    expect(placeOf("plans/p/nodes/zwei.md", NODES)).toEqual({ kind: "node", node: NODES[2] });
    expect(placeOf("projects/x/plans/p/plan.md", NODES)).toEqual({ kind: "plan" });
    expect(placeOf("projects/x/insights.md", NODES)).toEqual({ kind: "project" });
  });

  it("adds the nodes the text links", () => {
    const about = nodesOfInsight(
      {
        path: "plans/p/nodes/eins.md",
        text: "Siehe [[k_01JC2C9KQ3]] und [[luhmann1984soziale]].",
      },
      NODES,
    );
    expect(about.map((n) => n.number)).toEqual(["1", "2"]);
  });

  it("lists link targets once", () => {
    expect(linkTargets("[[a]] und [[a|Alias]] und [[b#kopf]]")).toEqual(["a", "b"]);
  });
});

describe("findGaps", () => {
  const citekeys = new Set(["luhmann1984soziale"]);

  it("marks nodes without a source or without an insight", () => {
    const gaps = findGaps({
      nodes: NODES,
      docs: new Map([["k_01JC2C9KQ1", "Quelle: [[luhmann1984soziale]]"]]),
      hits: [{ path: "plans/p/nodes/zwei.md", text: "Einsicht ohne Link ^i-01JC5Q2M9A" }],
      citekeys,
    });
    expect(gaps.map((g) => [g.node.number, g.noSources, g.noInsights])).toEqual([
      ["1", false, true],
      ["1.1", true, true],
      ["2", true, false],
    ]);
  });

  it("counts the sections of a chapter for the chapter", () => {
    const nodes = [
      NODES[0] as NumberedNode,
      { ...(NODES[1] as NumberedNode), doc: "plans/p/nodes/x.md" },
    ];
    const gaps = findGaps({
      nodes,
      docs: new Map([["k_01JC2C9KQ2", "[[luhmann1984soziale]]"]]),
      hits: [{ path: "plans/p/nodes/x.md", text: "Abschnittseinsicht ^i-01JC5Q2M9A" }],
      citekeys,
    });
    expect(gaps).toEqual([]);
  });

  it("treats a link to a note or card as no source", () => {
    const gaps = findGaps({
      nodes: [NODES[0] as NumberedNode],
      docs: new Map([
        ["k_01JC2C9KQ1", "Nur eine Notiz: [[zettel]] und eine Karte [[c_01JB8Z3Q00]]"],
      ]),
      hits: [{ path: "plans/p/nodes/eins.md", text: "Einsicht ^i-01JC5Q2M9A" }],
      citekeys,
    });
    expect(gaps.map((g) => [g.noSources, g.noInsights])).toEqual([[true, false]]);
  });
});

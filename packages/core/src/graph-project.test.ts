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

const ACCELERATE = "williams2013accelerate";
const LAND = "land2012dark";
const FISHER = "fisher2009capitalist";
const KUHN = "kuhn1962structure";
const AGENT = "agent:claude-code";

interface Graph {
  nodes: Array<{ id: string; kind: string; outside?: boolean; cards?: number; short?: string }>;
  links: Array<{
    id: string;
    from: string;
    to: string;
    rel: string;
    evidence: string[];
    notes: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    rel: string;
    status: string;
    links: string[];
    evidence: string[];
    notes: string[];
  }>;
  explanations: Array<{ id: string; title: string; excerpt: string; absorbed: boolean }>;
}

/**
 * The situation from real use: a critique card of the manifesto opposes Land, the link lives in
 * the literature note of the manifesto, and an agent wrote a note that explains the connection.
 */
async function setup() {
  const root = tmpDir("cg-graph-project-");
  const lib = await Library.init(root, { watch: false, localBase: tmpDir("cg-local-") });
  open.push(lib);
  lib.createProject("human", { slug: "thesis", title: "Thesis", brief: "" });
  const item = (citekey: string, title: string, family: string, year: number, projects: string[]) =>
    writeRaw(
      root,
      `items/${citekey}/${citekey}.md`,
      itemFile(itemData(citekey, { title, author: [{ family }], issued: year, projects })),
    );
  item(ACCELERATE, "#Accelerate: Manifesto for an Accelerationist Politics", "Williams", 2013, [
    "thesis",
  ]);
  item(FISHER, "Capitalist Realism", "Fisher", 2009, ["thesis"]);
  item(LAND, "The Dark Enlightenment", "Land", 2012, []);
  item(KUHN, "The Structure of Scientific Revolutions", "Kuhn", 1962, []);

  const card = (citekey: string, quote: string, kind: string) => {
    const c = cardData(citekey, quote, { kind, locator: { start: "3" } });
    writeRaw(root, `items/${citekey}/cards/${c.fm.id}.md`, cardFile(c));
    return c.fm.id;
  };
  const critique = card(
    ACCELERATE,
    "The philosopher Nick Land captured this most acutely, in his belief that capitalist speed alone could generate a global transition.",
    "critique",
  );
  const second = card(ACCELERATE, "Land confuses speed with acceleration.", "thesis");
  const plain = card(
    ACCELERATE,
    "We want to accelerate the process of technological evolution.",
    "thesis",
  );
  const realism = card(
    FISHER,
    "It is easier to imagine the end of the world than the end of capitalism.",
    "finding",
  );

  const explainer = noteData("Manifest gegen Land", {
    created: { at: "2026-10-20T10:00:00.000Z", by: AGENT },
  });
  const synthesis = noteData("Beschleunigung als Begriff", {
    projects: ["thesis"],
    links: [{ to: `[[${LAND}]]`, rel: "related", by: AGENT, status: "proposed" }],
  });
  const reading = noteData(`Reading notes (${ACCELERATE})`, {
    type: "literature",
    projects: ["thesis"],
    links: [
      {
        from: critique,
        to: `[[${LAND}]]`,
        rel: "opposes",
        why: "The manifesto turns against Land's faith in speed.",
        evidence: `[[${critique}]]`,
        by: AGENT,
      },
      {
        from: second,
        to: `[[${LAND}]]`,
        rel: "opposes",
        evidence: `[[${second}]]`,
        by: "human",
      },
      {
        from: plain,
        to: `[[${FISHER}]]`,
        rel: "supports",
        why: "See [[beschleunigung-als-begriff]].",
        evidence: `[[${plain}]]`,
        by: "human",
      },
    ],
  });
  writeRaw(root, "notes/reading-notes.md", noteFile(reading, `Item: [[${ACCELERATE}]]\n`));
  writeRaw(
    root,
    "notes/manifest-gegen-land.md",
    noteFile(
      explainer,
      `# Manifest gegen Land\n\nDas Manifest ([[${ACCELERATE}]]) widerspricht [[${LAND}]]: Geschwindigkeit ist keine Richtung.\n`,
    ),
  );
  writeRaw(
    root,
    "notes/beschleunigung-als-begriff.md",
    noteFile(synthesis, `Bei [[${ACCELERATE}]] und [[${FISHER}]], vgl. [[${KUHN}]].\n`),
  );
  writeRaw(
    root,
    "projects/thesis/texts/kapitel-1.md",
    `---\ntitle: Kapitel 1\n---\n\nDas Manifest [@${ACCELERATE}, S. 3] antwortet auf Land [@${LAND}].\n`,
  );
  lib.sync();
  const registry = createCoreRegistry(lib);
  const call = (input: Record<string, unknown>) =>
    registry.call("graph.project", { actor: "human" }, input) as Promise<Graph>;
  return { call, critique, second, plain, realism, explainer, synthesis, reading };
}

describe("graph.project", () => {
  it("leaves literature notes out and starts their links at the card", async () => {
    const { call, critique, reading } = await setup();
    const g = await call({ project: "thesis" });
    expect(g.nodes.some((n) => n.id === reading.id)).toBe(false);
    const opposes = g.links.find((l) => l.from === critique);
    expect(opposes).toMatchObject({ to: LAND, rel: "opposes", evidence: [critique] });
  });

  it("shows the project's sources sized by cards and marks ends outside the project", async () => {
    const { call } = await setup();
    const g = await call({ project: "thesis" });
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(node(ACCELERATE)).toMatchObject({ kind: "item", cards: 3, short: "Williams 2013" });
    expect(node(FISHER)?.outside).toBeUndefined();
    expect(node(LAND)).toMatchObject({ kind: "item", outside: true });
  });

  it("aggregates card links into one edge between sources with every evidence card", async () => {
    const { call, critique, second } = await setup();
    const g = await call({ project: "thesis" });
    const edge = g.edges.find((e) => e.from === ACCELERATE && e.to === LAND);
    expect(edge).toMatchObject({ rel: "opposes", status: "accepted" });
    expect(edge?.links).toHaveLength(2);
    expect(edge?.evidence.sort()).toEqual([critique, second].sort());
    expect(g.edges.filter((e) => e.from === ACCELERATE && e.to === FISHER)).toHaveLength(1);
  });

  it("attaches the edges to the cards of an expanded source", async () => {
    const { call, critique, second } = await setup();
    const g = await call({ project: "thesis", expand: [ACCELERATE] });
    const toLand = g.edges.filter((e) => e.to === LAND).map((e) => e.from);
    expect(toLand.sort()).toEqual([critique, second].sort());
  });

  it("puts the note that explains a connection on the link instead of making it a node", async () => {
    const { call, critique, second, explainer } = await setup();
    const g = await call({ project: "thesis" });
    expect(g.nodes.some((n) => n.id === explainer.id)).toBe(false);
    for (const card of [critique, second]) {
      expect(g.links.find((l) => l.from === card)?.notes).toEqual([explainer.id]);
    }
    expect(g.edges.find((e) => e.to === LAND)?.notes).toEqual([explainer.id]);
    expect(g.explanations.find((x) => x.id === explainer.id)).toMatchObject({
      title: "Manifest gegen Land",
      absorbed: true,
    });
    expect(g.explanations.find((x) => x.id === explainer.id)?.excerpt).toMatch(
      /^Das Manifest \(williams2013accelerate\) widerspricht land2012dark/,
    );
  });

  it("keeps a note with a thought of its own as a node and still names it as explanation", async () => {
    const { call, plain, synthesis } = await setup();
    const g = await call({ project: "thesis" });
    expect(g.nodes.find((n) => n.id === synthesis.id)?.kind).toBe("note");
    // the link's why names the note, and the note reaches Kuhn beyond the two ends
    expect(g.links.find((l) => l.from === plain)?.notes).toEqual([synthesis.id]);
    expect(g.explanations.find((x) => x.id === synthesis.id)?.absorbed).toBe(false);
    expect(g.links.some((l) => l.from === synthesis.id && l.to === KUHN)).toBe(true);
  });

  it("keeps only the sources a text cites", async () => {
    const { call, synthesis } = await setup();
    const g = await call({ project: "thesis", text: "kapitel-1" });
    const items = g.nodes.filter((n) => n.kind === "item").map((n) => n.id);
    expect(items.sort()).toEqual([ACCELERATE, LAND].sort());
    expect(g.nodes.find((n) => n.id === LAND)?.outside).toBeUndefined();
    // the note on the manifesto stays with its link to a cited source, the one to Fisher goes
    expect(g.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(
      [`${ACCELERATE}>${LAND}`, `${synthesis.id}>${ACCELERATE}`].sort(),
    );
  });

  it("names a missing text", async () => {
    const { call } = await setup();
    const err = await call({ project: "thesis", text: "kapitel-9" }).catch(
      (e: unknown) => e as { detail: { code: string } },
    );
    expect(err.detail.code).toBe("TEXT_NOT_FOUND");
  });

  it("shows the library when no project is given", async () => {
    const { call } = await setup();
    const g = await call({});
    expect(g.nodes.find((n) => n.id === LAND)?.outside).toBeUndefined();
    expect(g.nodes.find((n) => n.id === KUHN)).toBeDefined();
  });

  it("shows what lies around one node, a source and its cards counting as one step", async () => {
    const { call, critique } = await setup();
    const one = await call({ around: LAND, depth: 1 });
    const items = (g: Graph) =>
      g.nodes
        .filter((n) => n.kind === "item")
        .map((n) => n.id)
        .sort();
    expect(items(one)).toEqual([ACCELERATE, LAND].sort());
    expect(one.nodes.some((n) => n.id === critique)).toBe(true);
    const fromCard = await call({ around: critique, depth: 1 });
    expect(items(fromCard)).toEqual([ACCELERATE, FISHER, LAND].sort());
    // the second step goes through the note on Fisher and the manifesto to Kuhn
    const two = await call({ around: critique, depth: 2 });
    expect(items(two)).toEqual([ACCELERATE, FISHER, KUHN, LAND].sort());
  });

  it("leaves proposals out unless asked for", async () => {
    const { call, synthesis } = await setup();
    const proposal = (g: Graph) => g.links.find((l) => l.from === synthesis.id && l.to === LAND);
    expect(proposal(await call({ project: "thesis" }))).toBeUndefined();
    const all = await call({ project: "thesis", proposed: true });
    expect(proposal(all)).toMatchObject({ rel: "related", status: "proposed" });
  });
});

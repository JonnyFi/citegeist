import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Registry } from "@citegeist/ops";
import type { Outline } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../hash.js";
import { Library } from "../library.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { bindPlanningOperations } from "./ops.js";
import { applyOps, numbered, parseOutline, serializeOutline } from "./outline.js";
import { splitParagraphs } from "./paragraphs.js";
import { PlanningService } from "./service.js";
import { TEMPLATES } from "./templates.js";

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup(template: "expose" | "imrad" | undefined = "expose") {
  const lib = await Library.init(tmpDir("cg-plan-"), {
    name: "Test",
    localBase: tmpDir("cg-local-"),
    watch: false,
  });
  open.push(lib);
  lib.createProject("human", { slug: "phd", title: "PhD proposal", brief: "Brief" });
  const registry = new Registry();
  const service = bindPlanningOperations(registry, lib, { now: () => new Date(2026, 10, 12, 9) });
  const call = <T>(name: string, input: unknown, actor = "agent:test") =>
    registry.call(name, { actor: actor as "human" }, input) as Promise<T>;
  await call("plans.create", { project: "phd", slug: "proposal", title: "Proposal", template });
  return { lib, service, call };
}

const read = (lib: Library, rel: string) => readFileSync(join(lib.root, rel), "utf8");

interface Node {
  id: string;
  title: string;
  number: string;
  parent: string | null;
  doc?: string;
}
const byTitle = (nodes: Node[], title: string) => {
  const n = nodes.find((x) => x.title === title);
  if (!n) throw new Error(`no node ${title}`);
  return n;
};

describe("numbering", () => {
  const base = parseOutline(`nodes:
  - { id: k_AAAAAAAAAA, title: One, parent: null, order: 1, status: idea }
  - { id: k_BBBBBBBBBB, title: Two, parent: null, order: 2, status: idea }
  - { id: k_BBBBBBBB01, title: Two one, parent: k_BBBBBBBBBB, order: 1, status: idea }
  - { id: k_BBBBBBBB02, title: Two two, parent: k_BBBBBBBBBB, order: 2, status: idea }
`);
  const ids = (o: Outline) => numbered(o).map((n) => `${n.number}:${n.id}`);

  it("computes numbers from parent and order", () => {
    expect(ids(base)).toEqual([
      "1:k_AAAAAAAAAA",
      "2:k_BBBBBBBBBB",
      "2.1:k_BBBBBBBB01",
      "2.2:k_BBBBBBBB02",
    ]);
  });

  it("renumbers after a move and keeps the ids", () => {
    const moved = applyOps(base, [
      { op: "move", id: "k_BBBBBBBB02", parent: "k_AAAAAAAAAA", position: 1 },
    ]).outline;
    expect(ids(moved)).toEqual([
      "1:k_AAAAAAAAAA",
      "1.1:k_BBBBBBBB02",
      "2:k_BBBBBBBBBB",
      "2.1:k_BBBBBBBB01",
    ]);
    const reordered = applyOps(base, [
      { op: "move", id: "k_BBBBBBBBBB", parent: null, position: 1 },
    ]).outline;
    expect(ids(reordered)).toEqual([
      "1:k_BBBBBBBBBB",
      "1.1:k_BBBBBBBB01",
      "1.2:k_BBBBBBBB02",
      "2:k_AAAAAAAAAA",
    ]);
  });

  it("inserts at a position and closes gaps after remove", () => {
    const added = applyOps(
      base,
      [{ op: "add", parent: "k_BBBBBBBBBB", position: 1, title: "New", status: "idea" }],
      () => "k_NNNNNNNNNN",
    );
    expect(ids(added.outline)).toEqual([
      "1:k_AAAAAAAAAA",
      "2:k_BBBBBBBBBB",
      "2.1:k_NNNNNNNNNN",
      "2.2:k_BBBBBBBB01",
      "2.3:k_BBBBBBBB02",
    ]);
    const removed = applyOps(added.outline, [{ op: "remove", id: "k_BBBBBBBB01" }]).outline;
    expect(ids(removed)).toEqual([
      "1:k_AAAAAAAAAA",
      "2:k_BBBBBBBBBB",
      "2.1:k_NNNNNNNNNN",
      "2.2:k_BBBBBBBB02",
    ]);
    expect(removed.nodes.map((n) => n.order).sort()).toEqual([1, 1, 2, 2]);
  });

  it("refuses to move a node below itself and leaves the outline unchanged", () => {
    expect(() =>
      applyOps(base, [{ op: "move", id: "k_BBBBBBBBBB", parent: "k_BBBBBBBB01" }]),
    ).toThrow(/below itself/);
    expect(() =>
      applyOps(base, [
        { op: "update", id: "k_AAAAAAAAAA", title: "Changed" },
        { op: "update", id: "k_MMMMMMMMMM", title: "x" },
      ]),
    ).toThrow(/no outline node/);
    expect(base.nodes[0]?.title).toBe("One");
  });

  it("round-trips outline.yaml without loss", () => {
    const outline = parseOutline(`nodes:
  - { id: k_AAAAAAAAAA, title: "One: with colon", parent: null, order: 1, purpose: Why., status: draft, questions: [q1] }
  - { id: k_BBBBBBBBBB, title: Two, parent: k_AAAAAAAAAA, order: 1, status: idea }
`);
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);
    expect(serializeOutline(outline)).toContain("{ id: k_AAAAAAAAAA,");
  });
});

describe("templates", () => {
  it("fill a plan with nodes, purposes and a document per chapter", async () => {
    for (const template of ["expose", "imrad"] as const) {
      const { lib, call } = await setup(template);
      const out = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
      const chapters = TEMPLATES[template].nodes.length;
      expect(out.nodes.filter((n) => n.parent === null)).toHaveLength(chapters);
      expect(out.nodes.filter((n) => n.parent === null).every((n) => n.doc)).toBe(true);
      expect(out.nodes[0]?.number).toBe("1");
      const doc = read(lib, out.nodes[0]?.doc ?? "");
      expect(doc).toContain(`node: ${out.nodes[0]?.id}`);
      expect(doc).toContain(`aliases:`);
      expect(read(lib, "projects/phd/plans/proposal/plan.md")).toContain(`template: ${template}`);
    }
  });

  it("allow several plans per project and need a plan slug then", async () => {
    const { call } = await setup("expose");
    await call("plans.create", {
      project: "phd",
      slug: "paper",
      title: "Paper",
      template: "imrad",
    });
    const list = await call<{ plans: Array<{ plan: string; template?: string }> }>("plans.list", {
      project: "phd",
    });
    expect(list.plans.map((p) => `${p.plan}:${p.template}`)).toEqual([
      "paper:imrad",
      "proposal:expose",
    ]);
    await expect(call("outline.get", { project: "phd" })).rejects.toThrow(/several plans/);
    const paper = await call<{ nodes: Node[] }>("outline.get", { project: "phd", plan: "paper" });
    expect(paper.nodes.map((n) => n.title)).toContain("Methods");
  });
});

describe("outline.apply", () => {
  it("adds a subsection under chapter 4 as 4.x and keeps links valid after a move", async () => {
    const { call } = await setup("expose");
    const first = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const methods = byTitle(first.nodes, "Methodisches Vorgehen");
    const out = await call<{ added: string[]; nodes: Node[] }>("outline.apply", {
      project: "phd",
      ops: [{ op: "add", parent: methods.id, title: "Ethik", purpose: "Klärt Zustimmung." }],
    });
    const added = out.nodes.find((n) => n.id === out.added[0]);
    expect(added?.number).toBe(`${methods.number}.3`);
    const moved = await call<{ nodes: Node[] }>("outline.apply", {
      project: "phd",
      ops: [{ op: "move", id: methods.id, parent: null, position: 1 }],
    });
    expect(moved.nodes.find((n) => n.id === methods.id)?.number).toBe("1");
    expect(moved.nodes.find((n) => n.id === out.added[0])?.number).toBe("1.3");
  });

  it("asks for force before removing a node with text or incoming links", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const zeit = byTitle(nodes, "Zeitplan");
    await call("insights.note", {
      project: "phd",
      target: zeit.id,
      text: "Plan steht [[smith2020]].",
    });
    await expect(
      call("outline.apply", { project: "phd", ops: [{ op: "remove", id: zeit.id }] }),
    ).rejects.toThrow(/orphan text/);
    await call("outline.apply", {
      project: "phd",
      ops: [{ op: "remove", id: zeit.id }],
      force: true,
    });
    const after = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    expect(after.nodes.find((n) => n.id === zeit.id)).toBeUndefined();
    expect(existsSync(join(lib.root, zeit.doc ?? ""))).toBe(true);
    // an untouched empty chapter goes without force and takes its empty document along
    const stub = byTitle(nodes, "Vorläufige Gliederung");
    await call("outline.apply", { project: "phd", ops: [{ op: "remove", id: stub.id }] });
    expect(existsSync(join(lib.root, stub.doc ?? ""))).toBe(false);
  });
});

describe("note_insight placement", () => {
  it("writes a dated paragraph with a block id into the chapter document", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const chapter = byTitle(nodes, "Theoretischer Rahmen");
    const out = await call<{
      path: string;
      block: string;
      place: string;
      number: string;
      summary: string;
    }>("insights.note", {
      project: "phd",
      target: chapter.id,
      text: "A und B beschreiben denselben Mechanismus, siehe [[luhmann1984soziale]].",
    });
    expect(out.place).toBe("node");
    expect(out.path).toBe(chapter.doc);
    expect(out.number).toBe(chapter.number);
    expect(out.summary).toBe(`Noted in ${chapter.number}, Theoretischer Rahmen.`);
    const text = read(lib, out.path);
    expect(text).toMatch(
      new RegExp(
        `2026-11-12: A und B beschreiben .*\\[\\[luhmann1984soziale\\]\\]\\. \\^${out.block}\\n$`,
      ),
    );
    expect(text).toContain(`node: ${chapter.id}`);
    expect(splitParagraphs(text.split("---\n").slice(2).join("---\n")).at(-1)?.block).toBe(
      out.block,
    );
  });

  it("puts a section without a document into its chapter and links the section", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const section = byTitle(nodes, "Relevanz");
    const chapter = nodes.find((n) => n.id === section.parent);
    const out = await call<{ path: string; number: string }>("insights.note", {
      project: "phd",
      target: section.number,
      text: "Das betrifft die Praxis.",
    });
    expect(out.path).toBe(chapter?.doc);
    expect(out.number).toBe(section.number);
    expect(read(lib, out.path)).toContain(`Das betrifft die Praxis. [[${section.id}]] ^i-`);
  });

  it("writes into the planning document and into insights.md", async () => {
    const { lib, call } = await setup("expose");
    const plan = await call<{ path: string }>("insights.note", {
      project: "phd",
      target: "plan",
      text: "Mehrere\n\nKapitel berührt.",
    });
    expect(plan.path).toBe("projects/phd/plans/proposal/plan.md");
    expect(read(lib, plan.path)).toMatch(
      /title: Proposal[\s\S]*2026-11-12: Mehrere Kapitel berührt\. \^i-/,
    );
    const first = await call<{ path: string }>("insights.note", {
      project: "phd",
      target: "project",
      text: "Lose Idee.",
    });
    await call("insights.note", { project: "phd", target: "project", text: "Zweite Idee." });
    expect(first.path).toBe("projects/phd/insights.md");
    const file = read(lib, first.path);
    expect(file.startsWith("# Einsichten\n")).toBe(true);
    expect(file.match(/^2026-11-12: /gm)).toHaveLength(2);
  });
});

describe("find_insights", () => {
  async function filled() {
    const ctx = await setup("expose");
    const { nodes } = await ctx.call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const chapter = byTitle(nodes, "Theoretischer Rahmen");
    const note = (target: string, text: string, plan = "proposal") =>
      ctx.call<{ block: string }>("insights.note", { project: "phd", plan, target, text });
    // hand-written source list in the chapter document, so [[luhmann1984soziale]] belongs to it
    await ctx.call("plan.docs.update", {
      project: "phd",
      doc: chapter.id,
      body: "# Theoretischer Rahmen\n\nStützt sich auf [[luhmann1984soziale]] und [[c_01JB8Z3Q]].",
    });
    return { ...ctx, nodes, chapter, note };
  }

  it("ranks link hits before text hits, by shared links and then date", async () => {
    const { service, chapter, note, nodes } = await filled();
    const zeit = byTitle(nodes, "Zeitplan");
    const two = await note(
      zeit.id,
      "Vergleiche [[luhmann1984soziale]] und [[c_01JB8Z3Q]] für den Zeitplan.",
    );
    const one = await note("project", "Nur [[luhmann1984soziale]] ist hier relevant.");
    const direct = await note("project", `Betrifft direkt [[${chapter.id}]].`);
    const text = await note(
      "project",
      "Der Rahmen der Kommunikation braucht eine theoretische Grundlage.",
    );
    await note("project", "Ganz anderes Thema ohne Bezug zur Gliederung.");

    const { hits } = await service.findInsights({ project: "phd", node: chapter.id, limit: 10 });
    const blocks = hits.map((h) => h.block);
    // the two-link paragraph and the document paragraph share two links, then the one-link ones
    expect(hits.slice(0, 2).map((h) => h.score)).toEqual([2, 2]);
    expect(blocks.indexOf(two.block)).toBeLessThan(blocks.indexOf(one.block));
    expect(blocks.indexOf(one.block)).toBeLessThan(blocks.indexOf(text.block));
    expect(blocks.indexOf(direct.block)).toBeLessThan(blocks.indexOf(text.block));
    const stages = hits.map((h) => h.stage);
    expect(stages.indexOf("semantic")).toBeGreaterThan(stages.lastIndexOf("links"));
    expect(hits.find((h) => h.block === text.block)?.stage).toBe("semantic");
    expect(hits.find((h) => h.block === two.block)?.why).toContain("shares 2 links");
    expect(hits.some((h) => h.text.startsWith("Ganz anderes"))).toBe(false);
  });

  it("sorts equal link counts by date, newest first", async () => {
    const { lib, service, chapter } = await filled();
    const file = "projects/phd/insights.md";
    lib.writeFile(
      file,
      "# Einsichten\n\n2026-01-05: Alt [[luhmann1984soziale]]. ^i-AAAAAAAAAA\n\n2026-09-01: Neu [[luhmann1984soziale]]. ^i-BBBBBBBBBB\n",
    );
    const { hits } = await service.findInsights({ project: "phd", node: chapter.id, limit: 10 });
    const own = hits.filter((h) => h.path === file).map((h) => h.date);
    expect(own).toEqual(["2026-09-01", "2026-01-05"]);
  });

  it("finds paragraphs of another plan by shared source and honors limit and refs", async () => {
    const { call, service, chapter } = await filled();
    await call("plans.create", {
      project: "phd",
      slug: "paper",
      title: "Paper",
      template: "imrad",
    });
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", {
      project: "phd",
      plan: "paper",
    });
    await call("insights.note", {
      project: "phd",
      plan: "paper",
      target: byTitle(nodes, "Methods").id,
      text: "Methodisch zählt [[luhmann1984soziale]].",
    });
    const hits = (
      await service.findInsights({ project: "phd", plan: "proposal", node: chapter.id, limit: 10 })
    ).hits;
    expect(hits.some((h) => h.path.includes("plans/paper/"))).toBe(true);
    expect(
      (await service.findInsights({ project: "phd", plan: "proposal", node: chapter.id, limit: 1 }))
        .hits,
    ).toHaveLength(1);
    const byRef = await service.findInsights({
      project: "phd",
      refs: ["[[luhmann1984soziale]]"],
      limit: 10,
    });
    expect(byRef.hits.every((h) => h.stage === "links")).toBe(true);
    expect(byRef.hits.map((h) => h.path).sort()).toHaveLength(2);
  });

  it("uses an injected ranker for the semantic stage", async () => {
    const { lib, call } = await setup("expose");
    const service = new PlanningService(lib, {
      rank: async (_q, texts) => texts.map((t) => (t.includes("Kraftwerk") ? 0.9 : 0)),
    });
    await call("insights.note", {
      project: "phd",
      target: "project",
      text: "Kraftwerk der Ideen.",
    });
    await call("insights.note", { project: "phd", target: "project", text: "Etwas anderes." });
    const { hits } = await service.findInsights({ project: "phd", query: "Energie", limit: 5 });
    expect(hits.map((h) => h.text.slice(12, 20))).toEqual(["Kraftwer"]);
    expect(hits[0]?.stage).toBe("semantic");
  });

  it("needs a node, refs or a query", async () => {
    const { service } = await setup("expose");
    await expect(service.findInsights({ project: "phd", limit: 5 })).rejects.toThrow(
      /needs a node/,
    );
  });
});

describe("plan.docs.update", () => {
  it("replaces the body, keeps the frontmatter and detects a changed file", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const section = byTitle(nodes, "Relevanz");
    const made = await call<{ path: string; hash: string }>("plan.docs.update", {
      project: "phd",
      doc: section.id,
      body: "# Relevanz\n\nEigener Text.",
    });
    expect(read(lib, made.path)).toContain(`node: ${section.id}`);
    expect(read(lib, made.path)).toContain("Eigener Text.");
    await call("plan.docs.update", {
      project: "phd",
      doc: section.id,
      body: "Neu.",
      baseHash: made.hash,
    });
    await expect(
      call("plan.docs.update", {
        project: "phd",
        doc: section.id,
        body: "Alt.",
        baseHash: made.hash,
      }),
    ).rejects.toThrow(/changed since/);
  });
});

describe("plan.docs.get", () => {
  it("returns the body without frontmatter and a hash that plan.docs.update accepts", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const chapter = byTitle(nodes, "Theoretischer Rahmen");
    const first = await call<{ path: string; body: string; hash: string; exists: boolean }>(
      "plan.docs.get",
      { project: "phd", doc: chapter.id },
    );
    expect(first.exists).toBe(true);
    expect(first.path).toBe(chapter.doc);
    expect(first.body).toContain("# Theoretischer Rahmen");
    expect(first.body).not.toContain("node:");
    expect(first.hash).toBe(sha256Hex(read(lib, first.path)));

    await call("plan.docs.update", {
      project: "phd",
      doc: chapter.id,
      body: "Neuer Text.",
      baseHash: first.hash,
    });
    const second = await call<{ body: string; hash: string }>("plan.docs.get", {
      project: "phd",
      doc: chapter.id,
    });
    expect(second.body.trim()).toBe("Neuer Text.");
    expect(second.hash).not.toBe(first.hash);
    await expect(
      call("plan.docs.update", {
        project: "phd",
        doc: chapter.id,
        body: "Alt.",
        baseHash: first.hash,
      }),
    ).rejects.toThrow(/changed since/);
  });

  it("reads the planning document and reports a node without a document as missing", async () => {
    const { lib, call } = await setup("expose");
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd" });
    const plan = await call<{ path: string; exists: boolean }>("plan.docs.get", {
      project: "phd",
      doc: "plan",
    });
    expect(plan).toMatchObject({ path: "projects/phd/plans/proposal/plan.md", exists: true });

    const section = byTitle(nodes, "Relevanz");
    expect(section.doc).toBeUndefined();
    const missing = await call<{ path: string; body: string; hash: string; exists: boolean }>(
      "plan.docs.get",
      { project: "phd", doc: section.id },
    );
    expect(missing).toMatchObject({ body: "", exists: false, hash: sha256Hex("") });
    // Reading creates nothing, and the hash of the missing file works as baseHash for the first write.
    expect(existsSync(join(lib.root, missing.path))).toBe(false);
    await call("plan.docs.update", {
      project: "phd",
      doc: section.id,
      body: "Erster Text.",
      baseHash: missing.hash,
    });
  });

  it("asks for the plan when the project has several", async () => {
    const { call } = await setup("expose");
    await call("plans.create", {
      project: "phd",
      slug: "paper",
      title: "Paper",
      template: "imrad",
    });
    await expect(call("plan.docs.get", { project: "phd", doc: "plan" })).rejects.toThrow(
      /several plans/,
    );
    const paper = await call<{ path: string }>("plan.docs.get", {
      project: "phd",
      plan: "paper",
      doc: "plan",
    });
    expect(paper.path).toBe("projects/phd/plans/paper/plan.md");
  });
});

describe("insights.list", () => {
  it("lists every insight of the plan and the project, newest first, without plain paragraphs", async () => {
    const day = (d: number) => new Date(2026, 10, d, 9);
    let now = day(1);
    const lib = await Library.init(tmpDir("cg-plan-"), {
      name: "Test",
      localBase: tmpDir("cg-local-"),
      watch: false,
    });
    open.push(lib);
    lib.createProject("human", { slug: "phd", title: "PhD", brief: "Brief" });
    const registry = new Registry();
    bindPlanningOperations(registry, lib, { now: () => now });
    const call = <T>(name: string, input: unknown) =>
      registry.call(name, { actor: "agent:test" }, input) as Promise<T>;
    await call("plans.create", { project: "phd", slug: "a", title: "A", template: "expose" });
    await call("plans.create", { project: "phd", slug: "b", title: "B", template: "imrad" });
    const { nodes } = await call<{ nodes: Node[] }>("outline.get", { project: "phd", plan: "a" });
    const chapter = byTitle(nodes, "Theoretischer Rahmen");

    const note = async (d: number, target: string, text: string, plan?: string) => {
      now = day(d);
      await call("insights.note", { project: "phd", ...(plan ? { plan } : {}), target, text });
    };
    await note(2, chapter.id, "Einsicht im Kapitel.", "a");
    await note(5, "plan", "Einsicht im Plan A.", "a");
    await note(3, "project", "Lose Idee des Projekts.");
    await note(4, "plan", "Einsicht im Plan B.", "b");
    await note(6, "plan", "Spätere Einsicht im Plan A.", "a");
    // a paragraph without a block id is text, not an insight
    const doc = await call<{ body: string; hash: string }>("plan.docs.get", {
      project: "phd",
      plan: "a",
      doc: "plan",
    });
    await call("plan.docs.update", {
      project: "phd",
      plan: "a",
      doc: "plan",
      body: `Nur Fliesstext ohne Block.\n\n${doc.body}`,
      baseHash: doc.hash,
    });

    const forA = await call<{ hits: Array<{ text: string; date?: string; stage: string }> }>(
      "insights.list",
      { project: "phd", plan: "a" },
    );
    expect(forA.hits.map((h) => h.text)).toEqual([
      "2026-11-06: Spätere Einsicht im Plan A.",
      "2026-11-05: Einsicht im Plan A.",
      "2026-11-03: Lose Idee des Projekts.",
      "2026-11-02: Einsicht im Kapitel.",
    ]);
    expect(forA.hits.every((h) => h.stage === "links")).toBe(true);

    const all = await call<{ hits: Array<{ text: string }> }>("insights.list", {
      project: "phd",
    });
    expect(all.hits.map((h) => h.text)).toContain("2026-11-04: Einsicht im Plan B.");
    expect(all.hits).toHaveLength(5);

    const two = await call<{ hits: unknown[] }>("insights.list", {
      project: "phd",
      plan: "a",
      limit: 2,
    });
    expect(two.hits).toHaveLength(2);
    await expect(call("insights.list", { project: "phd", plan: "nope" })).rejects.toThrow(
      /no plan/,
    );
  });
});

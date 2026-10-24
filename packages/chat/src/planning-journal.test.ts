import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library, PlanningService } from "@citegeist/core";
import { afterEach, describe, expect, it } from "vitest";
import { diffSnapshots, revertEdits, SnapshotCache } from "./journal.js";

/** Plan files are Markdown and YAML under projects/, so the turn journal already covers them. */

const dirs: string[] = [];
const libs: Library[] = [];
afterEach(async () => {
  for (const l of libs.splice(0)) await l.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("turn journal and planning", () => {
  it("undoes note_insight and outline edits of one turn, keeping a later hand edit", async () => {
    const base = mkdtempSync(join(tmpdir(), "cg-chat-plan-"));
    dirs.push(base);
    const lib = await Library.init(join(base, "lib"), {
      localBase: join(base, "local"),
      watch: false,
    });
    libs.push(lib);
    lib.createProject("human", { slug: "phd", title: "PhD", brief: "Brief" });
    const plans = new PlanningService(lib, { now: () => new Date(2026, 10, 12) });
    plans.createPlan("human", {
      project: "phd",
      slug: "proposal",
      title: "Proposal",
      template: "expose",
    });

    const cache = new SnapshotCache(lib.root);
    const before = await cache.take();
    const outline = plans.getOutline("phd");
    const chapter = outline.nodes[0];
    if (!chapter?.doc) throw new Error("no chapter document");
    plans.noteInsight({ project: "phd", target: chapter.id, text: "Neue Einsicht [[a1984]]." });
    plans.applyOutline({
      project: "phd",
      ops: [{ op: "add", parent: null, title: "Anhang" }],
      force: false,
    });
    const after = await cache.take();
    const edits = diffSnapshots(before, after);
    expect(edits.map((e) => e.path)).toEqual(
      expect.arrayContaining([chapter.doc, "projects/phd/plans/proposal/outline.yaml"]),
    );

    const doc = join(lib.root, chapter.doc);
    const handEdited = `${readFileSync(doc, "utf8")}\nVon Hand ergänzt.\n`;
    // Jonny edits right below the agent's paragraph: the merge reports a conflict and keeps both.
    writeFileSync(doc, handEdited);
    const result = await revertEdits(lib.root, edits, {
      changed: () => {},
      remove: (p) => rmSync(p),
    });
    expect(result.conflicts.map((c) => c.path)).toContain(chapter.doc);
    expect(readFileSync(doc, "utf8")).toContain("Von Hand ergänzt.");
    expect(plans.getOutline("phd").nodes.some((n) => n.title === "Anhang")).toBe(false);
    expect(plans.getOutline("phd").nodes).toHaveLength(outline.nodes.length);
  });
});

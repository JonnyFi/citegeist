import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library, TextsService } from "@citegeist/core";
import { afterEach, describe, expect, it } from "vitest";
import { diffSnapshots, revertEdits, SnapshotCache } from "./journal.js";

/** Texts are Markdown under projects/<slug>/texts/, so the turn journal covers them (D12, D20). */

const dirs: string[] = [];
const libs: Library[] = [];
afterEach(async () => {
  for (const l of libs.splice(0)) await l.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("turn journal and texts", () => {
  it("undoes a passage the agent wrote into a text, and an export never counts as an edit", async () => {
    const base = mkdtempSync(join(tmpdir(), "cg-chat-text-"));
    dirs.push(base);
    const lib = await Library.init(join(base, "lib"), {
      localBase: join(base, "local"),
      watch: false,
    });
    libs.push(lib);
    lib.createProject("human", { slug: "phd", title: "PhD", brief: "Brief" });
    const texts = new TextsService(lib, { localBase: join(base, "local") });
    const made = texts.create("human", {
      project: "phd",
      title: "Kapitel 2",
      body: "Erster Absatz.",
    });

    const cache = new SnapshotCache(lib.root);
    const before = await cache.take();
    texts.update({
      project: "phd",
      text: "kapitel-2",
      body: "Erster Absatz.\n\nNeu vom Agent [@luhmann1984soziale, S. 12].",
    });
    // an export is derived output: the journal skips the exports folder
    mkdirSync(join(lib.root, "projects/phd/exports"), { recursive: true });
    writeFileSync(join(lib.root, "projects/phd/exports/kapitel-2.md"), "Erster Absatz.");
    const after = await cache.take();
    const edits = diffSnapshots(before, after);
    expect(edits.map((e) => e.path)).toEqual([made.path]);

    const result = await revertEdits(lib.root, edits, {
      changed: () => {},
      remove: (p) => rmSync(p),
    });
    expect(result.conflicts).toEqual([]);
    expect(readFileSync(join(lib.root, made.path), "utf8")).not.toContain("Neu vom Agent");
    expect(texts.get("phd", "kapitel-2").body).toBe("Erster Absatz.");
  });
});

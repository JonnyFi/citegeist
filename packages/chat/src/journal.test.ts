import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffSnapshots, SnapshotCache } from "./journal.js";
import { merge3 } from "./merge.js";

describe("merge3", () => {
  const lines = (...l: string[]) => `${l.join("\n")}\n`;

  it("takes the other side when one side did not change", () => {
    expect(merge3("a\n", "a\n", "b\n")).toEqual({ ok: true, text: "b\n" });
    expect(merge3("a\n", "b\n", "a\n")).toEqual({ ok: true, text: "b\n" });
  });

  it("combines changes in different places", () => {
    const base = lines("one", "two", "three", "four", "five", "six");
    const ours = lines("one", "two", "three", "four", "five", "SIX");
    const theirs = lines("ONE", "two", "three", "four", "five", "six");
    expect(merge3(base, ours, theirs)).toEqual({
      ok: true,
      text: lines("ONE", "two", "three", "four", "five", "SIX"),
    });
  });

  it("handles inserts and deletions on both sides", () => {
    const base = lines("a", "b", "c", "d", "e");
    const ours = lines("a", "b", "c", "d", "e", "f");
    const theirs = lines("a", "c", "d", "e");
    expect(merge3(base, ours, theirs)).toEqual({ ok: true, text: lines("a", "c", "d", "e", "f") });
  });

  it("accepts the same change made on both sides", () => {
    const base = lines("a", "b", "c");
    const both = lines("a", "B", "c");
    expect(merge3(base, both, both)).toEqual({ ok: true, text: both });
    expect(merge3(base, both, lines("a", "B", "c"))).toEqual({ ok: true, text: both });
  });

  it("reports changes on the same line as a conflict", () => {
    const base = lines("a", "b", "c");
    const result = merge3(base, lines("a", "ours", "c"), lines("a", "theirs", "c"));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("same lines") });
  });

  it("treats neighbouring lines as a conflict", () => {
    const base = lines("a", "b", "c", "d");
    const result = merge3(base, lines("a", "B", "c", "d"), lines("a", "b", "C", "d"));
    expect(result.ok).toBe(false);
  });
});

describe("snapshots", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "citegeist-journal-"));
    for (const d of [
      "items/a",
      "items/a/derived/abc",
      "items/a/sources",
      "notes",
      "projects/p",
      "chats",
    ]) {
      mkdirSync(join(root, d), { recursive: true });
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("tracks the text areas of the library and nothing else", async () => {
    writeFileSync(join(root, "items/a/a.md"), "item");
    writeFileSync(join(root, "items/a/derived/abc/doc.md"), "derived");
    writeFileSync(join(root, "items/a/sources/x.md"), "source");
    writeFileSync(join(root, "notes/n.md"), "note");
    writeFileSync(join(root, "notes/.n.md.deadbeef.tmp"), "temp");
    writeFileSync(join(root, "notes/image.png"), "png");
    writeFileSync(join(root, "projects/p/project.md"), "project");
    writeFileSync(join(root, "projects/p/plan.yaml"), "a: 1");
    writeFileSync(join(root, "chats/c.md"), "chat");
    writeFileSync(join(root, "AGENTS.md"), "rules");
    const snap = await new SnapshotCache(root).take();
    expect([...snap.keys()].sort()).toEqual([
      "items/a/a.md",
      "notes/n.md",
      "projects/p/plan.yaml",
      "projects/p/project.md",
    ]);
  });

  it("finds created, modified and deleted files", async () => {
    writeFileSync(join(root, "notes/keep.md"), "same");
    writeFileSync(join(root, "notes/change.md"), "old");
    writeFileSync(join(root, "notes/gone.md"), "bye");
    const cache = new SnapshotCache(root);
    const before = await cache.take();
    writeFileSync(join(root, "notes/change.md"), "new text");
    writeFileSync(join(root, "notes/fresh.md"), "hello");
    rmSync(join(root, "notes/gone.md"));
    const edits = diffSnapshots(before, await cache.take());
    expect(edits).toEqual([
      { path: "notes/change.md", before: "old", after: "new text" },
      { path: "notes/fresh.md", before: null, after: "hello" },
      { path: "notes/gone.md", before: "bye", after: null },
    ]);
  });

  it("reads only files whose size or time changed", async () => {
    const file = join(root, "notes/a.md");
    writeFileSync(file, "abcd");
    const cache = new SnapshotCache(root);
    const first = await cache.take();
    const again = await cache.take();
    // Unchanged files come back as the same entry, not as a new read.
    expect(again.get("notes/a.md")).toBe(first.get("notes/a.md"));
    writeFileSync(file, "wxyz");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const changed = await cache.take();
    expect(changed.get("notes/a.md")?.content).toBe("wxyz");
  });
});

import { describe, expect, it } from "vitest";
import {
  Actor,
  CardFrontmatter,
  CardKind,
  CitegeistError,
  ItemFrontmatter,
  Link,
  legacyItemPatch,
  migrateItemData,
  NoteFrontmatter,
  PageInfo,
  ProjectFrontmatter,
  toJsonSchemas,
  WORKER_NOTIFICATIONS,
  WorkerConvertParams,
} from "./index.js";

const stamp = { at: "2026-10-23T10:00:00Z", by: "human" };

describe("schemas", () => {
  it("parses an item with extra CSL variables and defaults", () => {
    const item = ItemFrontmatter.parse({
      id: "01JB8Z3QK7ABCDEFGH",
      citekey: "luhmann1984soziale",
      type: "book",
      title: "Soziale Systeme",
      author: [{ family: "Luhmann", given: "Niklas" }],
      issued: 1984,
      "collection-title": "stw",
      created: stamp,
    });
    expect(item.status).toBe("unread");
    expect(item["collection-title"]).toBe("stw");
  });

  it("types the full text marker and reads the old shape as the new one", () => {
    const base = {
      id: "01JB8Z3QK7ABCDEFGH",
      citekey: "luhmann1984soziale",
      type: "book",
      title: "Soziale Systeme",
      created: stamp,
    };
    const current = ItemFrontmatter.parse({
      ...base,
      fulltext: { status: "found", checked_at: "2026-10-24T10:00:00Z" },
    });
    expect(current.fulltext).toEqual({
      status: "found",
      tried: [],
      checked_at: "2026-10-24T10:00:00Z",
    });
    const oldShape = {
      ...base,
      fulltext: {
        status: "none",
        at: "2026-10-24T10:00:00Z",
        tried: [{ source: "arxiv", outcome: "none" }],
      },
    };
    // the strict schema knows only the current shape; migrateItemData brings old files there
    expect(ItemFrontmatter.safeParse(oldShape).success).toBe(false);
    const old = ItemFrontmatter.parse(migrateItemData(oldShape));
    expect(old.fulltext).toEqual({
      status: "missing",
      tried: [{ source: "arxiv", outcome: "none" }],
      checked_at: "2026-10-24T10:00:00Z",
    });
    expect(legacyItemPatch({ fulltext: old.fulltext })).toEqual({});
    expect(migrateItemData({ ...base })).toEqual(base);
    expect(ItemFrontmatter.safeParse({ ...base, fulltext: { status: "maybe" } }).success).toBe(
      false,
    );
  });

  it("knows the rejected status of a link", () => {
    expect(Link.parse({ to: "[[a]]", by: "human", status: "rejected" }).status).toBe("rejected");
    expect(Link.parse({ to: "[[a]]", by: "human" }).status).toBe("accepted");
    expect(Link.safeParse({ to: "[[a]]", by: "human", status: "deleted" }).success).toBe(false);
  });

  it("rejects bad actors and citekeys", () => {
    expect(Actor.safeParse("agent:grok").success).toBe(true);
    expect(Actor.safeParse("grok").success).toBe(false);
    expect(
      ItemFrontmatter.safeParse({
        id: "01JB8Z3QK7ABCDEFGH",
        citekey: "Bad Key",
        type: "book",
        title: "x",
        created: stamp,
      }).success,
    ).toBe(false);
  });

  it("parses a card with both anchors", () => {
    const card = CardFrontmatter.parse({
      id: "c_01JB8Z3QK7ABCDEFGH",
      item: "luhmann1984soziale",
      source: "3f9a1c2e7b4d",
      locator: { start: "31", end: "32" },
      anchor: {
        pdf: { page: 42, quads: [[72, 310, 290, 330]], file: "3f9a1c2e7b4d" },
        text: { block: "b7f3k2q", exact: "Kommunikation" },
      },
      quote_sha256: "a".repeat(64),
      created: stamp,
    });
    expect(card.kind).toBeUndefined();
    expect(card.locator?.label).toBe("page");
  });

  describe("card kind migration (D16)", () => {
    const base = {
      id: "c_01JB8Z3QK7ABCDEFGH",
      item: "luhmann1984soziale",
      anchor: { text: { exact: "Kommunikation" } },
      quote_sha256: "a".repeat(64),
      created: stamp,
    };
    const kindOf = (kind: unknown) => CardFrontmatter.parse({ ...base, kind }).kind;

    it("reads the old kinds quote and comment as no kind", () => {
      expect(kindOf("quote")).toBeUndefined();
      expect(kindOf("comment")).toBeUndefined();
      expect(kindOf(undefined)).toBeUndefined();
    });

    it("keeps the unchanged kinds and knows the new ones", () => {
      for (const kind of ["finding", "method", "definition", "critique", "thesis", "example"]) {
        expect(kindOf(kind)).toBe(kind);
      }
      expect(CardKind.options).toEqual([
        "thesis",
        "finding",
        "method",
        "definition",
        "example",
        "critique",
      ]);
    });

    it("reads a value that is no kind as unset instead of failing the card", () => {
      expect(kindOf("opinion")).toBeUndefined();
      expect(kindOf(42)).toBeUndefined();
    });

    it("stays representable as JSON Schema, with the new kinds as the only options", () => {
      const json = JSON.stringify(toJsonSchemas().card);
      expect(json).toContain('"thesis"');
      expect(json).not.toContain('"comment"');
    });

    it("still parses a stored core stamp", () => {
      const fm = CardFrontmatter.parse({
        ...base,
        core: { by: "claude-code/haiku", at: "2026-10-23T11:02:00Z" },
      });
      expect(fm.core?.by).toBe("claude-code/haiku");
    });
  });

  it("parses notes with typed links and projects with export policy defaults", () => {
    const note = NoteFrontmatter.parse({
      id: "n_01JB8Z3QK7ABCDEFGH",
      title: "Autopoiesis",
      links: [
        {
          to: "[[luhmann1984soziale]]",
          rel: "supports",
          by: "agent:claude-code",
          status: "proposed",
        },
      ],
      created: stamp,
    });
    expect(note.links[0]?.rel).toBe("supports");
    expect(
      ProjectFrontmatter.parse({ slug: "phd-proposal", title: "PhD", created: stamp }).export
        .paraphrase,
    ).toBe("own-else-ai");
  });

  it("builds agent-ready errors and exports JSON Schemas", () => {
    const err = new CitegeistError({
      code: "ITEM_NOT_FOUND",
      message: "No item with citekey x",
      fix: "Run `cg items list` to find the citekey",
      recovery: "fix-and-retry",
    });
    expect(err.detail.sideEffects).toBe("none");
    const schemas = toJsonSchemas();
    expect(Object.keys(schemas)).toContain("card");
  });

  it("carries the worker additions: label confidence, pdfPath and progress notifications", () => {
    const page = {
      index: 0,
      label: "12",
      labelSource: "header-footer",
      width: 595,
      height: 842,
      textSource: "born-digital",
    };
    expect(PageInfo.parse({ ...page, labelConfidence: 0.8 }).labelConfidence).toBe(0.8);
    expect(PageInfo.parse(page).labelConfidence).toBeUndefined();
    expect(PageInfo.safeParse({ ...page, labelConfidence: 1.2 }).success).toBe(false);

    const params = {
      sourcePath: "/a/paper.html",
      source: "0123456789ab",
      outDir: "/o",
      kind: "arxiv-html",
    };
    expect(WorkerConvertParams.parse({ ...params, pdfPath: "/a/paper.pdf" }).pdfPath).toBe(
      "/a/paper.pdf",
    );
    expect(WorkerConvertParams.parse(params).pdfPath).toBeUndefined();

    const progress = WORKER_NOTIFICATIONS.progress;
    expect(progress.parse({ id: 3, message: "Converting", fraction: 0.4 }).fraction).toBe(0.4);
    expect(
      progress.parse({ id: 3, message: "Loading models", fraction: null }).fraction,
    ).toBeNull();
    expect(progress.safeParse({ id: 3, fraction: 2 }).success).toBe(false);
    expect(Object.keys(toJsonSchemas())).toEqual(
      expect.arrayContaining(["worker-health-result", "worker-progress"]),
    );
  });
});

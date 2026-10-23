import { describe, expect, it } from "vitest";
import {
  Actor,
  CardFrontmatter,
  CitegeistError,
  ItemFrontmatter,
  NoteFrontmatter,
  ProjectFrontmatter,
  toJsonSchemas,
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
    expect(card.kind).toBe("quote");
    expect(card.locator?.label).toBe("page");
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
});

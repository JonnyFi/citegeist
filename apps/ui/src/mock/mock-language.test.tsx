import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createReflowFixtures, renderApp } from "../test-utils";
import { createMockCore } from "./core";
import { createFixtures } from "./fixtures";

const call = async (core: ReturnType<typeof createMockCore>, name: string, input: unknown) =>
  (core as unknown as { call: (c: { name: string }, i: unknown) => Promise<unknown> }).call(
    { name } as never,
    input,
  );

describe("the language of the mock library", () => {
  it("follows the language the fixtures are made in", () => {
    const de = createFixtures("de");
    const en = createFixtures("en");
    expect(de.lang).toBe("de");
    expect(en.lang).toBe("en");
    expect(de.cards[0]?.body.quote).toMatch(/^Soziale Systeme/);
    expect(en.cards[0]?.body.quote).toMatch(/^Social systems/);
    expect(en.items.get("luhmann1984soziale")?.frontmatter.title).toBe(
      "Social Systems: Outline of a General Theory",
    );
    expect(en.projects.get("phd-proposal")?.frontmatter.ai_language).toBe("en");
    expect(de.projects.get("phd-proposal")?.frontmatter.ai_language).toBeUndefined();
  });

  it("keeps the card quotes inside the English document, so highlights still resolve", () => {
    const en = createFixtures("en");
    const text = (en.docs.get("luhmann1984soziale")?.blocks ?? []).map((b) => b.text).join("\n");
    for (const card of en.cards.filter((c) => c.frontmatter.item === "luhmann1984soziale")) {
      expect(text).toContain(card.body.quote);
    }
  });

  it("gives the English-language sources the same text in both languages", () => {
    const de = createFixtures("de");
    const en = createFixtures("en");
    expect(en.cards[3]?.body.quote).toBe(de.cards[3]?.body.quote);
    expect(en.items.get("lewis2020retrieval")?.frontmatter.title).toBe(
      de.items.get("lewis2020retrieval")?.frontmatter.title,
    );
  });

  it("shows English cards and notes next to the English UI", async () => {
    renderApp("/items/luhmann1984soziale?tab=read", createReflowFixtures("en"), { lang: "en" });
    const cards = await screen.findAllByTestId("panel-card");
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Social systems consist of communications");
    expect(document.body).not.toHaveTextContent("Soziale Systeme bestehen");
  });

  it("serves English plans, templates and exports", async () => {
    const data = createFixtures("en");
    const core = createMockCore(data);
    const outline = (await call(core, "outline.get", {
      project: "phd-proposal",
      plan: "expose",
    })) as {
      title: string;
      nodes: Array<{ title: string }>;
    };
    expect(outline.title).toBe("Proposal");
    expect(outline.nodes.map((n) => n.title)).toContain("Research questions");
    await call(core, "plans.create", {
      project: "rag-evaluation",
      slug: "paper",
      title: "Paper",
      template: "imrad",
    });
    const paper = (await call(core, "outline.get", {
      project: "rag-evaluation",
      plan: "paper",
    })) as {
      nodes: Array<{ title: string }>;
    };
    expect(paper.nodes.map((n) => n.title)).toEqual([
      "Introduction",
      "Methods",
      "Results",
      "Discussion",
    ]);
    const exported = (await call(core, "cards.export", {
      ids: [data.cards[0]?.frontmatter.id],
      mode: "direct",
      format: "text",
    })) as { text: string };
    expect(exported.text).toBe(
      "\u201cSocial systems consist of communications and only of communications. Human beings are in their environment.\u201d (Luhmann 1984, p. 31)",
    );
  });
});

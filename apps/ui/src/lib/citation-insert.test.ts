import { describe, expect, it } from "vitest";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import { kindFor, kindForKeys, renderCitation } from "./citation-insert";

function setup() {
  const core = createMockCore(createFixtures());
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const original = core.call.bind(core);
  core.call = ((contract, input) => {
    calls.push({ name: contract.name, input: input as Record<string, unknown> });
    return original(contract, input);
  }) as typeof core.call;
  return { core, calls };
}

async function firstCard(core: ReturnType<typeof setup>["core"]) {
  const { cardsList } = await import("@citegeist/ops");
  const { cards } = await core.call(cardsList, { citekey: "luhmann1984soziale", limit: 5 });
  const card = cards.find((c) => c.frontmatter.locator?.start === "31");
  if (!card) throw new Error("fixture card missing");
  return card.frontmatter.id;
}

describe("kindForKeys", () => {
  it("maps Enter, Shift+Enter and Alt+Enter to the three kinds", () => {
    expect(kindForKeys({})).toBe("direct");
    expect(kindForKeys({ shiftKey: true })).toBe("indirect");
    expect(kindForKeys({ altKey: true })).toBe("cite");
    expect(kindForKeys({ shiftKey: true, altKey: true })).toBe("cite");
  });

  it("lets a source only be cited", () => {
    expect(kindFor({ type: "source", citekey: "a" }, "direct")).toBe("cite");
    expect(kindFor({ type: "card", id: "c" }, "indirect")).toBe("indirect");
  });
});

describe("renderCitation", () => {
  it("writes a card into a text as Pandoc, once per kind, in the language of the text", async () => {
    const { core, calls } = setup();
    const id = await firstCard(core);
    const target = { type: "text", project: "phd-proposal", lang: "de-DE" } as const;
    const subject = { type: "card", id } as const;
    const direct = await renderCitation(core, subject, "direct", target);
    const indirect = await renderCitation(core, subject, "indirect", target);
    const cite = await renderCitation(core, subject, "cite", target);
    expect(direct.text).toMatch(
      /^„Soziale Systeme bestehen aus Kommunikationen.*“ \[@luhmann1984soziale, S\. 31\]$/,
    );
    expect(indirect.text).toMatch(/ \[vgl\. @luhmann1984soziale, S\. 31\]$/);
    expect(cite.text).toBe("[@luhmann1984soziale, S. 31]");
    expect(calls.filter((c) => c.name === "cards.export").map((c) => c.input)).toEqual([
      expect.objectContaining({
        mode: "direct",
        format: "pandoc",
        project: "phd-proposal",
        locale: "de-DE",
      }),
      expect.objectContaining({ mode: "indirect", format: "pandoc", locale: "de-DE" }),
      expect.objectContaining({ mode: "cite", format: "pandoc", locale: "de-DE" }),
    ]);
  });

  it("uses the terms of an English text", async () => {
    const { core } = setup();
    const id = await firstCard(core);
    const out = await renderCitation(core, { type: "card", id }, "cite", {
      type: "text",
      project: "phd-proposal",
      lang: "en-US",
    });
    expect(out.text).toBe("[@luhmann1984soziale, p. 31]");
  });

  it("writes a source into a text as a bare Pandoc citation", async () => {
    const { core, calls } = setup();
    const out = await renderCitation(
      core,
      { type: "source", citekey: "luhmann1984soziale" },
      "cite",
      { type: "text", project: "phd-proposal", lang: "de-DE" },
    );
    expect(out.text).toBe("[@luhmann1984soziale]");
    expect(calls.map((c) => c.name)).toEqual(["cite.format"]);
  });

  it("formats a card for another app as html and plain text", async () => {
    const { core } = setup();
    const id = await firstCard(core);
    const direct = await renderCitation(core, { type: "card", id }, "direct", { type: "external" });
    expect(direct.html).toContain("<blockquote>„Soziale Systeme bestehen aus Kommunikationen");
    expect(direct.text).toContain("Luhmann 1984, S. 31");
    const cite = await renderCitation(core, { type: "card", id }, "cite", { type: "external" });
    expect(cite.text).toBe("(Luhmann 1984, S. 31)");
  });
});

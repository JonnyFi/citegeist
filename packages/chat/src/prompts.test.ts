import { describe, expect, it } from "vitest";
import { instructions, renderContext, turnPrompt } from "./prompts.js";

describe("renderContext", () => {
  it("is empty without a context", () => {
    expect(renderContext({})).toBe("");
  });

  it("names the project, the open plan and the open outline node", () => {
    const text = renderContext({
      project: "phd",
      plan: "proposal",
      node: "k_01JC5Q2M8T",
      item: "luhmann1984soziale",
    });
    expect(text).toMatch(/^\[Context from the screen\]\n/);
    expect(text).toContain("Project: phd");
    expect(text).toContain("Open plan: proposal");
    expect(text).toContain("Open outline node: k_01JC5Q2M8T");
    expect(text).toContain("Open source: luhmann1984soziale");
    // the plan comes after the project and before the source
    expect(text.indexOf("Project:")).toBeLessThan(text.indexOf("Open plan:"));
    expect(text.indexOf("Open outline node:")).toBeLessThan(text.indexOf("Open source:"));
  });

  it("points the agent to the file of the open text and the way to cite", () => {
    const text = renderContext({ project: "phd", text: "kapitel-2" });
    expect(text).toContain("Open text: projects/phd/texts/kapitel-2.md");
    expect(text).toContain("[@citekey, S. 12]");
    expect(text).toContain("cg texts export");
    // without a project the screen names no folder, so the text is left out
    expect(renderContext({ text: "kapitel-2" })).toBe("");
  });

  it("puts the context in front of the message of the turn", () => {
    const prompt = turnPrompt({
      first: undefined,
      context: { project: "phd", plan: "proposal", node: "k_01JC5Q2M8T" },
      message: "Wo stehe ich?",
    });
    expect(prompt.endsWith("\n\nWo stehe ich?")).toBe(true);
    expect(prompt).toContain("Open plan: proposal");
  });
});

describe("cards in the chat", () => {
  it("names a card in the context as the one to pass to the link tool", () => {
    const text = renderContext({
      item: "williams2013accelerate",
      selection: {
        citekey: "williams2013accelerate",
        text: "Die Beschleunigung endet in Hierarchie.",
        page: "4",
        card: "c_01JB8Z3Q0001",
      },
    });
    expect(text).toContain("Card c_01JB8Z3Q0001");
    expect(text).toContain("`from`");
    expect(text).toContain("link tool");
  });

  it("teaches the link tool with a card as from and the relation vocabulary", () => {
    const text = instructions({ mode: "chat", libraryRoot: "/lib", directEdits: false });
    expect(text).toContain("call link with the card id (c_...) as `from`");
    for (const rel of [
      "supports",
      "opposes",
      "qualifies",
      "addresses",
      "extends",
      "uses-method-of",
      "uses-data-from",
      "elaborates",
      "related",
    ]) {
      expect(text).toContain(rel);
    }
  });
});

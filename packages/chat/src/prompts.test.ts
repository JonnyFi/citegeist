import { describe, expect, it } from "vitest";
import { renderContext, turnPrompt } from "./prompts.js";

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

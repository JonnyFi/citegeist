import { describe, expect, it } from "vitest";
import { CONTRACTS } from "./contracts/index.js";
import { localizeError, localizeOperations } from "./localize.js";

const mcp = CONTRACTS.filter((c) => c.mcp);
const readOnly = CONTRACTS.filter((c) => c.mcp?.readOnly);

describe("localizeOperations", () => {
  it("names the MCP tool on MCP and the cg command on the command line", () => {
    const text = "Call projects.context to see the projects, or projects.create to make one.";
    expect(localizeOperations(text, "mcp", CONTRACTS)).toBe(
      "Call get_project to see the projects, or create_project to make one.",
    );
    expect(localizeOperations(text, "cli", CONTRACTS)).toBe(
      "Call cg projects context to see the projects, or cg projects create to make one.",
    );
  });

  it("sends an operation without an MCP tool to the cg command and says so", () => {
    const out = localizeOperations("Use projects.update to change it.", "mcp", CONTRACTS);
    expect(out).toBe(
      "Use cg projects update (not an MCP tool, ask the user to run it) to change it.",
    );
  });

  it("treats a tool the connection does not list as unavailable", () => {
    const out = localizeOperations("Run items.attach.", "mcp", CONTRACTS, readOnly);
    expect(out).toContain("cg items attach (not an MCP tool");
    expect(out).not.toContain("attach_file");
  });

  it("takes the longest name and leaves other dotted text alone", () => {
    const out = localizeOperations(
      "See plan.docs.update, notes.md and v1.2.3, then items.add.",
      "mcp",
      CONTRACTS,
    );
    expect(out).toContain("edit_plan_doc");
    expect(out).toContain("notes.md");
    expect(out).toContain("v1.2.3");
    expect(out.endsWith("add_item.")).toBe(true);
  });

  it("rewrites message and fix of an error", () => {
    const e = localizeError(
      { code: "X", message: "m items.trash", fix: "f items.trash" },
      "mcp",
      CONTRACTS,
    );
    expect(e).toEqual({ code: "X", message: "m trash_item", fix: "f trash_item" });
  });

  it("leaves no operation name behind, for every operation on both surfaces", () => {
    for (const c of CONTRACTS) {
      for (const surface of ["mcp", "cli"] as const) {
        const out = localizeOperations(`Call ${c.name} now.`, surface, CONTRACTS, mcp);
        expect(out, `${c.name} on ${surface}`).not.toContain(c.name);
      }
    }
  });
});

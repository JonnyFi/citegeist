import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACTS, localizeOperations } from "@citegeist/ops";
import { describe, expect, it } from "vitest";
import { createFixtureRegistry } from "./fixture.js";
import { mcpContracts } from "./server.js";

// Error texts name operations (`projects.create`). Over MCP the caller can only call tools, so
// every name that reaches an MCP caller must be a tool of that connection.

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const NAMESPACES = new Set(CONTRACTS.map((c) => c.name.split(".")[0]));
const NAMES = new Set(CONTRACTS.map((c) => c.name));
/** Property names of arrays and strings, which show up in literals through nested templates. */
const JS_MEMBERS = new Set(["length", "map", "join", "filter", "push", "slice", "size", "count"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** String literals of a source file, template placeholders removed. */
// Single-line literals only: a naive multi-line template match can pair backticks across code.
function literals(code: string): string[] {
  const found: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g;
  for (const m of code.matchAll(re)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    found.push(text.replace(/\$\{[^}]*\}/g, ""));
  }
  return found;
}

describe("operation names in error texts", () => {
  it("every dotted operation reference in the sources is a real operation", () => {
    const unknown: string[] = [];
    const roots = ["packages", "apps"].map((d) => join(REPO, d));
    for (const root of roots) {
      for (const pkg of readdirSync(root)) {
        // The renderer has UI strings with keys like worker.progress, no operation texts.
        if (pkg === "ui") continue;
        const src = join(root, pkg, "src");
        try {
          if (!statSync(src).isDirectory()) continue;
        } catch {
          continue;
        }
        for (const file of sourceFiles(src)) {
          for (const text of literals(readFileSync(file, "utf8"))) {
            // Only prose: error texts, not import paths, SQL, file names or property chains.
            if (!/\s/.test(text)) continue;
            for (const m of text.matchAll(/(?<![\w./@-])([a-z]+)\.([a-z][A-Za-z]+)(?![\w-])/g)) {
              const [token, ns] = m;
              const member = m[2];
              if (!token || !ns || !NAMESPACES.has(ns) || NAMES.has(token)) continue;
              if (member && JS_MEMBERS.has(member)) continue;
              if (/^[a-z]+\.(md|ts|tsx|json|yaml|yml|html|pdf|js|mjs)$/.test(token)) continue;
              unknown.push(`${file.replace(REPO, "")}: ${token}`);
            }
          }
        }
      }
    }
    expect(unknown, "operation names that do not exist (typo or renamed)").toEqual([]);
  });

  it("an MCP connection never gets an operation name it cannot call", () => {
    const registry = createFixtureRegistry();
    for (const scope of ["read", "write"] as const) {
      const available = mcpContracts(registry, scope);
      const tools = new Set(available.map((c) => c.mcp?.tool));
      for (const c of CONTRACTS) {
        const text = `Fix: call ${c.name}, then ${c.name}.`;
        const out = localizeOperations(text, "mcp", CONTRACTS, available);
        for (const other of CONTRACTS) expect(out).not.toContain(other.name);
        if (c.mcp && tools.has(c.mcp.tool)) expect(out).toContain(c.mcp.tool);
        else expect(out).toContain("not an MCP tool");
      }
    }
  });
});

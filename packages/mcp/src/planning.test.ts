import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Library, PlanningService } from "@citegeist/core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The planning tools over stdio against a temp library: no mocks between client and files. */

const CLIENT = "claude-code";
const script = fileURLToPath(new URL("./testing/planning-stdio.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.url));

const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

let root: string;
let client: Client;

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as T;
}

interface Node {
  id: string;
  title: string;
  number: string;
  doc?: string;
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), "cg-mcp-plan-"));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  root = join(base, "lib");
  const localBase = join(base, "local");
  const lib = await Library.init(root, { localBase, watch: false });
  lib.createProject("human", { slug: "phd", title: "PhD proposal", brief: "Brief" });
  // plans.create has no MCP tool: the user creates the plan in the app.
  new PlanningService(lib).createPlan("human", {
    project: "phd",
    slug: "proposal",
    title: "Proposal",
    template: "expose",
  });
  await lib.close();
  client = new Client({ name: CLIENT, version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", script],
      cwd: packageDir,
      env: {
        ...(process.env as Record<string, string>),
        CITEGEIST_TEST_LIBRARY: root,
        CITEGEIST_TEST_LOCAL: localBase,
      },
      stderr: "inherit",
    }),
  );
  cleanups.push(() => client.close());
}, 60_000);

describe("planning tools over stdio", () => {
  it("lists the planning tools with the right hints", async () => {
    const { tools } = await client.listTools();
    const hint = (n: string) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint;
    expect(hint("note_insight")).toBe(false);
    expect(hint("edit_outline")).toBe(false);
    expect(hint("edit_plan_doc")).toBe(false);
    expect(hint("find_insights")).toBe(true);
    expect(hint("get_project")).toBe(true);
    expect(tools.find((t) => t.name === "get_outline")).toBeUndefined();
  });

  it("note_insight writes into the chapter document and find_insights brings it back", async () => {
    const outline = (await call<{ outline: { nodes: Node[] } }>("get_project", { slug: "phd" }))
      .outline;
    const chapter = outline.nodes.find((n) => n.title === "Theoretischer Rahmen");
    expect(chapter?.doc).toBeTruthy();

    const first = await call<{ path: string; block: string; number: string; summary: string }>(
      "note_insight",
      {
        project: "phd",
        target: chapter?.id,
        text: "Gillespies Rankings sind Anschlusskommunikation im Sinne von [[luhmann1984soziale]].",
      },
    );
    expect(first.path).toBe(chapter?.doc);
    expect(first.summary).toBe(`Noted in ${chapter?.number}, Theoretischer Rahmen.`);
    const file = readFileSync(join(root, first.path), "utf8");
    expect(file).toMatch(
      /^\d{4}-\d{2}-\d{2}: Gillespies Rankings .*\[\[luhmann1984soziale\]\]\. \^i-/m,
    );
    expect(file).toContain(`^${first.block}`);

    const other = await call<{ block: string }>("note_insight", {
      project: "phd",
      target: "project",
      text: "Der Rahmen braucht eine theoretische Grundlage.",
    });
    await call("note_insight", {
      project: "phd",
      target: "project",
      text: "Etwas ganz anderes.",
    });

    const found = await call<{
      hits: Array<{ block?: string; stage: string; why: string; path: string }>;
    }>("find_insights", {
      project: "phd",
      node: chapter?.id,
      refs: ["luhmann1984soziale"],
    });
    expect(found.hits.map((h) => h.block)).toEqual([first.block, other.block]);
    expect(found.hits.map((h) => h.stage)).toEqual(["links", "semantic"]);
    expect(found.hits[0]?.why).toContain("shares 1 link");
  });

  it("edit_outline adds a section, edit_plan_doc gives it a document", async () => {
    const outline = (await call<{ outline: { nodes: Node[] } }>("get_project", { slug: "phd" }))
      .outline;
    const methods = outline.nodes.find((n) => n.title === "Methodisches Vorgehen");
    const edited = await call<{ added: string[]; nodes: Node[] }>("edit_outline", {
      project: "phd",
      ops: [{ op: "add", parent: methods?.id, title: "Ethik", purpose: "Klärt die Zustimmung." }],
    });
    const added = edited.nodes.find((n) => n.id === edited.added[0]);
    expect(added?.number).toBe(`${methods?.number}.3`);
    expect(added?.doc).toBeUndefined();
    const doc = await call<{ path: string }>("edit_plan_doc", {
      project: "phd",
      doc: added?.id,
      body: "# Ethik\n\nVotum der Kommission einholen.",
    });
    expect(readFileSync(join(root, doc.path), "utf8")).toContain(`node: ${added?.id}`);
  });
});

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Library } from "@citegeist/core";
import { CONTRACTS, PLANNING_CONTRACTS } from "@citegeist/ops";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every write tool over stdio against a real library: createRuntime, the stub conversion worker,
 * recorded metadata and canned AI. Nothing here touches the network.
 */

const CLIENT = "grok-bot";
const DOI = "10.1086/225469";
// The planning tools are not bound by createRuntime yet; planning.test.ts covers them.
const writeTools = CONTRACTS.filter(
  (c) => c.mcp && !c.mcp.readOnly && !PLANNING_CONTRACTS.includes(c),
).map((c) => c.mcp?.tool ?? "");

const script = fileURLToPath(new URL("./testing/runtime-stdio.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.url));

const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

let root: string;
let localBase: string;
let client: Client;

function structured<T>(result: { structuredContent?: unknown; content?: unknown }): T {
  const text = JSON.stringify(result.content);
  expect(result.structuredContent, text).toBeTypeOf("object");
  return result.structuredContent as T;
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return structured<T>(result);
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function finished(job: string): Promise<{ status: string; error?: unknown }> {
  return waitFor("job to finish", async () => {
    const got = await call<{ status: string; error?: unknown }>("jobs_get", { job });
    return ["succeeded", "failed", "canceled"].includes(got.status) ? got : undefined;
  });
}

interface ItemGet {
  frontmatter: { citekey: string; inbox?: { by: string; why?: string }; created: { by: string } };
  cards: number;
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), "cg-mcp-write-"));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  root = join(base, "lib");
  localBase = join(base, "local");
  const lib = await Library.init(root, { localBase, watch: false });
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

describe("write tools over stdio against a real library", () => {
  it("lists every write tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(writeTools.sort()).toEqual([
      "add_item",
      "attach_file",
      "create_card",
      "create_note",
      "create_project",
      "link",
      "trash_item",
    ]);
    for (const tool of writeTools) expect(names).toContain(tool);
    expect(names).toContain("jobs_get");
  });

  it("add_item lands in the inbox by default, with the client name and the reason", async () => {
    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: DOI,
      why: "tie strength matters for chapter 2",
    });
    expect(added.job).toMatch(/^j_/);
    const job = await finished(added.job);
    expect(job.status, JSON.stringify(job)).not.toBe("failed");

    const got = await call<ItemGet>("get_item", { citekey: added.citekey });
    expect(got.frontmatter.inbox?.by).toBe(`agent:${CLIENT}`);
    expect(got.frontmatter.inbox?.why).toBe("tie strength matters for chapter 2");
    expect(got.frontmatter.created.by).toBe(`agent:${CLIENT}`);
    const file = readFileSync(join(root, "items", added.citekey, `${added.citekey}.md`), "utf8");
    expect(file).toContain("inbox:");
    expect(file).toContain(`agent:${CLIENT}`);
  });

  it("add_item with target library skips the inbox, and a repeat reports the duplicate", async () => {
    const added = await call<{ citekey: string; job: string; duplicateOf?: string }>("add_item", {
      identifier: "10.1016/S0140-6736(97)11096-0",
      target: "library",
    });
    await finished(added.job);
    const got = await call<ItemGet>("get_item", { citekey: added.citekey });
    expect(got.frontmatter.inbox).toBeUndefined();
    expect(got.frontmatter.created.by).toBe(`agent:${CLIENT}`);

    const again = await call<{ citekey: string; duplicateOf?: string }>("add_item", {
      identifier: "10.1016/S0140-6736(97)11096-0",
      target: "library",
    });
    expect(again.duplicateOf ?? again.citekey).toBe(added.citekey);
  });

  it("add_item reports an unusable identifier as an agent-ready error", async () => {
    const result = await client.callTool({
      name: "add_item",
      arguments: { identifier: "not a thing at all" },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Fix:");
  });

  it("create_note, link and create_card write files with the agent as origin", async () => {
    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: DOI,
      target: "library",
    });
    await finished(added.job);

    const note = await call<{ frontmatter: { id: string; created: { by: string } }; path: string }>(
      "create_note",
      {
        title: "Weak ties bridge groups",
        body: `Granovetter argues that weak ties carry new information. See [[${added.citekey}]].`,
        type: "permanent",
      },
    );
    expect(note.frontmatter.id).toMatch(/^n_/);
    expect(note.frontmatter.created.by).toBe(`agent:${CLIENT}`);
    expect(readFileSync(note.path, "utf8")).toContain("Weak ties bridge groups");

    const linked = await call<{
      frontmatter: { links: Array<{ to: string; rel: string; by: string }> };
    }>("link", {
      from: note.frontmatter.id,
      link: { to: `[[${added.citekey}]]`, rel: "supports", why: "the paper makes this claim" },
    });
    expect(linked.frontmatter.links).toHaveLength(1);
    expect(linked.frontmatter.links[0]).toMatchObject({ rel: "supports", by: `agent:${CLIENT}` });

    const quote = "Paragraph 1 of Introduction on printed page 10.";
    const card = await call<{
      card: { frontmatter: { id: string; created: { by: string } }; body: { quote: string } };
      job?: string;
    }>("create_card", {
      citekey: added.citekey,
      quote,
      anchor: { text: { exact: quote, prefix: "", suffix: "" } },
    });
    expect(card.card.frontmatter.id).toMatch(/^c_/);
    expect(card.card.frontmatter.created.by).toBe(`agent:${CLIENT}`);
    expect(card.card.body.quote).toBe(quote);
    expect(card.job).toMatch(/^j_/);

    // The AI job runs in the server and fills in the paraphrase.
    const job = await finished(card.job as string);
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    const listed = await call<{ cards: Array<{ body: { paraphrase?: string; quote: string } }> }>(
      "list_cards",
      { citekey: added.citekey },
    );
    expect(listed.cards[0]?.body.quote).toBe(quote);
    expect(listed.cards[0]?.body.paraphrase).toBeTruthy();

    const item = await call<ItemGet>("get_item", { citekey: added.citekey });
    expect(item.cards).toBe(1);
  });

  it("link refuses a target that does not exist and does not add a link twice", async () => {
    const note = await call<{ frontmatter: { id: string } }>("create_note", {
      title: "A note to link",
      type: "permanent",
    });
    const dangling = await client.callTool({
      name: "link",
      arguments: { from: note.frontmatter.id, link: { to: "[[nobody0000]]", rel: "supports" } },
    });
    expect(dangling.isError).toBe(true);
    expect(JSON.stringify(dangling.content)).toContain("LINK_TARGET_NOT_FOUND");

    const other = await call<{ frontmatter: { id: string } }>("create_note", {
      title: "The target note",
      type: "permanent",
    });
    const args = {
      from: note.frontmatter.id,
      link: { to: `[[${other.frontmatter.id}]]`, rel: "related" },
    };
    await call("link", args);
    const twice = await call<{ frontmatter: { links: unknown[] } }>("link", args);
    expect(twice.frontmatter.links).toHaveLength(1);
  });

  it("link takes a card as from and stores the link in the literature note of the card's item", async () => {
    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: DOI,
      target: "library",
    });
    await finished(added.job);
    const quote = "Paragraph 1 of Introduction on printed page 10.";
    const card = await call<{ card: { frontmatter: { id: string } } }>("create_card", {
      citekey: added.citekey,
      quote,
      anchor: { text: { exact: quote, prefix: "", suffix: "" } },
    });
    const target = await call<{ frontmatter: { id: string } }>("create_note", {
      title: "The argument it attacks",
      type: "permanent",
    });
    const cardId = card.card.frontmatter.id;
    const linked = await call<{
      frontmatter: {
        type: string;
        links: Array<{ from: string; to: string; rel: string; evidence: string; by: string }>;
      };
      body: string;
    }>("link", {
      from: cardId,
      link: { to: `[[${target.frontmatter.id}]]`, rel: "opposes", why: "it contradicts the note" },
    });
    expect(linked.frontmatter.type).toBe("literature");
    expect(linked.body).toContain(`Item: [[${added.citekey}]]`);
    expect(linked.frontmatter.links).toHaveLength(1);
    expect(linked.frontmatter.links[0]).toMatchObject({
      from: cardId,
      to: `[[${target.frontmatter.id}]]`,
      rel: "opposes",
      evidence: `[[${cardId}]]`,
      by: `agent:${CLIENT}`,
    });
  });

  it("create_card on a missing item and jobs_get on a missing job return errors with a fix", async () => {
    const card = await client.callTool({
      name: "create_card",
      arguments: {
        citekey: "nobody0000",
        quote: "text",
        anchor: { text: { exact: "text", prefix: "", suffix: "" } },
      },
    });
    expect(card.isError).toBe(true);
    expect(JSON.stringify(card.content)).toContain("Fix:");
    const job = await client.callTool({
      name: "jobs_get",
      arguments: { job: "j_01JB8Z3QK7ABCDEFGH" },
    });
    expect(job.isError).toBe(true);
  });

  it("create_project and get_project without a slug work, and a missing project names these tools", async () => {
    const missing = await client.callTool({
      name: "get_project",
      arguments: { slug: "phd-research" },
    });
    expect(missing.isError).toBe(true);
    const missingText = JSON.stringify(missing.content);
    expect(missingText).toContain("PROJECT_NOT_FOUND");
    expect(missingText).toContain("get_project");
    expect(missingText).toContain("create_project");
    expect(missingText).not.toMatch(/projects\.(list|context|create)/);

    const created = await call<{ frontmatter: { slug: string; title: string } }>("create_project", {
      slug: "phd-research",
      title: "PhD research",
      brief: "Loneliness and ethics.",
    });
    expect(created.frontmatter.slug).toBe("phd-research");
    const listed = await call<{ projects: Array<{ slug: string }> }>("get_project", {});
    expect(listed.projects.map((p) => p.slug)).toContain("phd-research");
    const got = await call<{ brief: string }>("get_project", { slug: "phd-research" });
    expect(got.brief).toContain("Loneliness");
  });

  it("get_project shows the reading list of the project, and add_item puts papers on it", async () => {
    await call("create_project", { slug: "reading-order", title: "Reading order", brief: "" });
    const empty = await call<{ reading: { total: number; entries: unknown[] } }>("get_project", {
      slug: "reading-order",
    });
    expect(empty.reading).toEqual({ total: 0, read: 0, entries: [] });

    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: "@book{readfirst, title={Read first}, author={Nobody, Nina}, year={2003}}",
      target: "library",
      projects: ["reading-order"],
    });
    await finished(added.job);
    const got = await call<{
      reading: {
        total: number;
        read: number;
        next?: { citekey: string; title: string };
        entries: { citekey: string; status: string }[];
      };
    }>("get_project", { slug: "reading-order" });
    expect(got.reading.total).toBe(1);
    expect(got.reading.read).toBe(0);
    expect(got.reading.next?.citekey).toBe(added.citekey);
    expect(got.reading.entries.map((e) => e.citekey)).toEqual([added.citekey]);
  });

  it("edit_reading_list moves, annotates and adds in one call, and checks everything first", async () => {
    await call("create_project", { slug: "edit-order", title: "Edit order", brief: "" });
    const keys: string[] = [];
    for (const [key, title] of [
      ["editone", "One"],
      ["edittwo", "Two"],
      ["editthree", "Three"],
    ] as const) {
      const added = await call<{ citekey: string; job: string }>("add_item", {
        identifier: `@book{${key}, title={${title}}, author={Nobody, Nina}, year={2004}}`,
        target: "library",
        projects: key === "editthree" ? [] : ["edit-order"],
      });
      await finished(added.job);
      keys.push(added.citekey);
    }
    const [one, two, three] = keys as [string, string, string];
    type Reading = { reading: { entries: { citekey: string; note?: string }[] }; added: string[] };
    const order = (r: Reading) => r.reading.entries.map((e) => e.citekey);

    const edited = await call<Reading>("edit_reading_list", {
      project: "edit-order",
      ops: [
        { op: "add", item: three, position: 0, note: "start here" },
        { op: "move", item: two, position: 0 },
        { op: "note", item: one, note: "bridge to the classic" },
      ],
    });
    expect(edited.added).toEqual([three]);
    expect(order(edited)).toEqual([two, three, one]);
    expect(edited.reading.entries.find((e) => e.citekey === three)?.note).toBe("start here");
    expect(edited.reading.entries.find((e) => e.citekey === one)?.note).toBe(
      "bridge to the classic",
    );

    const cleared = await call<Reading>("edit_reading_list", {
      project: "edit-order",
      ops: [{ op: "note", item: three, note: "" }],
    });
    expect(cleared.reading.entries.find((e) => e.citekey === three)?.note).toBeUndefined();

    // An invalid operation stops the whole call before anything changes.
    const refused = await client.callTool({
      name: "edit_reading_list",
      arguments: {
        project: "edit-order",
        ops: [
          { op: "move", item: one, position: 0 },
          { op: "move", item: "nobodyatall", position: 0 },
        ],
      },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("NOT_IN_READING_LIST");
    const after = await call<{ reading: { entries: { citekey: string }[] } }>("get_project", {
      slug: "edit-order",
    });
    expect(after.reading.entries.map((e) => e.citekey)).toEqual([two, three, one]);
  });

  it("trash_item removes what an agent added, records who did it and refuses the rest", async () => {
    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: "@book{trashme, title={Trash me}, author={Nobody, Nina}, year={2001}}",
    });
    await finished(added.job);
    const got = await call<ItemGet>("get_item", { citekey: added.citekey });
    expect(got.frontmatter.inbox?.by).toBe(`agent:${CLIENT}`);

    await call("trash_item", { citekey: added.citekey });
    const gone = await client.callTool({ name: "get_item", arguments: { citekey: added.citekey } });
    expect(gone.isError).toBe(true);
    const trashDir = join(root, ".trash");
    const dirs = readdirSync(trashDir).filter((d) => d.startsWith(`${added.citekey}-`));
    expect(dirs).toHaveLength(1);
    const record = JSON.parse(
      readFileSync(join(trashDir, dirs[0] ?? "", "trashed.json"), "utf8"),
    ) as { citekey: string; by: string };
    expect(record).toMatchObject({ citekey: added.citekey, by: `agent:${CLIENT}` });

    // An item the user put in the library stays: only the user removes it.
    const folder = join(root, "items", "usersowncopy");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "usersowncopy.md"),
      [
        "---",
        "id: 01JB8Z3QK7ABCDEFGHJKMNPQRS",
        "citekey: usersowncopy",
        "type: book",
        "title: The user's own copy",
        "created:",
        "  at: 2026-10-23T10:00:00Z",
        "  by: human",
        "---",
        "",
      ].join("\n"),
    );
    await waitFor("the watcher to index the item", async () => {
      const r = await client.callTool({ name: "get_item", arguments: { citekey: "usersowncopy" } });
      return r.isError ? undefined : true;
    });
    const refused = await client.callTool({
      name: "trash_item",
      arguments: { citekey: "usersowncopy" },
    });
    expect(refused.isError).toBe(true);
    const refusedText = JSON.stringify(refused.content);
    expect(refusedText).toContain("TRASH_NOT_ALLOWED");
    expect(refusedText).not.toMatch(/\bitems\.trash\b/);
  });

  it("attach_file adds a file to an existing item and converts it", async () => {
    const added = await call<{ citekey: string; job: string }>("add_item", {
      identifier: "@book{attachme, title={Attach me}, author={Nobody, Nina}, year={2002}}",
      target: "library",
    });
    await finished(added.job);
    const pdf = join(root, "..", "attach-me.pdf");
    writeFileSync(pdf, "%PDF-1.4\n% a file for the stub conversion worker\n%%EOF\n");
    const attached = await call<{ citekey: string; source: string; added: boolean; job?: string }>(
      "attach_file",
      { citekey: added.citekey, path: pdf },
    );
    expect(attached.added).toBe(true);
    const job = await finished(attached.job as string);
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    const item = await call<{
      frontmatter: { sources: Array<{ hash: string; added: { by: string } }> };
    }>("get_item", { citekey: added.citekey });
    expect(item.frontmatter.sources[0]?.hash).toBe(attached.source);
    expect(item.frontmatter.sources[0]?.added.by).toBe(`agent:${CLIENT}`);
  });

  it("indexes a note that is edited outside the server", async () => {
    writeFileSync(
      join(root, "notes", "edited-outside.md"),
      [
        "---",
        "id: n_01JB8Z3QK7ABCDEFGHJKMNPQRS",
        "type: permanent",
        "title: Quokkas edited outside",
        "links: []",
        "tags: []",
        "projects: []",
        "created:",
        "  at: 2026-10-23T10:00:00Z",
        "  by: human",
        "---",
        "A note written by hand in the folder.",
        "",
      ].join("\n"),
    );
    const hit = await waitFor("the watcher to index the file", async () => {
      const found = await call<{ hits: Array<{ title: string }> }>("search", { q: "quokkas" });
      return found.hits.find((h) => h.title.includes("Quokkas"));
    });
    expect(hit.title).toBe("Quokkas edited outside");
  });
});

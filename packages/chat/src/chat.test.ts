import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatChangePath } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "./service.js";
import { createHarness, fakeBackend, type Harness } from "./testing/harness.js";

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});
async function harness(...args: Parameters<typeof createHarness>): Promise<Harness> {
  const h = await createHarness(...args);
  open.push(h);
  return h;
}

const types = (h: Harness, session: string) => h.view(session).entries.map((e) => e.type);

describe("a chat turn with the fake ACP agent", () => {
  it("streams the answer and records the MCP tool call with its provenance", async () => {
    const h = await harness();
    const { session, turn } = await h.chat(
      [
        "Bitte hinzufuegen.",
        "@fake say Ich lege das Paper an.",
        '@fake mcp add_item {"identifier":"10.1086/225469","why":"Matches the question"}',
        "@fake say Fertig, siehe [[paper1|Granovetter 1973]].",
      ].join("\n"),
    );

    const view = h.view(session);
    expect(view.turns).toEqual([
      expect.objectContaining({ turn, status: "done", stopReason: "end_turn", edits: [] }),
    ]);
    expect(types(h, session)).toEqual(["user", "assistant", "tool", "assistant"]);
    const tool = view.entries.find((e) => e.type === "tool");
    expect(tool).toMatchObject({
      type: "tool",
      tool: "add_item",
      status: "done",
      kind: "other",
      detail: "10.1086/225469 (Matches the question) -> paper1",
    });
    expect(view.entries.at(-1)).toMatchObject({
      type: "assistant",
      text: "Fertig, siehe [[paper1|Granovetter 1973]].",
    });

    // The agent wrote through the citegeist MCP server, so the item carries the agent's name (docs/decisions/0014-agent-content-goes-to-inbox.md).
    expect(h.inbox).toEqual([
      expect.objectContaining({
        citekey: "paper1",
        by: "agent:fake-acp-agent",
        why: "Matches the question",
      }),
    ]);
    // Streaming goes through change events on the virtual path of the session.
    expect(h.events).toContain(chatChangePath(session));
    expect(h.events.filter((p) => p === chatChangePath(session)).length).toBeGreaterThan(2);
  });

  it("tells the agent about the session once and keeps it away from the user's settings", async () => {
    const h = await harness({
      backend: fakeBackend(
        {},
        {
          sessionMeta: () => ({
            claudeCode: { options: { settingSources: [], strictMcpConfig: true } },
          }),
        },
      ),
      host: { isolated: () => true },
    });
    const { session } = await h.chat("@fake report", {
      project: "phd",
      item: "luhmann1984soziale",
      selection: { citekey: "luhmann1984soziale", text: "Kommunikation ist ...", page: "31" },
    });
    const first = h.view(session).entries.find((e) => e.type === "assistant");
    const report = JSON.parse((first as { text: string }).text);
    expect(report.promptHasInstructions).toBe(true);
    expect(report.servers).toEqual(["citegeist"]);
    expect(report.cwd).toBe(join(h.localDir, "chats", session, "cwd"));
    expect(report.additionalDirectories).toEqual([h.root]);
    expect(report.meta).toEqual({
      claudeCode: { options: { settingSources: [], strictMcpConfig: true } },
    });
    expect(readFileSync(join(report.cwd, "AGENTS.md"), "utf8")).toContain("Scratch folder");

    await h.say(session, "@fake report");
    const second = h.view(session).entries.filter((e) => e.type === "assistant")[1];
    expect(JSON.parse((second as { text: string }).text).promptHasInstructions).toBe(false);
  });

  it("gives the agent the user's own environment by default and the sandbox on request", async () => {
    let isolated = false;
    const h = await harness({ host: { isolated: () => isolated } });
    const reports = (session: string) =>
      h
        .view(session)
        .entries.filter((e) => e.type === "assistant")
        .map((e) => JSON.parse((e as { text: string }).text));
    const { session } = await h.chat("@fake report");
    expect(reports(session)[0].meta).toEqual({ fake: { isolated: false } });

    // The setting changes between two turns: the next turn starts an agent in the sandbox and
    // briefs it again.
    isolated = true;
    await h.say(session, "@fake report");
    const second = reports(session)[1];
    expect(second.meta).toEqual({ fake: { isolated: true } });
    expect(second.promptHasInstructions).toBe(true);
  });

  it("runs research jobs in the sandbox whatever the setting says", async () => {
    const h = await harness({ host: { isolated: () => false } });
    const session = h.service.create({ backend: "fake", kind: "research" });
    h.service.send(session.id, "@fake report");
    await h.service.idle(session.id);
    const first = h.view(session.id).entries.find((e) => e.type === "assistant");
    expect(JSON.parse((first as { text: string }).text).meta).toEqual({ fake: { isolated: true } });
  });

  it("rejects shell commands and edits outside the library's text areas in the sandbox", async () => {
    const h = await harness({ host: { isolated: () => true } });
    const outside = join(h.root, "citegeist.json");
    const { session } = await h.chat(
      [
        "@fake shell rm -rf /",
        `@fake write ${outside} {}`,
        `@fake write ${join(h.root, "items/x/derived/a/doc.md")} x`,
      ].join("\n"),
    );
    const view = h.view(session);
    expect(view.entries.filter((e) => e.type === "notice")).toHaveLength(3);
    expect(view.entries.some((e) => e.type === "assistant" && e.text === "Shell rejected.")).toBe(
      true,
    );
    expect(existsSync(outside)).toBe(false);
    expect(view.turns[0]?.edits).toEqual([]);
  });

  it("can be cancelled while the agent works", async () => {
    const h = await harness();
    const s = h.service.create({ backend: "fake" });
    h.service.send(s.id, "@fake say Moment\n@fake wait");
    await waitFor(() => h.view(s.id).entries.some((e) => e.type === "assistant"));
    expect(h.service.get(s.id).session.running).toBe(true);
    // A second message while the agent works is refused with a fix.
    expect(() => h.service.send(s.id, "noch eins")).toThrow(/still answering/);
    h.service.cancel(s.id);
    await h.service.idle(s.id);
    expect(h.view(s.id).turns[0]).toMatchObject({ status: "cancelled" });
    expect(h.service.get(s.id).session.running).toBe(false);
    // The same session takes the next message.
    await h.say(s.id, "@fake say wieder da");
    expect(h.view(s.id).turns[1]).toMatchObject({ status: "done" });
  });

  it("stops a turn that is cancelled while the agent is still starting", async () => {
    const h = await harness();
    const s = h.service.create({ backend: "fake" });
    h.service.send(s.id, "@fake say Moment\n@fake wait");
    h.service.cancel(s.id);
    await h.service.idle(s.id);
    expect(h.view(s.id).turns[0]).toMatchObject({ status: "cancelled" });
    expect(types(h, s.id)).toEqual(["user"]);
  });

  it("reports a missing login with the fix", async () => {
    const h = await harness({ backend: fakeBackend({ FAKE_ACP_AUTH: "1" }) });
    const { session } = await h.chat("hallo");
    const view = h.view(session);
    expect(view.turns[0]).toMatchObject({ status: "failed" });
    expect(view.entries.at(-1)).toMatchObject({
      type: "notice",
      level: "error",
      text: expect.stringContaining("not logged in"),
      fix: expect.stringContaining("Log in"),
    });
  });

  it("rejects an unknown backend before it starts anything", async () => {
    const h = await harness();
    expect(() => h.service.create({ backend: "nope" })).toThrow(/No chat backend named nope/);
  });
});

describe("edits of an agent turn", () => {
  it("records created and modified files and undoes them with revertTurn", async () => {
    const h = await harness();
    const note = join(h.root, "notes", "idee.md");
    const existing = join(h.root, "notes", "alt.md");
    writeFileSync(existing, "---\ntitle: Alt\n---\nerste Zeile\nzweite Zeile\n");

    const { session, turn } = await h.chat(
      [
        `@fake write ${note} Neue Idee\\nmit Folgezeile`,
        `@fake write ${existing} ueberschrieben`,
      ].join("\n"),
    );
    expect(h.view(session).turns[0]?.edits).toEqual([
      { path: "notes/alt.md", change: "modified" },
      { path: "notes/idee.md", change: "created" },
    ]);
    expect(readFileSync(note, "utf8")).toBe("Neue Idee\nmit Folgezeile");

    const result = await h.service.revertTurn(session, turn);
    expect(result).toEqual({ restored: ["notes/idee.md", "notes/alt.md"].sort(), conflicts: [] });
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe(
      "---\ntitle: Alt\n---\nerste Zeile\nzweite Zeile\n",
    );
    expect(h.view(session).turns[0]?.reverted).toMatchObject({ restored: 2, conflicts: 0 });
    // The restored paths go out as change events, so the index follows.
    expect(h.events).toEqual(expect.arrayContaining(["notes/idee.md", "notes/alt.md"]));
    // A second undo is refused.
    await expect(h.service.revertTurn(session, turn)).rejects.toThrow(/already undone/);
  });

  it("merges a change Alex made after the turn and keeps conflicts untouched", async () => {
    const h = await harness();
    const merged = join(h.root, "notes", "merge.md");
    const clash = join(h.root, "notes", "clash.md");
    writeFileSync(merged, "a\nb\nc\nd\ne\n");
    writeFileSync(clash, "x\ny\nz\n");

    const { session, turn } = await h.chat(
      [
        `@fake write ${merged} a\\nB-agent\\nc\\nd\\ne\\n`,
        `@fake write ${clash} x\\nagent\\nz\\n`,
      ].join("\n"),
    );
    // Alex edits both files afterwards: one far from the agent's change, one on the same line.
    writeFileSync(merged, "a\nB-agent\nc\nd\nE-alex\n");
    writeFileSync(clash, "x\nalex\nz\n");

    const result = await h.service.revertTurn(session, turn);
    expect(result.restored).toEqual(["notes/merge.md"]);
    expect(result.conflicts).toEqual([
      { path: "notes/clash.md", reason: expect.stringContaining("same lines") },
    ]);
    expect(readFileSync(merged, "utf8")).toBe("a\nb\nc\nd\nE-alex\n");
    expect(readFileSync(clash, "utf8")).toBe("x\nalex\nz\n");
    // With conflicts left the turn counts as not fully undone and can be retried.
    expect(h.view(session).turns[0]?.reverted).toMatchObject({ restored: 1, conflicts: 1 });
  });

  it("does not count Alex's own edits between turns as agent edits", async () => {
    const h = await harness();
    const mine = join(h.root, "notes", "mine.md");
    const s = h.service.create({ backend: "fake" });
    h.service.send(s.id, "@fake say eins");
    await h.service.idle(s.id);
    mkdirSync(join(h.root, "notes"), { recursive: true });
    writeFileSync(mine, "von Hand");
    await h.say(s.id, "@fake say zwei");
    expect(h.view(s.id).turns.map((t) => t.edits)).toEqual([[], []]);
  });

  it("refuses to undo a turn without edits", async () => {
    const h = await harness();
    const { session, turn } = await h.chat("@fake say nichts geaendert");
    await expect(h.service.revertTurn(session, turn)).rejects.toThrow(/changed no files/);
    await expect(h.service.revertTurn(session, 9)).rejects.toThrow(/no turn 9/);
  });
});

describe("transcripts and persistence", () => {
  it("saves a transcript as chats/<date>-<slug>.md on request", async () => {
    const h = await harness({ host: { now: () => new Date("2026-10-24T10:00:00Z") } });
    const { session } = await h.chat(
      "Fass Luhmann zusammen\n@fake say Kurz: [[luhmann1984soziale|Luhmann 1984]]",
    );
    const saved = h.service.save(session);
    expect(saved.path).toMatch(/^chats\/2026-10-24-fass-luhmann-zusammen/);
    const text = readFileSync(join(h.root, ...saved.path.split("/")), "utf8");
    expect(text).toContain("type: chat");
    expect(text).toContain("[[luhmann1984soziale|Luhmann 1984]]");
    expect(text).toContain("## User");
    expect(h.view(session).session.saved).toBe(saved.path);
    expect(h.events).toContain(saved.path);
    // Saving again returns the same file.
    expect(h.service.save(session)).toEqual(saved);
  });

  it("tells the host when the agent of a session is gone, so it can revoke the token (M7)", async () => {
    const released: string[] = [];
    const h = await harness({ host: { release: (session) => released.push(session) } });
    const { session } = await h.chat("@fake say eins");
    expect(released).toEqual([]);
    await h.service.end(session);
    expect(released).toEqual([session]);
    // The next turn starts a new agent, which asks the host for new credentials.
    await h.service.run(session, "@fake say zwei");
    await h.service.close();
    expect(released).toEqual([session, session]);
  });

  it("keeps sessions across a restart", async () => {
    const h = await harness();
    const { session } = await h.chat("@fake say bleibt");
    await h.service.close();
    const again = new ChatService(
      { libraryRoot: h.root, localDir: h.localDir, mcpServers: () => [], notify: () => {} },
      { drivers: h.service.drivers },
    );
    const listed = again.list({ limit: 10 });
    expect(listed.map((s) => s.id)).toEqual([session]);
    expect(again.get(session).entries.map((e) => e.type)).toEqual(["user", "assistant"]);
    expect(again.list({ project: "other", limit: 10 })).toEqual([]);
  });
});

async function waitFor(probe: () => boolean, what = "condition"): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

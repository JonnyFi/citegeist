import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatEntry, CONTRACTS } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { bindChatOperations } from "./ops.js";
import { createHarness, type Harness } from "./testing/harness.js";

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});

describe("chat operations", () => {
  it("are listed with the other contracts and reachable through the registry", async () => {
    expect(CONTRACTS.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "chat.start",
        "chat.send",
        "chat.cancel",
        "chat.list",
        "chat.get",
        "chat.revertTurn",
        "chat.save",
        "chat.backends",
      ]),
    );
    // Agents do not drive chats: no chat operation is an MCP tool.
    expect(CONTRACTS.filter((c) => c.name.startsWith("chat.") && c.mcp)).toEqual([]);
  });

  it("run a full conversation, undo included, through the registry", async () => {
    const h = await createHarness();
    open.push(h);
    bindChatOperations(h.registry, { service: h.service });
    const call = <T>(name: string, input: unknown) =>
      h.registry.call(name, { actor: "human" }, input) as Promise<T>;

    const backends = await call<{
      default: string;
      backends: Array<{ id: string; available: boolean }>;
    }>("chat.backends", {});
    expect(backends).toMatchObject({
      default: "fake",
      backends: [{ id: "fake", available: true }],
    });

    const { session } = await call<{ session: { id: string; title: string; project?: string } }>(
      "chat.start",
      {
        backend: "fake",
        project: "phd",
        item: "luhmann1984soziale",
        selection: { citekey: "luhmann1984soziale", text: "Kommunikation", page: "31" },
      },
    );
    expect(session).toMatchObject({ title: "New chat", project: "phd" });

    const note = join(h.root, "notes", "festgehalten.md");
    const { turn } = await call<{ turn: number }>("chat.send", {
      session: session.id,
      message: `Halte das fest.\n@fake write ${note} Verbindung A und B\n@fake say Notiert in [[festgehalten|Notiz]].`,
    });
    expect(turn).toBe(1);
    const view = await settled(call, session.id);
    expect(view.session.title).toMatch(/^Halte das fest\./);
    expect(view.context).toEqual({
      project: "phd",
      item: "luhmann1984soziale",
      selection: { citekey: "luhmann1984soziale", text: "Kommunikation", page: "31" },
    });
    expect(view.turns[0]).toMatchObject({
      status: "done",
      edits: [{ path: "notes/festgehalten.md", change: "created" }],
    });
    expect(view.entries[0]).toMatchObject({ type: "user", context: { project: "phd" } });

    const listed = await call<{ sessions: Array<{ id: string; turns: number }> }>("chat.list", {
      project: "phd",
    });
    expect(listed.sessions).toEqual([expect.objectContaining({ id: session.id, turns: 1 })]);

    const undone = await call<{ restored: string[]; conflicts: unknown[] }>("chat.revertTurn", {
      session: session.id,
      turn: 1,
    });
    expect(undone).toEqual({ restored: ["notes/festgehalten.md"], conflicts: [] });
    expect(existsSync(note)).toBe(false);

    const saved = await call<{ path: string }>("chat.save", { session: session.id });
    expect(saved.path).toMatch(/^chats\/\d{4}-\d{2}-\d{2}-halte-das-fest/);
    expect(existsSync(join(h.root, saved.path))).toBe(true);

    // Errors come back as agent-ready errors with a stable code.
    await expect(
      call("chat.get", { session: "ch_00000000000000000000000000" }),
    ).rejects.toMatchObject({
      detail: { code: "CHAT_SESSION_NOT_FOUND" },
    });
  });

  it("let a later message change the context", async () => {
    const h = await createHarness();
    open.push(h);
    bindChatOperations(h.registry, { service: h.service });
    const call = <T>(name: string, input: unknown) =>
      h.registry.call(name, { actor: "human" }, input) as Promise<T>;
    const { session } = await call<{ session: { id: string } }>("chat.start", { backend: "fake" });
    writeFileSync(join(h.root, "notes", "x.md"), "x");
    await call("chat.send", {
      session: session.id,
      message: "@fake report",
      context: { item: "gillespie2018custodians" },
    });
    const view = await settled(call, session.id);
    expect(view.context).toEqual({ item: "gillespie2018custodians" });
  });
});

async function settled(
  call: <T>(name: string, input: unknown) => Promise<T>,
  session: string,
): Promise<{
  session: { running: boolean; title: string };
  context: unknown;
  entries: ChatEntry[];
  turns: Array<{ status: string; edits: unknown[] }>;
}> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const view = await call<Awaited<ReturnType<typeof settled>>>("chat.get", { session });
    if (!view.session.running && view.turns.every((t) => t.status !== "running")) return view;
    if (Date.now() > deadline) throw new Error("the turn did not finish");
    await new Promise((r) => setTimeout(r, 20));
  }
}

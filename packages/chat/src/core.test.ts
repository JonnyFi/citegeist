import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cannedAiBackend,
  createRuntime,
  createStubWorker,
  Library,
  type Runtime,
} from "@citegeist/core";
import { startMcpHttpServer } from "@citegeist/mcp";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrivers } from "./drivers.js";
import { ChatService } from "./service.js";
import { fakeBackend } from "./testing/harness.js";

/**
 * The chat against the real core: the fake agent writes a note through the citegeist MCP server,
 * the journal sees the file the core wrote, and the undo removes it again.
 */

let base: string;
let lib: Library;
let runtime: Runtime;
let service: ChatService;
let closeMcp: () => Promise<void>;
const events: string[] = [];

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "citegeist-chat-core-"));
  lib = await Library.init(join(base, "library"), { localBase: join(base, "app"), watch: false });
  const metadataDir = fileURLToPath(new URL("../../../fixtures/metadata/http", import.meta.url));
  runtime = createRuntime(lib, {
    worker: createStubWorker(),
    resolver: createResolver({
      config: { mailto: "tester@example.invalid" },
      fetch: createReplayFetch(metadataDir),
      sleep: async () => {},
    }),
    ai: { backends: [cannedAiBackend()] },
    autoStart: false,
  });
  const mcp = await startMcpHttpServer(runtime.registry, {
    tokens: [{ token: "core-token", scope: "write" }],
  });
  closeMcp = () => mcp.close();
  service = new ChatService(
    {
      libraryRoot: lib.root,
      localDir: lib.local.dir,
      mcpServers: () => [
        {
          type: "http",
          name: "citegeist",
          url: mcp.url,
          headers: [{ name: "Authorization", value: "Bearer core-token" }],
        },
      ],
      notify: (p) => events.push(p),
    },
    {
      drivers: createDrivers({
        workspaceRoot: join(lib.local.dir, "agent-workspace"),
        backends: [fakeBackend()],
      }),
    },
  );
});

afterAll(async () => {
  await service.close();
  await closeMcp();
  await runtime.close();
  await lib.close();
  rmSync(base, { recursive: true, force: true });
});

describe("chat against the real core", () => {
  it("records a note the agent wrote through MCP and undoes it", async () => {
    const s = service.create({ backend: "fake", project: "phd" });
    service.send(
      s.id,
      [
        "Halte das fest.",
        `@fake mcp create_note ${JSON.stringify({ title: "Idee aus dem Chat", type: "permanent", body: "A und B hängen zusammen." })}`,
      ].join("\n"),
    );
    await service.idle(s.id);

    const view = service.get(s.id);
    expect(view.entries.find((e) => e.type === "tool")).toMatchObject({
      tool: "create_note",
      status: "done",
    });
    const edit = view.turns[0]?.edits[0];
    expect(view.turns[0]?.edits).toHaveLength(1);
    expect(edit).toMatchObject({
      change: "created",
      path: expect.stringMatching(/^notes\/.*\.md$/),
    });
    const file = join(lib.root, ...(edit?.path ?? "").split("/"));
    // The core stamped the note with the agent that wrote it.
    expect(readFileSync(file, "utf8")).toContain("agent:fake-acp-agent");
    lib.sync();
    expect(lib.status().notes).toBe(1);

    const result = await service.revertTurn(s.id, 1);
    expect(result.conflicts).toEqual([]);
    expect(existsSync(file)).toBe(false);
    // The restored path is announced, and the index follows once it sees the change.
    expect(events).toContain(edit?.path);
    lib.sync();
    expect(lib.status().notes).toBe(0);
  });

  it("merges Jonny's later edit into the undo of a note change", async () => {
    const created = (await runtime.registry.call(
      "notes.create",
      { actor: "human" },
      { title: "Gemeinsame Notiz", type: "permanent", body: "eins\nzwei\ndrei\nvier\nfünf" },
    )) as { path: string };
    const file = created.path;
    const rel = relative(lib.root, file);
    const original = readFileSync(file, "utf8");

    const s = service.create({ backend: "fake" });
    service.send(
      s.id,
      `Formuliere das aus.\n@fake write ${file} ${original.replace(/\n/g, "\\n").replace("zwei", "ZWEI-agent")}`,
    );
    await service.idle(s.id);
    expect(service.get(s.id).turns[0]?.edits).toEqual([{ path: rel, change: "modified" }]);

    // Jonny adds a line at the end after the agent's turn.
    writeFileSync(file, `${readFileSync(file, "utf8")}\nsechs von Jonny`);
    const result = await service.revertTurn(s.id, 1);
    expect(result.conflicts).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(`${original}\nsechs von Jonny`);
  });
});

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_CODE } from "./backends.js";
import { createDrivers } from "./drivers.js";
import { ClaudePrintDriver, mcpConfigJson } from "./print-driver.js";
import { ChatService } from "./service.js";

// A stand-in for the `claude` binary: logs its arguments and prompt, then streams a canned reply
// in the stream-json format of `claude -p`.
const FAKE_CLAUDE = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), input }) + "\\n");
  if (/FAIL LOGIN/.test(input)) {
    console.log(JSON.stringify({ type: "result", is_error: true, result: "Not logged in. Please run /login" }));
    process.exit(1);
  }
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: "system", subtype: "init" });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hallo " } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Welt" } } });
  out({ type: "assistant", message: { content: [{ type: "text", text: "Hallo Welt" }, { type: "tool_use", id: "t1", name: "mcp__citegeist__search", input: { q: "systeme" } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  out({ type: "result", subtype: "success", is_error: false, result: "Hallo Welt" });
});
`;

let base: string;
let logFile: string;
let service: ChatService;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "citegeist-fallback-"));
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
  logFile = join(base, "claude.log");
  process.env.FAKE_CLAUDE_LOG = logFile;
  mkdirSync(join(base, "library"));
  service = new ChatService(
    {
      libraryRoot: join(base, "library"),
      localDir: join(base, "local"),
      mcpServers: () => [
        {
          type: "http",
          name: "citegeist",
          url: "http://127.0.0.1:1/mcp",
          headers: [{ name: "Authorization", value: "Bearer x" }],
        },
      ],
      notify: () => {},
      isolated: () => true,
    },
    {
      drivers: createDrivers({
        workspaceRoot: join(base, "local", "agent-workspace"),
        // The adapter cannot start: its launcher does not exist.
        backends: [
          { ...CLAUDE_CODE, launch: () => ({ command: join(base, "no-such-adapter"), args: [] }) },
        ],
        find: (name) => (name === "claude" ? join(bin, "claude") : undefined),
        handshakeTimeoutMs: 5000,
      }),
    },
  );
});

afterEach(async () => {
  await service.close();
  delete process.env.FAKE_CLAUDE_LOG;
  rmSync(base, { recursive: true, force: true });
});

const calls = () =>
  readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { args: string[]; input: string });

describe("claude -p fallback", () => {
  it("takes over when the ACP adapter does not start, streams the answer and keeps the session", async () => {
    const s = service.create({ backend: "claude-code" });
    service.send(s.id, "Was ist ein System?");
    await service.idle(s.id);

    const view = service.get(s.id);
    expect(view.turns[0]).toMatchObject({ status: "done" });
    expect(view.entries.map((e) => e.type)).toEqual(["user", "notice", "assistant", "tool"]);
    expect(view.entries[1]).toMatchObject({
      type: "notice",
      level: "info",
      text: expect.stringContaining("claude -p"),
    });
    expect(view.entries[2]).toMatchObject({ type: "assistant", text: "Hallo Welt" });
    expect(view.entries[3]).toMatchObject({
      type: "tool",
      tool: "search",
      status: "done",
      kind: "other",
      detail: "systeme",
    });

    const [first] = calls();
    expect(first?.input).toContain("You work inside citegeist");
    expect(first?.input).toContain("Was ist ein System?");
    // Isolation flags: no user settings, only citegeist's MCP server, no shell.
    const args = first?.args ?? [];
    expect(args).toEqual(
      expect.arrayContaining(["-p", "--strict-mcp-config", "--disable-slash-commands"]),
    );
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(
      args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--disallowedTools") + 4),
    ).toEqual(["Bash", "BashOutput", "KillShell"]);
    expect(args).toContain("--session-id");

    // The second turn continues the same Claude session.
    service.send(s.id, "Und weiter?");
    await service.idle(s.id);
    const second = calls()[1];
    expect(second?.args).toContain("--resume");
    expect(second?.args[second.args.indexOf("--resume") + 1]).toBe(
      first?.args[(first?.args.indexOf("--session-id") ?? 0) + 1],
    );
    expect(second?.input).not.toContain("You work inside citegeist");
  });

  it("explains a missing login", async () => {
    const s = service.create({ backend: "claude-code" });
    service.send(s.id, "FAIL LOGIN");
    await service.idle(s.id);
    const last = service.get(s.id).entries.at(-1);
    expect(last).toMatchObject({
      type: "notice",
      level: "error",
      fix: expect.stringContaining("claude auth login"),
    });
  });
});

describe("mcpConfigJson", () => {
  it("converts ACP server entries to Claude Code's config", () => {
    const json = JSON.parse(
      mcpConfigJson([
        {
          type: "http",
          name: "citegeist",
          url: "http://127.0.0.1:9/mcp",
          headers: [{ name: "Authorization", value: "Bearer t" }],
        },
        { name: "local", command: "cg", args: ["mcp"], env: [{ name: "A", value: "1" }] },
      ]),
    );
    expect(json).toEqual({
      mcpServers: {
        citegeist: {
          type: "http",
          url: "http://127.0.0.1:9/mcp",
          headers: { Authorization: "Bearer t" },
        },
        local: { command: "cg", args: ["mcp"], env: { A: "1" } },
      },
    });
  });
});

describe("ClaudePrintDriver", () => {
  it("leaves out the edit tools in a research job", () => {
    const driver = new ClaudePrintDriver({
      command: "claude",
      env: {},
      req: {
        session: "ch_1",
        mode: "research",
        cwd: "/tmp",
        libraryRoot: "/lib",
        mcpServers: [],
        directEdits: false,
        isolated: true,
      },
    });
    const args = driver.buildArgs();
    expect(args).toEqual(expect.arrayContaining(["Edit", "Write", "MultiEdit", "NotebookEdit"]));
    expect(args).not.toContain("--add-dir");
  });

  const chatReq = (isolated: boolean) => ({
    session: "ch_1",
    mode: "chat" as const,
    cwd: "/tmp",
    libraryRoot: "/lib",
    mcpServers: [],
    directEdits: true,
    isolated,
  });

  it("keeps the sandbox flags when the chat is isolated", () => {
    const args = new ClaudePrintDriver({
      command: "claude",
      env: {},
      req: chatReq(true),
    }).buildArgs();
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args).toEqual(expect.arrayContaining(["--disallowedTools", "Bash"]));
  });

  it("loads the user's settings and allows the shell when the chat is not isolated (A11)", () => {
    const args = new ClaudePrintDriver({
      command: "claude",
      env: {},
      req: chatReq(false),
    }).buildArgs();
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--disable-slash-commands");
    expect(args).not.toContain("--disallowedTools");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("user,project");
    expect(args).toEqual(expect.arrayContaining(["--allowedTools", "mcp__citegeist", "Bash"]));
    expect(args).toContain("--mcp-config");
  });
});

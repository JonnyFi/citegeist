// Manual check of a real agent through ACP. It costs a few thousand tokens of the user's own
// subscription, so it never runs in CI:
//
//   pnpm --filter @citegeist/chat smoke claude-code
//   pnpm --filter @citegeist/chat smoke codex
//   pnpm --filter @citegeist/chat smoke cursor
//
// It starts a temporary library folder with a stand-in citegeist MCP server that only knows
// add_item, opens a chat session with the named backend and asks the agent to call that tool once.
// A pass shows: the adapter starts, the login works, the MCP server reaches the agent, the
// permission policy answers, and the call lands in the inbox under the agent's name.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMcpHttpServer } from "@citegeist/mcp";
import { ChatService } from "../service.js";
import { miniRegistry } from "./harness.js";

const backend = process.argv[2] ?? "claude-code";
const base = mkdtempSync(join(tmpdir(), "citegeist-smoke-"));
const root = join(base, "library");
for (const d of ["items", "notes", "projects", "chats"])
  mkdirSync(join(root, d), { recursive: true });

const mini = miniRegistry();
const mcp = await startMcpHttpServer(mini.registry, {
  tokens: [{ token: "smoke", scope: "write" }],
});
const service = new ChatService({
  libraryRoot: root,
  localDir: join(base, "local"),
  mcpServers: () => [
    {
      type: "http",
      name: "citegeist",
      url: mcp.url,
      headers: [{ name: "Authorization", value: "Bearer smoke" }],
    },
  ],
  notify: () => {},
});

const started = Date.now();
try {
  const status = (await service.backends()).backends.find((b) => b.id === backend);
  console.log(`backend ${backend}:`, JSON.stringify(status));
  const session = service.create({ backend });
  // A second argument replaces the prompt, e.g. to try a file write outside the library.
  service.send(
    session.id,
    process.argv[3] ??
      'Call the add_item tool exactly once with identifier "10.1086/225469" and why "smoke test". Then reply with the single word DONE.',
  );
  await service.idle(session.id);
  const view = service.get(session.id);
  for (const e of view.entries) console.log(JSON.stringify(e));
  console.log("turn:", JSON.stringify(view.turns[0]));
  console.log("inbox:", JSON.stringify(mini.inbox));
  console.log(`seconds: ${((Date.now() - started) / 1000).toFixed(1)}`);
  const ok =
    view.turns[0]?.status === "done" && (process.argv[3] !== undefined || mini.inbox.length === 1);
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
} finally {
  await service.close();
  await mcp.close();
  rmSync(base, { recursive: true, force: true });
}

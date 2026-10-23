// A scripted ACP agent for tests, spawned as `node --import tsx fake-acp-agent.ts`. It speaks the
// agent side of ACP over stdio and plays the directives it finds in the prompt, one per line:
//
//   @fake say <text>                    stream an answer in two chunks
//   @fake mcp <tool> <json>             call a tool of the first MCP server of the session
//   @fake write <abs path> <text>       write a file directly (\n in the text becomes a line break)
//   @fake shell <command>               ask for permission to run a command (never runs it)
//   @fake report                        stream what session/new received, as JSON
//   @fake wait                          block until the client cancels
//
// Every tool call and file write asks the client for permission first and honours the answer.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

interface FakeSession {
  cwd: string;
  additionalDirectories: string[];
  mcpServers: acp.McpServer[];
  meta: unknown;
  cancelled: boolean;
  mcp?: Client;
}

const sessions = new Map<string, FakeSession>();
let counter = 0;
const log = process.env.FAKE_ACP_LOG;

function note(line: string): void {
  if (log) appendFileSync(log, `${line}\n`);
}

async function mcpClient(session: FakeSession): Promise<Client> {
  if (session.mcp) return session.mcp;
  const server = session.mcpServers[0];
  if (!server || !("url" in server)) throw new Error("the session has no http MCP server");
  const client = new Client({ name: "fake-acp-agent", version: "1.0.0" });
  const headers = Object.fromEntries(server.headers.map((h) => [h.name, h.value]));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }),
  );
  session.mcp = client;
  return client;
}

const app = acp.agent({ name: "fake-acp-agent" });

app.onRequest(acp.methods.agent.initialize, async () => {
  note("initialize");
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      mcpCapabilities: { http: true },
      sessionCapabilities: { additionalDirectories: {}, close: {} },
    },
    authMethods: [],
  };
});

app.onRequest(acp.methods.agent.session.new, async ({ params }) => {
  if (process.env.FAKE_ACP_AUTH === "1") {
    throw new acp.RequestError(-32000, "Authentication required");
  }
  const sessionId = `fake-${++counter}`;
  sessions.set(sessionId, {
    cwd: params.cwd,
    additionalDirectories: params.additionalDirectories ?? [],
    mcpServers: params.mcpServers,
    meta: params._meta ?? null,
    cancelled: false,
  });
  note(`session/new ${sessionId}`);
  return { sessionId };
});

app.onRequest(acp.methods.agent.session.close, async ({ params }) => {
  const s = sessions.get(params.sessionId);
  await s?.mcp?.close();
  sessions.delete(params.sessionId);
  note(`session/close ${params.sessionId}`);
});

app.onNotification(acp.methods.agent.session.cancel, ({ params }) => {
  const s = sessions.get(params.sessionId);
  if (s) s.cancelled = true;
  note(`session/cancel ${params.sessionId}`);
});

function textOf(prompt: acp.ContentBlock[]): string {
  return prompt.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

app.onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`unknown session ${params.sessionId}`);
  session.cancelled = false;
  const sid = params.sessionId;
  const update = (u: acp.SessionUpdate) =>
    client.notify(acp.methods.client.session.update, { sessionId: sid, update: u });
  const say = async (text: string) => {
    const mid = Math.ceil(text.length / 2);
    for (const part of [text.slice(0, mid), text.slice(mid)]) {
      if (part) {
        await update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: part },
        });
      }
    }
  };
  const ask = async (
    toolCallId: string,
    call: Partial<acp.ToolCall> & { title: string },
  ): Promise<boolean> => {
    const res = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: sid,
      toolCall: { toolCallId, ...call },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
    return res.outcome.outcome === "selected" && res.outcome.optionId === "allow";
  };

  const text = textOf(params.prompt);
  note(`prompt ${text.length} chars`);
  let call = 0;
  for (const line of text.split("\n")) {
    const m = /^@fake (\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, cmd = "", rest = ""] = m;
    if (session.cancelled) return { stopReason: "cancelled" };
    const id = `call-${sid}-${++call}`;
    switch (cmd) {
      case "say":
        await say(rest);
        break;
      case "mcp": {
        const space = rest.indexOf(" ");
        const tool = space < 0 ? rest : rest.slice(0, space);
        const args =
          space < 0 ? {} : (JSON.parse(rest.slice(space + 1)) as Record<string, unknown>);
        const name = `mcp__citegeist__${tool}`;
        const base = { title: name, name, kind: "other" as const, rawInput: args };
        await update({ sessionUpdate: "tool_call", toolCallId: id, status: "pending", ...base });
        if (!(await ask(id, base))) {
          await update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed" });
          await say(`The call to ${tool} was rejected.`);
          break;
        }
        await update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "in_progress" });
        const client2 = await mcpClient(session);
        const result = await client2.callTool({ name: tool, arguments: args });
        const out = result.structuredContent ?? result.content;
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: result.isError ? "failed" : "completed",
          rawOutput: out,
        });
        // A model needs a moment before its next step; a cancel sent meanwhile is seen in time.
        await new Promise((r) => setTimeout(r, 40));
        break;
      }
      case "write": {
        const space = rest.indexOf(" ");
        const path = space < 0 ? rest : rest.slice(0, space);
        const body = (space < 0 ? "" : rest.slice(space + 1)).replace(/\\n/g, "\n");
        const base = {
          title: `Write ${path}`,
          kind: "edit" as const,
          locations: [{ path }],
          rawInput: { file_path: path },
        };
        await update({ sessionUpdate: "tool_call", toolCallId: id, status: "pending", ...base });
        if (!(await ask(id, base))) {
          await update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed" });
          await say(`Writing ${path} was rejected.`);
          break;
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, body);
        await update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });
        break;
      }
      case "shell": {
        const base = {
          title: `Bash ${rest}`,
          kind: "execute" as const,
          rawInput: { command: rest },
        };
        await update({ sessionUpdate: "tool_call", toolCallId: id, status: "pending", ...base });
        const allowed = await ask(id, base);
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: allowed ? "completed" : "failed",
        });
        await say(allowed ? "Shell allowed." : "Shell rejected.");
        break;
      }
      case "report":
        await say(
          JSON.stringify({
            cwd: session.cwd,
            additionalDirectories: session.additionalDirectories,
            servers: session.mcpServers.map((s) => s.name),
            meta: session.meta,
            promptHasInstructions: /You work inside citegeist/.test(text),
          }),
        );
        break;
      case "wait":
        while (!session.cancelled) await new Promise((r) => setTimeout(r, 20));
        return { stopReason: "cancelled" };
      default:
        await say(`unknown directive ${cmd}`);
    }
  }
  return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
});

const connection = app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
);
await connection.closed;

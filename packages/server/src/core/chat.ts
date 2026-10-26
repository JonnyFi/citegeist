import { join } from "node:path";
import {
  bindChatOperations,
  ChatService,
  createDrivers,
  DEFAULT_BACKENDS,
  type DriverFactoryOptions,
  type SessionMode,
} from "@citegeist/chat";
import type { ChangeEvent, KindPort, Library, Runtime } from "@citegeist/core";
import {
  generateToken,
  type McpHttpHandle,
  type McpTokenGrant,
  startMcpHttpServer,
} from "@citegeist/mcp";

/** Overrides for the chat of a core: other backends or another way to find executables (tests). */
export type ChatOptions = Omit<DriverFactoryOptions, "workspaceRoot">;

export interface ChatRuntime {
  service: ChatService;
  mcp: McpHttpHandle;
  close(): Promise<void>;
}

/**
 * Chat backend that follows the routing setting: the AI routing names inference backends such as
 * `claude-code-cli`, the chat knows `claude-code` and `codex`. A routing entry that starts with a
 * chat backend id selects it.
 */
export function chatBackendFromRouting(
  routing: Record<string, string>,
  ids: readonly string[],
): string | undefined {
  const target = routing["*"];
  if (!target) return undefined;
  return ids.find((id) => target === id || target.startsWith(`${id}-`));
}

/**
 * One ChatService per library. The agents reach the library through the citegeist MCP server on
 * loopback. Every chat session gets an own write token, so the token of one session is useless
 * for another and nothing outside a session knows it. A token lives as long as the agent it was
 * handed to: the chat service revokes it when that agent is closed, replaced or has crashed, and a
 * research job ends its session when it is done. Research tokens never allow local files (M4), change nothing but the inbox (`add_item`) and
 * open no address outside the scholarly hosts.
 *
 * Research jobs run on `research`, a port of the shared job kind "research" (webhook tasks use the
 * same kind). Without one, the chat registers the kind on the runtime's queue itself.
 */
export async function startChat(
  library: Library,
  runtime: Runtime,
  opts: ChatOptions = {},
  research?: KindPort<"research">,
): Promise<ChatRuntime> {
  // The MCP server needs one grant to start. This one is never handed out.
  const tokens: McpTokenGrant[] = [{ token: generateToken(), scope: "read" }];
  const bySession = new Map<string, string>();
  const mcp = await startMcpHttpServer(runtime.registry, { tokens });

  const tokenFor = (session: string, mode: SessionMode): string => {
    let token = bySession.get(session);
    if (!token) {
      token = generateToken();
      bySession.set(session, token);
      // A research job reads untrusted web pages: its token is the research scope (the read tools
      // and add_item, no local files, no addresses outside the scholarly hosts).
      tokens.push(
        mode === "research"
          ? { token, scope: "research", localFiles: false }
          : { token, scope: "write" },
      );
    }
    return token;
  };
  // The server reads `tokens` on every request, so removing an entry revokes it at once.
  const release = (session: string): void => {
    const token = bySession.get(session);
    if (token === undefined) return;
    bySession.delete(session);
    const at = tokens.findIndex((g) => g.token === token);
    if (at >= 0) tokens.splice(at, 1);
  };

  const backends = opts.backends ?? DEFAULT_BACKENDS;
  const service = new ChatService(
    {
      libraryRoot: library.root,
      localDir: library.local.dir,
      mcpServers: ({ session, mode }) => [
        {
          type: "http",
          name: "citegeist",
          url: mcp.url,
          headers: [{ name: "Authorization", value: `Bearer ${tokenFor(session, mode)}` }],
        },
      ],
      release,
      // Streaming text and restored files reach the UI as the core's change events. The status
      // keeps the semantic index from scheduling work for a virtual chat path.
      notify: (rel) =>
        library.emit("change", { rel, status: "unchanged", external: false } satisfies ChangeEvent),
      isolated: () => runtime.settings.chatIsolated(),
      researchBudget: () => runtime.settings.researchBudget(),
      recordUsage: (e) => {
        try {
          // A research turn counts for whoever started the job, a chat for the person at the app.
          const queue = research ?? runtime.ingest.queue;
          const actor = e.job ? (queue.get(e.job)?.by ?? "system") : "human";
          runtime.usage.record({
            source: e.kind,
            task: e.kind,
            backend: e.backend,
            model: e.usage?.model ?? "",
            inputTokens: e.usage?.inputTokens ?? 0,
            outputTokens: e.usage?.outputTokens ?? 0,
            cacheReadTokens: e.usage?.cacheReadTokens ?? 0,
            cacheWriteTokens: e.usage?.cacheWriteTokens ?? 0,
            costUsd: e.usage?.costUsd,
            ms: e.ms,
            ok: e.ok,
            actor,
            session: e.session,
            job: e.job,
          });
        } catch {
          // The ledger is a report, not part of the chat.
        }
      },
      defaultBackend: () =>
        chatBackendFromRouting(
          runtime.settings.routing().routing,
          backends.map((b) => b.id),
        ),
    },
    {
      drivers: createDrivers({
        ...opts,
        backends,
        workspaceRoot: join(library.local.dir, "agent-workspace"),
      }),
    },
  );
  bindChatOperations(runtime.registry, { service, queue: research ?? runtime.ingest.queue });

  return {
    service,
    mcp,
    async close() {
      await service.close();
      await mcp.close();
    },
  };
}

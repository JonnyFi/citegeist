import { join } from "node:path";
import {
  bindChatOperations,
  ChatService,
  createDrivers,
  DEFAULT_BACKENDS,
  type DriverFactoryOptions,
} from "@citegeist/chat";
import type { ChangeEvent, Library, Runtime } from "@citegeist/core";
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
 * for another and nothing outside a session knows it. The tokens live as long as the core.
 */
export async function startChat(
  library: Library,
  runtime: Runtime,
  opts: ChatOptions = {},
): Promise<ChatRuntime> {
  // The MCP server needs one grant to start. This one is never handed out.
  const tokens: McpTokenGrant[] = [{ token: generateToken(), scope: "read" }];
  const bySession = new Map<string, string>();
  const mcp = await startMcpHttpServer(runtime.registry, { tokens });

  const tokenFor = (session: string): string => {
    let token = bySession.get(session);
    if (!token) {
      token = generateToken();
      bySession.set(session, token);
      tokens.push({ token, scope: "write" });
    }
    return token;
  };

  const backends = opts.backends ?? DEFAULT_BACKENDS;
  const service = new ChatService(
    {
      libraryRoot: library.root,
      localDir: library.local.dir,
      mcpServers: ({ session }) => [
        {
          type: "http",
          name: "citegeist",
          url: mcp.url,
          headers: [{ name: "Authorization", value: `Bearer ${tokenFor(session)}` }],
        },
      ],
      // Streaming text and restored files reach the UI as the core's change events. The status
      // keeps the semantic index from scheduling work for a virtual chat path.
      notify: (rel) =>
        library.emit("change", { rel, status: "unchanged", external: false } satisfies ChangeEvent),
      isolated: () => runtime.settings.chatIsolated(),
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
  bindChatOperations(runtime.registry, { service, queue: runtime.ingest.queue });

  return {
    service,
    mcp,
    async close() {
      await service.close();
      await mcp.close();
    },
  };
}

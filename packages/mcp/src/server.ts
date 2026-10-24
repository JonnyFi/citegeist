import { localizeError, type OperationContract, type Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { CLIENT_INFO_META_KEY, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { actorFromClientName } from "./actor.js";
import { formatAgentError, toAgentError } from "./errors.js";
import { buildInstructions } from "./instructions.js";

export type McpScope = "read" | "write";

export interface CreateMcpServerOptions {
  /** Which tools the connection may see and call. Defaults to "write" (a local stdio client is trusted). */
  scope?: McpScope;
  /**
   * Whether the connection may make the core read local files (`items.add` with a path,
   * `items.attach`). Defaults to true: a local stdio client is the user's own. The HTTP server
   * passes what the token grants.
   */
  localFiles?: boolean;
  /** Fixed actor of every call (a webhook connector). Without it the client's name decides. */
  actor?: Actor;
  name?: string;
  version?: string;
}

/** Characters of JSON echoed into the text block; the full result is always in structuredContent. */
const TEXT_LIMIT = 2000;

/**
 * How long a client may reuse a `tools/list` result (2026-07-28 `ttlMs`). The tool set of a
 * running process does not change, so a few minutes is safe. The scope is `private` because the
 * list depends on the caller's token (read or write).
 */
export const TOOLS_LIST_TTL_MS = 5 * 60 * 1000;

/**
 * Contracts that become MCP tools for a scope, sorted by tool name. Admin operations are never
 * exposed.
 *
 * The order is fixed on purpose: the tool list is part of the prompt that agent clients send to
 * the model, and a prompt cache only hits when the prefix is byte-identical. Registration order
 * would shift whenever a module registers its operations in a different order.
 */
export function mcpContracts(registry: Registry, scope: McpScope): OperationContract[] {
  return registry
    .list()
    .filter((c) => c.mcp && c.access !== "admin" && (scope === "write" || c.mcp.readOnly))
    .sort((a, b) => compareToolNames(a.mcp?.tool ?? "", b.mcp?.tool ?? ""));
}

function compareToolNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isObjectSchema(schema: z.ZodType): boolean {
  try {
    const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
    return json.type === "object";
  } catch {
    return false;
  }
}

function summarize(tool: string, output: unknown): string {
  const json = JSON.stringify(output) ?? "null";
  if (json.length <= TEXT_LIMIT) return `${tool}: ok\n${json}`;
  return `${tool}: ok\n${json.slice(0, TEXT_LIMIT)}... (cut, the full result is in structuredContent)`;
}

function clientNameFromEnvelope(envelope: unknown): string | undefined {
  if (typeof envelope !== "object" || envelope === null) return undefined;
  const info = (envelope as Record<string, unknown>)[CLIENT_INFO_META_KEY];
  if (typeof info !== "object" || info === null) return undefined;
  const name = (info as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Builds an MCP server from the registry. One tool per contract with `mcp` set; nothing here
 * knows an individual operation.
 */
export function createMcpServer(
  registry: Registry,
  options: CreateMcpServerOptions = {},
): McpServer {
  const scope = options.scope ?? "write";
  const localFiles = options.localFiles ?? true;
  const contracts = mcpContracts(registry, scope);
  const everything = registry.list();
  const server = new McpServer(
    { name: options.name ?? "citegeist", version: options.version ?? "0.0.0" },
    {
      instructions: buildInstructions(contracts),
      cacheHints: { "tools/list": { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "private" } },
    },
  );

  for (const contract of contracts) {
    const mcp = contract.mcp;
    if (!mcp) continue;
    const outputSchema = isObjectSchema(contract.output) ? contract.output : undefined;
    server.registerTool(
      mcp.tool,
      {
        title: contract.name,
        description: contract.summary,
        inputSchema: contract.input as z.ZodObject,
        ...(outputSchema ? { outputSchema: outputSchema as z.ZodObject } : {}),
        annotations: {
          readOnlyHint: mcp.readOnly,
          ...(mcp.idempotent !== undefined ? { idempotentHint: mcp.idempotent } : {}),
        },
      },
      async (args: unknown, ctx) => {
        const clientName =
          clientNameFromEnvelope(ctx.mcpReq.envelope) ?? server.server.getClientVersion()?.name;
        const actor = options.actor ?? actorFromClientName(clientName);
        try {
          const output = await registry.call(
            contract.name,
            {
              actor,
              signal: ctx.mcpReq.signal,
              ...(localFiles ? {} : { localFiles: false }),
            },
            args,
          );
          return {
            content: [{ type: "text" as const, text: summarize(mcp.tool, output) }],
            ...(outputSchema ? { structuredContent: output as Record<string, unknown> } : {}),
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                // Fix texts name operations; the caller needs the tool names it can call.
                text: formatAgentError(
                  localizeError(toAgentError(err), "mcp", everything, contracts),
                ),
              },
            ],
          };
        }
      },
    );
  }
  return server;
}

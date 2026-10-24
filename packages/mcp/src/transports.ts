import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Registry } from "@citegeist/ops";
import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  toWebRequest,
} from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  createMcpHandler,
  isInitializeRequest,
  isLegacyRequest,
  type McpServer,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import {
  type StdioServerHandle,
  serveStdio as sdkServeStdio,
} from "@modelcontextprotocol/server/stdio";
import { createMcpServer, type McpScope } from "./server.js";

/** stdio transport for local clients. stdout carries the protocol, so log to stderr only. */
export function serveMcpStdio(
  registry: Registry,
  options: { scope?: McpScope; onerror?: (e: Error) => void } = {},
): StdioServerHandle {
  const factory: McpServerFactory = () =>
    createMcpServer(registry, { scope: options.scope ?? "write" });
  return sdkServeStdio(factory, options.onerror ? { onerror: options.onerror } : {});
}

export interface McpTokenGrant {
  token: string;
  scope: McpScope;
  /**
   * Whether this token may make the core read local files (`items.add` with a path,
   * `items.attach`). Default true. Tokens of research sessions set false.
   */
  localFiles?: boolean;
}

/** What a token allows. */
interface Access {
  scope: McpScope;
  localFiles: boolean;
}

/** Entry in AuthInfo.scopes for a token that may not read local files. */
const NO_LOCAL_FILES = "no-local-files";

export interface McpHttpOptions {
  tokens: readonly McpTokenGrant[];
  /** Loopback only. Defaults to 127.0.0.1. */
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  path?: string;
  onerror?: (e: Error) => void;
}

export interface McpHttpHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function accessForRequest(req: IncomingMessage, tokens: readonly McpTokenGrant[]): Access | null {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match?.[1]) return null;
  const presented = digest(match[1]);
  let found: Access | null = null;
  for (const grant of tokens) {
    // Compare against every grant so the timing does not reveal which one matched.
    if (timingSafeEqual(presented, digest(grant.token)) && found === null) {
      found = { scope: grant.scope, localFiles: grant.localFiles ?? true };
    }
  }
  return found;
}

function reply(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(status === 401 ? { "www-authenticate": 'Bearer realm="citegeist"' } : {}),
  });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: `${code}: ${message}` },
      id: null,
    }),
  );
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413, "Request body is larger than 4 MiB.");
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyError(400, "Request body is not valid JSON.");
  }
}

interface LegacySession {
  transport: NodeStreamableHTTPServerTransport;
  server: McpServer;
  access: Access;
}

/**
 * Streamable HTTP on loopback. Every request passes Host and Origin validation (DNS rebinding),
 * then a bearer token check. The token decides the scope of the connection.
 *
 * 2026-07-28 clients are served per request by createMcpHandler and name themselves in every
 * request. 2025-era clients get sessions, because only the initialize call carries their
 * clientInfo and the actor of each later call needs it.
 */
export async function startMcpHttpServer(
  registry: Registry,
  options: McpHttpOptions,
): Promise<McpHttpHandle> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) {
    throw new Error(`MCP HTTP binds to loopback only, got host ${host}. Use 127.0.0.1.`);
  }
  if (options.tokens.length === 0) {
    throw new Error("MCP HTTP needs at least one bearer token. Generate one with generateToken().");
  }
  const path = options.path ?? "/mcp";
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const fail = (err: unknown) =>
    options.onerror?.(err instanceof Error ? err : new Error(String(err)));

  const modernFactory: McpServerFactory = (ctx) => {
    // Fail closed: a request without a scope sees the read-only tools.
    const scope: McpScope = ctx.authInfo?.scopes.includes("write") ? "write" : "read";
    const localFiles = ctx.authInfo !== undefined && !ctx.authInfo.scopes.includes(NO_LOCAL_FILES);
    return createMcpServer(registry, { scope, localFiles });
  };
  const mcp = createMcpHandler(modernFactory, {
    legacy: "reject",
    ...(options.onerror ? { onerror: options.onerror } : {}),
  });
  const modern = toNodeHandler(mcp, options.onerror ? { onerror: options.onerror } : {});
  const sessions = new Map<string, LegacySession>();

  async function serveLegacy(
    req: IncomingMessage & { auth?: AuthInfo },
    res: ServerResponse,
    body: unknown,
    access: Access,
  ): Promise<void> {
    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        reply(res, 404, "SESSION_NOT_FOUND", "Unknown MCP session. Initialize a new one.");
        return;
      }
      if (
        session.access.scope !== access.scope ||
        session.access.localFiles !== access.localFiles
      ) {
        reply(res, 403, "FORBIDDEN", "This session belongs to a token with another scope.");
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) {
      reply(res, 400, "SESSION_REQUIRED", "Send an initialize request first.");
      return;
    }
    const server = createMcpServer(registry, {
      scope: access.scope,
      localFiles: access.localFiles,
    });
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, access });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      if (!validateHost(req, res)) return;
      if (!validateOrigin(req, res)) return;
      const access = accessForRequest(req, options.tokens);
      if (!access) {
        reply(res, 401, "UNAUTHORIZED", "Missing or wrong bearer token.");
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname !== path) {
        reply(res, 404, "NOT_FOUND", `The MCP endpoint is ${path}.`);
        return;
      }
      const authed = req as IncomingMessage & { auth?: AuthInfo };
      authed.auth = {
        token: "redacted",
        clientId: "citegeist-mcp",
        scopes: [
          ...(access.scope === "write" ? ["read", "write"] : ["read"]),
          ...(access.localFiles ? [] : [NO_LOCAL_FILES]),
        ],
      };
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        if (err instanceof BodyError) {
          reply(res, err.status, "BAD_REQUEST", err.message);
          return;
        }
        throw err;
      }
      const probe = await toWebRequest(req as unknown as Parameters<typeof toWebRequest>[0], body);
      if (await isLegacyRequest(probe)) {
        await serveLegacy(authed, res, body, access);
      } else {
        await modern(req as unknown as Parameters<typeof modern>[0], res, body);
      }
    })().catch((err: unknown) => {
      fail(err);
      if (!res.headersSent) reply(res, 500, "INTERNAL_ERROR", "Request failed.");
      else res.end();
    });
  });

  await new Promise<void>((resolve, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(options.port ?? 0, host, () => {
      httpServer.off("error", rejectListen);
      resolve();
    });
  });
  const port = (httpServer.address() as AddressInfo).port;
  const urlHost = host === "::1" ? "[::1]" : host;
  let closing: Promise<void> | undefined;
  const close = async () => {
    await mcp.close();
    await Promise.all([...sessions.values()].map((s) => s.transport.close().catch(fail)));
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  return {
    url: `http://${urlHost}:${port}${path}`,
    port,
    close: () => (closing ??= close()),
  };
}

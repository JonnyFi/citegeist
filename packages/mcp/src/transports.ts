import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, IncomingMessage, type Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Duplex } from "node:stream";
import type { Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
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
export interface McpAccess {
  scope: McpScope;
  localFiles: boolean;
  /** Fixed actor of the connection. Without one the actor comes from the client's name. */
  actor?: Actor;
}
type Access = McpAccess;

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
  id: string;
  transport: NodeStreamableHTTPServerTransport;
  server: McpServer;
  access: Access;
  /** Unknown session ids of clients that were moved onto this session. */
  aliases: Set<string>;
  lastSeen: number;
}

/** A session nobody has used for this long is closed. A client that comes back gets a new one. */
export const MCP_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
/** Comment frames on open SSE streams, so a proxy (Tailscale Funnel) does not cut a quiet one. */
export const MCP_SSE_KEEP_ALIVE_MS = 15_000;
const MAX_SESSIONS = 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";
const PRIME_TIMEOUT_MS = 5000;

export interface McpRequestHandlerOptions {
  onerror?: (e: Error) => void;
  /** Reports session events (opened, replaced, expired) to the app's log. Never gets a token. */
  log?: (message: string) => void;
  /** Idle time after which a session is closed. Default 24 hours. */
  sessionIdleMs?: number;
  /**
   * What a request with an unknown session id gets. "replace" (default) opens a new session for
   * the same caller and carries on, "reject" answers 404 as the specification says. The
   * conformance suite checks the 404, so it runs against "reject".
   */
  staleSessions?: "replace" | "reject";
  /** Interval of SSE keep-alive comments. Default 15 seconds, 0 turns them off. */
  keepAliveMs?: number;
}

/** First characters of a session id, enough to match log lines without leaking the id. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Replaces a request header in both lists, because the conversion to a web request reads the raw one. */
function setRequestHeader(req: IncomingMessage, name: string, value: string): void {
  req.headers[name] = value;
  const raw: string[] = [];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    if ((req.rawHeaders[i] as string).toLowerCase() !== name) {
      raw.push(req.rawHeaders[i] as string, req.rawHeaders[i + 1] as string);
    }
  }
  req.rawHeaders = [...raw, name, value];
}

/**
 * Runs an initialize request through a transport against a response that goes nowhere, so a
 * session exists again without the client having asked for one.
 */
async function primeSession(
  transport: NodeStreamableHTTPServerTransport,
  protocolVersion: string,
): Promise<void> {
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const req = new IncomingMessage(socket as unknown as Socket);
  req.method = "POST";
  req.url = "/mcp";
  const headers = {
    host: "localhost",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  req.headers = headers;
  // The conversion to a web request reads the raw list.
  req.rawHeaders = Object.entries(headers).flat();
  const res = new ServerResponse(req);
  res.assignSocket(socket as unknown as Socket);
  const finished = new Promise<void>((resolve) => {
    res.once("finish", resolve);
    res.once("close", resolve);
  });
  await transport.handleRequest(req, res, {
    jsonrpc: "2.0",
    id: "citegeist-session-replay",
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "", version: "0" },
    },
  });
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    finished,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PRIME_TIMEOUT_MS);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  socket.destroy();
}

export interface McpRequestHandler {
  /**
   * Serves one request that is already authenticated: `access` says what the caller may do.
   * Reads the body, picks the transport for the client's protocol version and answers.
   */
  handle(req: IncomingMessage, res: ServerResponse, access: McpAccess): Promise<void>;
  close(): Promise<void>;
}

/** Answers with a JSON-RPC style error body, for callers that sit in front of the handler. */
export function replyMcpError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  reply(res, status, code, message);
}

/**
 * The request handling of the Streamable HTTP server without a listener, Host check or login, so
 * `startMcpHttpServer` (loopback, fixed tokens) and the core's tunnel listener (connector tokens)
 * share one implementation and expose the same tools.
 *
 * 2026-07-28 clients are served per request by createMcpHandler and name themselves in every
 * request. 2025-era clients get sessions, because only the initialize call carries their
 * clientInfo and the actor of each later call needs it.
 */
export function createMcpRequestHandler(
  registry: Registry,
  options: McpRequestHandlerOptions = {},
): McpRequestHandler {
  const log = options.log ?? (() => {});
  const idleMs = options.sessionIdleMs ?? MCP_SESSION_IDLE_MS;
  const keepAliveMs = options.keepAliveMs ?? MCP_SSE_KEEP_ALIVE_MS;
  const fail = (err: unknown) =>
    options.onerror?.(err instanceof Error ? err : new Error(String(err)));

  const modernFactory: McpServerFactory = (ctx) => {
    // Fail closed: a request without a scope sees the read-only tools.
    const scopes = ctx.authInfo?.scopes ?? [];
    const scope: McpScope = scopes.includes("write")
      ? "write"
      : scopes.includes("research")
        ? "research"
        : "read";
    const localFiles = ctx.authInfo !== undefined && !ctx.authInfo.scopes.includes(NO_LOCAL_FILES);
    const actor = ctx.authInfo?.extra?.actor;
    return createMcpServer(registry, {
      scope,
      localFiles,
      ...(typeof actor === "string" ? { actor: actor as Actor } : {}),
    });
  };
  const mcp = createMcpHandler(modernFactory, {
    legacy: "reject",
    keepAliveMs,
    ...(options.onerror ? { onerror: options.onerror } : {}),
  });
  const modern = toNodeHandler(mcp, options.onerror ? { onerror: options.onerror } : {});
  const sessions = new Map<string, LegacySession>();
  /** Unknown session id to the session that took over, so one stale id makes one session. */
  const aliases = new Map<string, LegacySession>();
  /** Replacements under way, so parallel requests with the same stale id share one. */
  const replacing = new Map<string, Promise<LegacySession>>();

  function dropSession(session: LegacySession): void {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    for (const alias of session.aliases) {
      if (aliases.get(alias) === session) aliases.delete(alias);
    }
  }

  async function closeSession(session: LegacySession): Promise<void> {
    dropSession(session);
    await session.transport.close().catch(fail);
  }

  /**
   * The tools keep no state per session, so a session is only a carrier for the client's name
   * and a handle that the client keeps sending. A new transport is therefore as good as the lost
   * one.
   */
  async function openSession(
    access: Access,
    first:
      | { req: IncomingMessage; res: ServerResponse; body: unknown }
      | { protocolVersion: string },
  ): Promise<LegacySession | undefined> {
    const server = createMcpServer(registry, {
      scope: access.scope,
      localFiles: access.localFiles,
      ...(access.actor ? { actor: access.actor } : {}),
    });
    let created: LegacySession | undefined;
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      keepAliveMs,
      onsessioninitialized: (id) => {
        created = { id, transport, server, access, aliases: new Set(), lastSeen: Date.now() };
        sessions.set(id, created);
      },
    });
    transport.onclose = () => {
      if (created) dropSession(created);
    };
    await server.connect(transport);
    if ("req" in first) await transport.handleRequest(first.req, first.res, first.body);
    else await primeSession(transport, first.protocolVersion);
    if (!created) {
      await transport.close().catch(fail);
      return undefined;
    }
    // Make room: the least recently used session goes first.
    while (sessions.size > MAX_SESSIONS) {
      let oldest: LegacySession | undefined;
      for (const candidate of sessions.values()) {
        if (candidate !== created && (!oldest || candidate.lastSeen < oldest.lastSeen)) {
          oldest = candidate;
        }
      }
      if (!oldest) break;
      log(`mcp: closed session ${shortId(oldest.id)} (more than ${MAX_SESSIONS} sessions)`);
      await closeSession(oldest);
    }
    return created;
  }

  function replaceStale(
    staleId: string,
    req: IncomingMessage,
    access: Access,
  ): Promise<LegacySession> {
    const running = replacing.get(staleId);
    if (running) return running;
    const header = req.headers["mcp-protocol-version"];
    const version = Array.isArray(header) ? header[0] : header;
    const task = (async () => {
      const session = await openSession(access, {
        protocolVersion: version || FALLBACK_PROTOCOL_VERSION,
      });
      if (!session) throw new Error("The MCP session could not be replaced.");
      session.aliases.add(staleId);
      aliases.set(staleId, session);
      log(
        `mcp: unknown session ${shortId(staleId)} (${access.actor ?? "no fixed actor"}, ${req.method}) replaced by ${shortId(session.id)}, probably after a restart of the core`,
      );
      return session;
    })().finally(() => replacing.delete(staleId));
    replacing.set(staleId, task);
    return task;
  }

  const sweeper = setInterval(
    () => {
      const cutoff = Date.now() - idleMs;
      const idle = [...sessions.values()].filter((s) => s.lastSeen < cutoff);
      if (idle.length === 0) return;
      log(
        `mcp: closed ${idle.length} session(s) idle for more than ${Math.round(idleMs / 3600000)} h`,
      );
      for (const session of idle) void closeSession(session);
    },
    Math.min(SWEEP_INTERVAL_MS, idleMs),
  );
  sweeper.unref();

  async function serveLegacy(
    req: IncomingMessage & { auth?: AuthInfo },
    res: ServerResponse,
    body: unknown,
    access: Access,
  ): Promise<void> {
    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const initializing = req.method === "POST" && isInitializeRequest(body);
    if (sessionId && !initializing) {
      let session = sessions.get(sessionId) ?? aliases.get(sessionId);
      if (!session) {
        if (options.staleSessions === "reject") {
          reply(res, 404, "SESSION_NOT_FOUND", "Unknown MCP session. Initialize a new one.");
          return;
        }
        if (req.method === "DELETE") {
          // The session is gone already, which is what the client wants.
          res.writeHead(204).end();
          return;
        }
        session = await replaceStale(sessionId, req, access);
      }
      if (
        session.access.scope !== access.scope ||
        session.access.localFiles !== access.localFiles ||
        session.access.actor !== access.actor
      ) {
        reply(res, 403, "FORBIDDEN", "This session belongs to a token with another scope.");
        return;
      }
      session.lastSeen = Date.now();
      // The transport only knows its own id. The answer carries it, so the client learns it.
      setRequestHeader(req, "mcp-session-id", session.id);
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (!initializing) {
      reply(res, 400, "SESSION_REQUIRED", "Send an initialize request first.");
      return;
    }
    const session = await openSession(access, { req, res, body });
    if (session) {
      log(`mcp: session ${shortId(session.id)} opened (${access.actor ?? "client-named actor"})`);
    }
  }

  return {
    async handle(req, res, access) {
      try {
        const authed = req as IncomingMessage & { auth?: AuthInfo };
        authed.auth = {
          token: "redacted",
          clientId: "citegeist-mcp",
          scopes: [
            ...(access.scope === "write"
              ? ["read", "write"]
              : access.scope === "research"
                ? ["read", "research"]
                : ["read"]),
            ...(access.localFiles ? [] : [NO_LOCAL_FILES]),
          ],
          ...(access.actor ? { extra: { actor: access.actor } } : {}),
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
        const probe = await toWebRequest(
          req as unknown as Parameters<typeof toWebRequest>[0],
          body,
        );
        if (await isLegacyRequest(probe)) {
          await serveLegacy(authed, res, body, access);
        } else {
          await modern(req as unknown as Parameters<typeof modern>[0], res, body);
        }
      } catch (err) {
        fail(err);
        if (!res.headersSent) reply(res, 500, "INTERNAL_ERROR", "Request failed.");
        else res.end();
      }
    },
    async close() {
      clearInterval(sweeper);
      await mcp.close();
      await Promise.all([...sessions.values()].map((s) => closeSession(s)));
    },
  };
}

/**
 * Streamable HTTP on loopback. Every request passes Host and Origin validation (DNS rebinding),
 * then a bearer token check. The token decides the scope of the connection.
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
  const handler = createMcpRequestHandler(registry, {
    ...(options.onerror ? { onerror: options.onerror } : {}),
  });

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
      await handler.handle(req, res, access);
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
    await handler.close();
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  return {
    url: `http://${urlHost}:${port}${path}`,
    port,
    close: () => (closing ??= close()),
  };
}

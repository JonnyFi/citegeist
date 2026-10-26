import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type McpRequestHandler, replyMcpError } from "@citegeist/mcp";
import type { HooksListenerStatus } from "@citegeist/ops";
import {
  clientAddress,
  FailureLimiter,
  HOOKS_PREFIX,
  type WebhooksHandle,
} from "@citegeist/webhooks";

/** Path of the MCP endpoint on the hooks port. */
export const MCP_PATH = "/mcp";

/** Longest a request may take from first byte to last. A webhook body is at most 1 MiB. */
export const HOOKS_REQUEST_TIMEOUT_MS = 30_000;

export interface HooksListenerOptions {
  hooks: WebhooksHandle;
  mcp: McpRequestHandler;
  /** Port from the settings, read again at every reconcile. */
  port: () => number;
  /** Replaces the settings port (tests use 0 for any free port). */
  portOverride?: number | undefined;
  log?: (message: string) => void;
  now?: () => number;
  /** Replaces HOOKS_REQUEST_TIMEOUT_MS (tests). */
  requestTimeoutMs?: number;
}

export interface HooksListener {
  status(): HooksListenerStatus;
  /** Starts, moves or stops the listener to match the connectors and the port. Never throws. */
  reconcile(): Promise<void>;
  stop(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, headers: object = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/**
 * A second HTTP listener on 127.0.0.1 and a fixed port. It serves /hooks/<name> and, for
 * connectors that were given MCP access, /mcp, and nothing else of the core, so a tunnel
 * (Tailscale Funnel, Cloudflare Tunnel) can point at it while the core's own port stays private.
 * It runs only while at least one connector exists. A port that is taken is not fatal: the status
 * says what happened and webhooks.list shows it.
 */
export function manageHooksListener(opts: HooksListenerOptions): HooksListener {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const limiter = new FailureLimiter();
  const lastBlockLog = new Map<string, number>();
  const service = opts.hooks.service;
  let server: Server | undefined;
  let boundFor: number | undefined;
  let status: HooksListenerStatus = { state: "off" };
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const serveMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Without a connector that has MCP access, the endpoint does not exist.
    if (!service.hasMcpAccess()) return send(res, 404, { error: "not found" });
    const source = clientAddress(req);
    const wait = limiter.retryAfter(source, now());
    if (wait > 0) {
      // One line per source and minute, so a client that keeps trying does not fill the log.
      if (now() - (lastBlockLog.get(source) ?? -Infinity) >= 60_000) {
        if (lastBlockLog.size > 1000) lastBlockLog.clear();
        lastBlockLog.set(source, now());
        log(`mcp: request from ${source} refused with 429 for ${wait} s after failed logins`);
      }
      return send(
        res,
        429,
        { error: "too many failed attempts", retryAfterSeconds: wait },
        { "retry-after": String(wait) },
      );
    }
    const auth = await service.authenticateMcp(req.headers.authorization);
    if (!auth) {
      limiter.fail(source, now());
      log(`mcp: request from ${source} refused with 401 (missing or wrong bearer token)`);
      return replyMcpError(res, 401, "UNAUTHORIZED", "Missing or wrong bearer token.");
    }
    // The agent is on the internet: it may never make the core read a local file.
    await opts.mcp.handle(req, res, { scope: auth.scope, localFiles: false, actor: auth.actor });
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path.startsWith(HOOKS_PREFIX)) {
        if (await opts.hooks.handle(req, res)) return;
      } else if (path === MCP_PATH) {
        return await serveMcp(req, res);
      }
      send(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) send(res, 500, { error: "internal error" });
      else res.destroy();
    });
  };

  const close = async (): Promise<void> => {
    const current = server;
    server = undefined;
    boundFor = undefined;
    if (!current) return;
    current.closeAllConnections();
    await new Promise<void>((resolve) => current.close(() => resolve()));
  };

  const apply = async (): Promise<void> => {
    if (stopped) return;
    const wanted = opts.portOverride ?? opts.port();
    if (!service.hasConnectors()) {
      await close();
      status = { state: "off" };
      return;
    }
    if (server && boundFor === wanted) return;
    await close();
    // The listener may face the internet: a client that sends its body one byte a minute must not
    // hold a connection for the default five minutes. Node checks the timeouts on an interval of
    // its own (30 seconds by default), so the interval shrinks with the timeout.
    const timeout = opts.requestTimeoutMs ?? HOOKS_REQUEST_TIMEOUT_MS;
    const next = createServer(
      { connectionsCheckingInterval: Math.min(5_000, timeout), requestTimeout: timeout },
      onRequest,
    );
    next.headersTimeout = Math.min(next.headersTimeout, timeout);
    try {
      await new Promise<void>((resolve, reject) => {
        next.once("error", reject);
        next.listen(wanted, "127.0.0.1", () => {
          next.off("error", reject);
          resolve();
        });
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const inUse = code === "EADDRINUSE";
      status = {
        state: "error",
        port: wanted,
        code: inUse ? "HOOKS_PORT_IN_USE" : "HOOKS_LISTEN_FAILED",
        detail: inUse
          ? `Port ${wanted} is already in use by another program.`
          : `Could not listen on port ${wanted}: ${err instanceof Error ? err.message : String(err)}`,
        fix: inUse
          ? "Choose another port in Settings > Webhooks and point the tunnel at it."
          : "Choose another port in Settings > Webhooks.",
      };
      log(`hooks: ${status.detail}`);
      return;
    }
    server = next;
    boundFor = wanted;
    status = { state: "listening", port: (next.address() as AddressInfo).port };
  };

  return {
    status: () => status,
    reconcile() {
      queue = queue.then(apply).catch((err) => log(`hooks: ${String(err)}`));
      return queue;
    },
    async stop() {
      stopped = true;
      await queue;
      await close();
      status = { state: "off" };
    },
  };
}

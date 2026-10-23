import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type ChangeEvent, createRuntime, Library } from "@citegeist/core";
import type { Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { WebSocketServer } from "ws";
import { ZodError } from "zod";
import {
  acquireLock,
  defaultLocalBase,
  LockHeldError,
  localDir,
  publishLock,
  readLibraryId,
  releaseLock,
} from "../shared/lockfile.js";

export { LockHeldError };

export interface CoreServerOptions {
  /** Library folder. Must contain citegeist.json unless `init` is set. */
  library: string;
  /** Create the library if the folder is not one yet. */
  init?: boolean;
  /** Machine-local base for index and lock. Defaults to ~/Library/Application Support/citegeist. */
  localBase?: string;
  /** Origins that may call the core from a browser, besides requests without an Origin header. */
  allowedOrigins?: readonly string[];
  /** Start the folder watcher. Default true. */
  watch?: boolean;
  /** Port to bind. Default 0 (random). */
  port?: number;
}

export interface CoreServer {
  port: number;
  token: string;
  library: Library;
  registry: Registry;
  close(): Promise<void>;
}

/** Origins of the renderer: the packaged app (file://) and the Vite dev server. */
export const DEFAULT_ORIGINS = ["null", "http://localhost:5173", "http://127.0.0.1:5173"] as const;

const NOT_FOUND_CODES = new Set(["ITEM_NOT_FOUND", "PROJECT_NOT_FOUND", "NOTE_NOT_FOUND"]);

/** Maps what a handler throws to a typed oRPC error. The agent-ready detail travels as `data`. */
function toOrpcError(err: unknown): ORPCError<string, unknown> {
  if (err instanceof ORPCError) return err;
  if (err instanceof CitegeistError) {
    const code = NOT_FOUND_CODES.has(err.detail.code) ? "NOT_FOUND" : "BAD_REQUEST";
    return new ORPCError(code, { message: err.detail.message, data: err.detail });
  }
  if (err instanceof ZodError) {
    const message = `invalid input: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    return new ORPCError("BAD_REQUEST", { message, data: { message } });
  }
  const message = err instanceof Error ? err.message : "operation failed";
  const missing = /unknown operation/.test(message);
  return new ORPCError(missing ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR", {
    message,
    data: { message },
  });
}

type Node = { [segment: string]: Node } | ReturnType<typeof os.handler>;

/** Builds the oRPC router from the bound operations: `items.list` becomes items -> list. */
export function buildRouter(registry: Registry): Record<string, Node> {
  const root: Record<string, Node> = {};
  for (const contract of registry.list()) {
    const segments = contract.name.split(".");
    const leaf = segments.pop();
    if (!leaf) continue;
    let node = root;
    for (const s of segments) {
      const existing = node[s] as Record<string, Node> | undefined;
      const next: Record<string, Node> = existing ?? {};
      node[s] = next;
      node = next;
    }
    node[leaf] = os.handler(async ({ input }) => {
      try {
        return await registry.call(contract.name, { actor: "human" }, input);
      } catch (err) {
        throw toOrpcError(err);
      }
    });
  }
  return root;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Opens the library and serves its operations over oRPC on 127.0.0.1, plus a WebSocket with
 * change events. Takes the library's core.lock first, so a second core for the same library
 * fails with LockHeldError before it touches the index.
 */
export async function startCoreServer(opts: CoreServerOptions): Promise<CoreServer> {
  const localBase = opts.localBase ?? defaultLocalBase();
  const allowedOrigins = new Set(opts.allowedOrigins ?? DEFAULT_ORIGINS);

  let id = readLibraryId(opts.library);
  let lockDir: string | undefined;
  if (id) {
    lockDir = localDir(localBase, id);
    acquireLock(lockDir);
  }

  let library: Library;
  try {
    const open = opts.init ? Library.openOrInit : Library.open;
    library = await open.call(Library, opts.library, { localBase, watch: opts.watch ?? true });
  } catch (err) {
    if (lockDir) releaseLock(lockDir);
    throw err;
  }
  if (!lockDir) {
    // Fresh library: the id exists only now. Nobody else can hold its lock yet.
    id = library.manifest.id;
    lockDir = localDir(localBase, id);
    acquireLock(lockDir);
  }
  const dir = lockDir;

  const runtime = createRuntime(library);
  const registry = runtime.registry;
  const rpc = new RPCHandler(buildRouter(registry));
  const token = randomBytes(32).toString("hex");
  const sockets = new Set<import("ws").WebSocket>();

  const hostOk = (req: IncomingMessage, port: number) =>
    req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
  const originOk = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    return origin === undefined || allowedOrigins.has(origin);
  };
  const tokenOk = (req: IncomingMessage, url: URL) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const given = bearer ?? url.searchParams.get("token") ?? "";
    return safeEqual(given, token);
  };

  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (!hostOk(req, port)) return reply(res, 403, { error: "bad host" });
    if (!originOk(req)) return reply(res, 403, { error: "origin not allowed" });

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader(
        "access-control-allow-headers",
        req.headers["access-control-request-headers"] ?? "authorization, content-type",
      );
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (!tokenOk(req, url)) return reply(res, 401, { error: "missing or wrong token" });

    if (url.pathname === "/health") {
      return reply(res, 200, { ok: true, library: library.root, pid: process.pid });
    }
    rpc
      .handle(req, res, { prefix: "/rpc", context: {} })
      .then(({ matched }) => {
        if (!matched) reply(res, 404, { error: "not found" });
      })
      .catch(() => {
        if (!res.headersSent) reply(res, 500, { error: "internal error" });
      });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const port = (server.address() as AddressInfo).port;
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/events" || !hostOk(req, port) || !originOk(req) || !tokenOk(req, url)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
    });
  });

  const onChange = (e: ChangeEvent) => {
    const frame = JSON.stringify({ type: "change", path: e.rel, external: e.external });
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(frame);
  };
  library.on("change", onChange);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
    });
  } catch (err) {
    library.off("change", onChange);
    await runtime.close();
    await library.close();
    releaseLock(dir);
    throw err;
  }
  const port = (server.address() as AddressInfo).port;
  publishLock(dir, port, token);

  let closing: Promise<void> | undefined;
  return {
    port,
    token,
    library,
    registry,
    close() {
      closing ??= (async () => {
        library.off("change", onChange);
        for (const ws of sockets) ws.terminate();
        wss.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await runtime.close();
        await library.close();
        releaseLock(dir);
      })();
      return closing;
    },
  };
}

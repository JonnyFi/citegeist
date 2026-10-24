import type { IncomingMessage, ServerResponse } from "node:http";
import { HOOKS_PREFIX, type WebhookService } from "./service.js";

/** Largest body a webhook may carry. */
export const MAX_BODY_BYTES = 1024 * 1024;

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) return reject(new TooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new TooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Node adapter for the receiver. Returns true when the request was a webhook request (the
 * response is sent or on its way) and false when the path is not under /hooks/, so the caller can
 * go on with its own routes. It must run before the core's Host, Origin and token checks: a
 * request that comes through a tunnel carries a public Host and no core token, and the signature
 * is its only credential.
 */
export function createHooksHandler(
  service: WebhookService,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!path.startsWith(HOOKS_PREFIX)) return false;
    try {
      const rawBody = req.method === "POST" ? await readBody(req, MAX_BODY_BYTES) : Buffer.alloc(0);
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value.join(" ") : value;
      }
      const out = await service.handleInbound({
        method: req.method ?? "GET",
        path,
        headers,
        rawBody,
      });
      reply(res, out?.status ?? 404, out?.body ?? { error: "not found" });
    } catch (err) {
      if (err instanceof TooLarge) reply(res, 413, { error: "body too large" });
      else reply(res, 500, { error: "internal error" });
    }
    return true;
  };
}

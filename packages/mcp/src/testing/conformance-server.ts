import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Registry } from "@citegeist/ops";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import { createMcpRequestHandler } from "../transports.js";

export interface ConformanceServer {
  url: string;
  close(): Promise<void>;
}

/**
 * The request handling of the HTTP server (Host and Origin checks, both protocol eras, the same
 * tools) on a free loopback port. The bearer token check is left out because the conformance CLI
 * cannot send headers; it sits in front of the handler and is covered by mcp.test.ts.
 */
export async function startConformanceServer(registry: Registry): Promise<ConformanceServer> {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const handler = createMcpRequestHandler(registry);
  const server: Server = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    void handler.handle(req, res, { scope: "write", localFiles: false });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    async close() {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

import type { IncomingHttpHeaders } from "node:http";

/** Port the official Connector talks to by default (ASCII "ZO"). */
export const DEFAULT_CONNECTOR_PORT = 23119;
/** The Connector API version both sides speak (`X-Zotero-Connector-API-Version`). */
export const CONNECTOR_API_VERSION = "3";
/**
 * Version we announce in `X-Zotero-Version`. The Connector treats a missing header as "Zotero is
 * not running" and may fall back to zotero.org, so every response carries it.
 */
export const ANNOUNCED_ZOTERO_VERSION = "7.0.0";
/** Marks our own listener, so a port probe can tell citegeist from Zotero. */
export const CITEGEIST_MARKER_HEADER = "x-citegeist-connector";

/** Actor recorded as provenance on everything the Connector adds. */
export const CONNECTOR_ACTOR = "agent:zotero-connector";

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension|extension):\/\//;

export type RequestVerdict = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Network-level checks that apply to every request.
 *
 * - The Host header must name the loopback address and our port (DNS rebinding).
 * - A request from a web page carries an Origin that is not an extension. It is refused, and so
 *   is a preflight from a page, because no CORS permission is ever granted to a web origin.
 * - A browser-like request without Origin (`Mozilla/` user agent) needs the Connector header or
 *   `Zotero-Allowed-Request`. Plain tools such as curl pass.
 */
export function checkRequest(
  headers: IncomingHttpHeaders,
  port: number,
  extraOrigins: readonly string[] = [],
): RequestVerdict {
  const host = headers.host ?? "";
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!hosts.includes(host)) return { ok: false, status: 403, reason: "bad host" };

  const origin = headers.origin;
  const hasConnectorHeader =
    headers["x-zotero-connector-api-version"] !== undefined ||
    headers["zotero-allowed-request"] !== undefined;
  if (origin !== undefined) {
    const known = EXTENSION_ORIGIN.test(origin) || extraOrigins.includes(origin);
    if (!known) return { ok: false, status: 403, reason: "origin not allowed" };
    if (!hasConnectorHeader && headers["access-control-request-method"] === undefined) {
      return { ok: false, status: 403, reason: "missing connector header" };
    }
    return { ok: true };
  }
  const userAgent = headers["user-agent"] ?? "";
  if (userAgent.startsWith("Mozilla/") && !hasConnectorHeader) {
    return { ok: false, status: 403, reason: "missing connector header" };
  }
  return { ok: true };
}

/** True for the extension origins the Connector sends. Used to echo CORS headers, never `*`. */
export function isExtensionOrigin(origin: string | undefined, extra: readonly string[] = []) {
  return origin !== undefined && (EXTENSION_ORIGIN.test(origin) || extra.includes(origin));
}

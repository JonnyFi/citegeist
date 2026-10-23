import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { CitegeistError } from "@citegeist/schema";
import {
  ANNOUNCED_ZOTERO_VERSION,
  CITEGEIST_MARKER_HEADER,
  CONNECTOR_ACTOR,
  checkRequest,
  DEFAULT_CONNECTOR_PORT,
  isExtensionOrigin,
} from "./protocol.js";
import { mapZoteroItem, type ZoteroItem, zoteroTags } from "./zotero.js";

/** Calls an operation of the core registry as `actor`. */
export type OpCall = (name: string, actor: string, input: unknown) => Promise<unknown>;

export interface ConnectorOptions {
  call: OpCall;
  /** Port to bind on 127.0.0.1. Default 23119. 0 picks a free one (tests). */
  port?: number;
  /** Name shown as the save target in the Connector popup. */
  libraryName: string;
  /** Origins besides browser extensions that may call the listener. Default none. */
  extraOrigins?: readonly string[];
  /** Directory for uploaded files until the core has copied them. Default: a temp directory. */
  stagingDir?: string;
  /** Largest upload accepted for a file, in bytes. Default 400 MB. */
  maxFileBytes?: number;
  zoteroVersion?: string;
  log?: (message: string) => void;
}

export interface ConnectorHandle {
  port: number;
  close(): Promise<void>;
}

/** Who holds the port when binding fails. */
export type PortHolder = "zotero" | "citegeist" | "other";

export class ConnectorPortError extends Error {
  constructor(
    readonly port: number,
    readonly holder: PortHolder,
  ) {
    super(
      holder === "zotero"
        ? `Port ${port} is used by Zotero. Quit Zotero, or choose another port for the Zotero Connector in the citegeist settings and set connector.url in the Connector's Config Editor to http://127.0.0.1:<port>/.`
        : holder === "citegeist"
          ? `Port ${port} is already used by another citegeist window. Close the other instance or choose another port in the settings.`
          : `Port ${port} is used by another program. Choose another port for the Zotero Connector in the citegeist settings.`,
    );
    this.name = "ConnectorPortError";
  }
}

/** Asks the listener on `port` who it is. Zotero answers /connector/ping with its version header. */
export function probePort(port: number): Promise<PortHolder> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/connector/ping",
        method: "GET",
        timeout: 1000,
        headers: { "x-zotero-connector-api-version": "3" },
      },
      (res) => {
        res.resume();
        if (res.headers[CITEGEIST_MARKER_HEADER]) resolve("citegeist");
        else if (res.headers["x-zotero-version"]) resolve("zotero");
        else resolve("other");
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve("other");
    });
    req.on("error", () => resolve("other"));
    req.end();
  });
}

// Sessions ------------------------------------------------------------------------------------------------

interface Session {
  at: number;
  /** Zotero item id (set by the Connector) to what we saved it as. */
  items: Map<string, { citekey: string; duplicateOf?: string }>;
  uri: string;
}

const MAX_SESSIONS = 200;
const JSON_LIMIT = 64 * 1024 * 1024;
const DEFAULT_FILE_LIMIT = 400 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function extensionFor(contentType: string | undefined, name: string | undefined): string {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (type === "application/pdf") return ".pdf";
  if (type === "text/html" || type === "application/xhtml+xml") return ".html";
  if (type === "application/epub+zip") return ".epub";
  const ext = name ? extname(name).toLowerCase() : "";
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".bin";
}

function safeName(raw: string | undefined, ext: string): string {
  const base = basename((raw ?? "").replace(/\?.*$/, ""), extname(raw ?? ""));
  const clean = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${(clean || "attachment").slice(0, 80)}${ext}`;
}

function describeError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof HttpError)
    return { status: err.status, body: { error: err.message, ...err.extra } };
  if (err instanceof CitegeistError) {
    return {
      status: 400,
      body: { error: err.detail.message, code: err.detail.code, fix: err.detail.fix },
    };
  }
  const message = err instanceof Error ? err.message : "operation failed";
  return { status: 500, body: { error: message } };
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, "request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readBody(req, JSON_LIMIT)).toString("utf8");
  if (raw.trim() === "") return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // falls through
  }
  throw new HttpError(400, "body is not a JSON object");
}

const isHttpUrl = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Starts the Zotero Connector listener. It speaks the subset of the connector protocol that saves
 * into citegeist: ping, getSelectedCollection, saveItems, saveSnapshot, saveSingleFile,
 * saveAttachment, saveStandaloneAttachment and updateSession. Translators stay in the browser
 * extension, so getTranslators and getTranslatorCode answer 501 and the extension loads them from
 * its own repository.
 */
export async function startConnector(opts: ConnectorOptions): Promise<ConnectorHandle> {
  const wantedPort = opts.port ?? DEFAULT_CONNECTOR_PORT;
  const version = opts.zoteroVersion ?? ANNOUNCED_ZOTERO_VERSION;
  const maxFile = opts.maxFileBytes ?? DEFAULT_FILE_LIMIT;
  const log = opts.log ?? (() => {});
  const extra = opts.extraOrigins ?? [];
  const sessions = new Map<string, Session>();
  let staging: string | undefined = opts.stagingDir;
  const stagingRoot = async () => {
    if (!staging) staging = await mkdtemp(join(tmpdir(), "citegeist-connector-"));
    await mkdir(staging, { recursive: true });
    return staging;
  };

  const call = (name: string, input: unknown) => opts.call(name, CONNECTOR_ACTOR, input);

  const remember = (id: string, session: Session) => {
    sessions.set(id, session);
    if (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
  };

  // Handlers ---------------------------------------------------------------------------------------------

  const send = (res: ServerResponse, status: number, body?: unknown, type = "application/json") => {
    const payload =
      body === undefined ? "" : type === "application/json" ? JSON.stringify(body) : String(body);
    res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
    res.end(payload);
  };

  async function selectedCollection() {
    const targets: Array<Record<string, unknown>> = [
      { id: "L1", name: opts.libraryName, filesEditable: true, level: 0 },
    ];
    try {
      const out = (await call("projects.list", {})) as {
        projects: Array<{ slug: string; title: string }>;
      };
      for (const p of out.projects) {
        targets.push({ id: `C${p.slug}`, name: p.title, filesEditable: true, level: 1 });
      }
    } catch (err) {
      log(`projects.list failed: ${String(err)}`);
    }
    return {
      libraryID: 1,
      libraryName: opts.libraryName,
      libraryEditable: true,
      editable: true,
      // Without this the browser skips PDF downloads silently.
      filesEditable: true,
      name: opts.libraryName,
      targets,
      tags: [],
    };
  }

  async function saveItems(body: Record<string, unknown>) {
    const sessionID = body.sessionID;
    const items = body.items;
    if (typeof sessionID !== "string" || sessionID === "" || !Array.isArray(items)) {
      throw new HttpError(400, "saveItems needs sessionID and items");
    }
    if (sessions.has(sessionID))
      throw new HttpError(409, "SESSION_EXISTS", { code: "SESSION_EXISTS" });
    const uri = typeof body.uri === "string" ? body.uri : "";
    const session: Session = { at: Date.now(), items: new Map(), uri };
    remember(sessionID, session);

    const errors: string[] = [];
    for (const raw of items as ZoteroItem[]) {
      if (typeof raw !== "object" || raw === null) continue;
      if (raw.itemType === "attachment" || raw.itemType === "note") continue;
      try {
        const mapped = mapZoteroItem(raw);
        const out = (await call("items.add", {
          identifier: mapped.bibtex,
          target: "library",
          tags: mapped.tags,
          why: `Saved with the Zotero Connector${uri ? ` from ${uri}` : ""}`,
        })) as { citekey: string; duplicateOf?: string };
        const entry = {
          citekey: out.citekey,
          ...(out.duplicateOf ? { duplicateOf: out.duplicateOf } : {}),
        };
        if (typeof raw.id === "string") session.items.set(raw.id, entry);
        else session.items.set(`#${session.items.size}`, entry);
      } catch (err) {
        errors.push(describeError(err).body.error as string);
      }
    }
    if (session.items.size === 0 && errors.length > 0) {
      sessions.delete(sessionID);
      throw new HttpError(500, errors.join("; "));
    }
    return { items };
  }

  async function saveSnapshot(body: Record<string, unknown>) {
    const url = body.url ?? body.uri;
    if (!isHttpUrl(url)) throw new HttpError(400, "saveSnapshot needs an http(s) url");
    const out = (await call("items.add", {
      identifier: url,
      target: "library",
      why: "Saved as a web page with the Zotero Connector",
    })) as { citekey: string; duplicateOf?: string };
    const sessionID = typeof body.sessionID === "string" ? body.sessionID : undefined;
    if (sessionID) {
      remember(sessionID, {
        at: Date.now(),
        uri: url,
        items: new Map([
          [
            "#0",
            { citekey: out.citekey, ...(out.duplicateOf ? { duplicateOf: out.duplicateOf } : {}) },
          ],
        ]),
      });
    }
    return {};
  }

  /** Streams an upload into the staging directory. Returns the path and the parsed X-Metadata. */
  async function stageUpload(req: IncomingMessage) {
    const header = req.headers["x-metadata"];
    let meta: Record<string, unknown> = {};
    if (typeof header === "string" && header !== "") {
      try {
        meta = JSON.parse(header) as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "X-Metadata is not JSON");
      }
    }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > maxFile) throw new HttpError(413, "file too large");
    const contentType =
      (typeof meta.contentType === "string" ? meta.contentType : undefined) ??
      req.headers["content-type"];
    const title = typeof meta.title === "string" ? meta.title : undefined;
    const url = typeof meta.url === "string" ? meta.url : undefined;
    const ext = extensionFor(contentType, url);
    const dir = join(await stagingRoot(), randomBytes(6).toString("hex"));
    await mkdir(dir, { recursive: true });
    const path = join(dir, safeName(title ?? url, ext));
    let size = 0;
    const out = createWriteStream(path);
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxFile) req.destroy(new HttpError(413, "file too large"));
    });
    try {
      await pipeline(req, out);
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err instanceof HttpError ? err : new HttpError(400, "upload interrupted");
    }
    return { path, dir, meta };
  }

  /**
   * Hands an uploaded file to the core. items.add has no "attach to this item" mode yet, so the
   * file goes in as its own item. The metadata item stays in the library, the file lands in the
   * inbox where one click rejects it, and duplicate detection (DOI on the first page, URL, hash)
   * folds it into the right item whenever it can. An `items.attach` operation replaces this.
   */
  async function addFile(path: string, parent: string | undefined, url?: string) {
    await call("items.add", {
      identifier: path,
      target: "inbox",
      why: parent
        ? `File for ${parent}, saved with the Zotero Connector${url ? ` from ${url}` : ""}`
        : `Saved with the Zotero Connector${url ? ` from ${url}` : ""}`,
    });
  }

  async function saveAttachment(req: IncomingMessage, url: URL, standalone: boolean) {
    const staged = await stageUpload(req);
    try {
      const sessionID =
        url.searchParams.get("sessionID") ??
        (typeof staged.meta.sessionID === "string" ? staged.meta.sessionID : undefined);
      const session = sessionID ? sessions.get(sessionID) : undefined;
      const parentId =
        typeof staged.meta.parentItemID === "string" ? staged.meta.parentItemID : undefined;
      let parent = parentId ? session?.items.get(parentId) : undefined;
      if (!parent && session && session.items.size === 1) parent = [...session.items.values()][0];
      if (parent?.duplicateOf) return standalone ? { canRecognize: false } : {};
      const originUrl = typeof staged.meta.url === "string" ? staged.meta.url : undefined;
      await addFile(staged.path, parent?.citekey, originUrl);
      return standalone ? { canRecognize: false } : {};
    } finally {
      await rm(staged.dir, { recursive: true, force: true });
    }
  }

  async function saveSingleFile(req: IncomingMessage, url: URL) {
    if (req.headers["x-metadata"] !== undefined) return saveAttachment(req, url, false);
    const body = await readJson(req);
    const sessionID = typeof body.sessionID === "string" ? body.sessionID : undefined;
    const session = sessionID ? sessions.get(sessionID) : undefined;
    const content = typeof body.snapshotContent === "string" ? body.snapshotContent : undefined;
    const pageUrl = typeof body.url === "string" ? body.url : undefined;
    if (!content) throw new HttpError(400, "saveSingleFile needs snapshotContent");
    const parent = session && session.items.size === 1 ? [...session.items.values()][0] : undefined;
    if (parent?.duplicateOf) return {};
    const dir = join(await stagingRoot(), randomBytes(6).toString("hex"));
    await mkdir(dir, { recursive: true });
    const path = join(
      dir,
      safeName(typeof body.title === "string" ? body.title : pageUrl, ".html"),
    );
    try {
      await writeFile(path, content);
      await addFile(path, parent?.citekey, pageUrl);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return {};
  }

  async function updateSession(body: Record<string, unknown>) {
    const sessionID = body.sessionID;
    const session = typeof sessionID === "string" ? sessions.get(sessionID) : undefined;
    if (!session) throw new HttpError(400, "unknown session");
    const target = typeof body.target === "string" ? body.target : "";
    const project = target.startsWith("C") ? target.slice(1) : undefined;
    const tags = zoteroTags({
      tags: Array.isArray(body.tags) ? (body.tags as ZoteroItem["tags"]) : [],
    } as ZoteroItem);
    if (!project && tags.length === 0) return {};
    for (const entry of session.items.values()) {
      if (entry.duplicateOf) continue;
      const current = (await call("items.get", { citekey: entry.citekey })) as {
        frontmatter: { projects: string[]; tags: string[] };
      };
      const patch: Record<string, unknown> = {};
      if (project) patch.projects = [...new Set([...current.frontmatter.projects, project])];
      if (tags.length > 0) patch.tags = [...new Set([...current.frontmatter.tags, ...tags])];
      await call("items.update", { citekey: entry.citekey, patch });
    }
    return {};
  }

  // Dispatch -----------------------------------------------------------------------------------------------

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo | null)?.port ?? wantedPort;
    res.setHeader("X-Zotero-Version", version);
    res.setHeader("X-Zotero-Connector-API-Version", "3");
    res.setHeader(CITEGEIST_MARKER_HEADER, "1");

    const verdict = checkRequest(req.headers, port, extra);
    if (!verdict.ok) {
      req.resume();
      return send(res, verdict.status, { error: verdict.reason });
    }
    const origin = req.headers.origin;
    if (isExtensionOrigin(origin, extra)) {
      res.setHeader("access-control-allow-origin", origin as string);
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        req.headers["access-control-request-headers"] ?? "content-type",
      );
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const route = url.pathname.replace(/^\/connector\//, "");
    const handle = async () => {
      if (!url.pathname.startsWith("/connector/")) throw new HttpError(404, "not found");
      if (route === "ping") {
        if (req.method === "GET") {
          return send(
            res,
            200,
            "<!DOCTYPE html><html><head><title>citegeist</title></head><body>Zotero is running (citegeist)</body></html>",
            "text/html",
          );
        }
        await readBody(req, JSON_LIMIT);
        // No translatorsHash: the extension then loads translators from its own repository.
        return send(res, 200, {
          prefs: {
            automaticSnapshots: true,
            downloadAssociatedFiles: true,
            supportsAttachmentUpload: true,
            canUserAddNote: false,
          },
        });
      }
      if (req.method !== "POST") throw new HttpError(405, "method not allowed");
      switch (route) {
        case "getSelectedCollection":
          await readBody(req, JSON_LIMIT);
          return send(res, 200, await selectedCollection());
        case "saveItems":
          return send(res, 201, await saveItems(await readJson(req)));
        case "saveSnapshot":
          return send(res, 201, await saveSnapshot(await readJson(req)));
        case "saveSingleFile":
          return send(res, 201, await saveSingleFile(req, url));
        case "saveAttachment":
          return send(res, 201, await saveAttachment(req, url, false));
        case "saveStandaloneAttachment":
          return send(res, 201, await saveAttachment(req, url, true));
        case "updateSession":
          return send(res, 200, await updateSession(await readJson(req)));
        case "hasAttachmentResolvers":
          await readBody(req, JSON_LIMIT);
          return send(res, 200, false);
        case "getTranslators":
        case "getTranslatorCode":
        case "detect":
        case "getRecognizedItem":
        case "saveAttachmentFromResolver":
        case "import":
        case "installStyle":
        case "delaySync":
        case "getClientHostnames":
        case "proxies":
          await readBody(req, JSON_LIMIT);
          throw new HttpError(501, "not supported by citegeist");
        default:
          throw new HttpError(404, "not found");
      }
    };
    handle().catch((err) => {
      const { status, body } = describeError(err);
      if (status >= 500) log(`connector ${route}: ${String(body.error)}`);
      if (res.headersSent) return res.destroy();
      req.resume();
      send(res, status, body);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(wantedPort, "127.0.0.1", () => resolve());
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new ConnectorPortError(wantedPort, await probePort(wantedPort));
    }
    throw err;
  }
  const port = (server.address() as AddressInfo).port;
  log(`Zotero Connector listener on 127.0.0.1:${port}`);

  return {
    port,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (staging) await rm(staging, { recursive: true, force: true });
    },
  };
}

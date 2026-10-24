import { createReadStream, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";

/** Content types of what the library stores next to the reader: sources, derived files, figures. */
const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".epub": "application/epub+zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function contentTypeOf(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export const FILES_PREFIX = "/files/";

/** The path segments below `items/` of a request path, or undefined for an unusable path. */
export function fileSegments(pathname: string): string[] | undefined {
  if (!pathname.startsWith(FILES_PREFIX)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice(FILES_PREFIX.length));
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const segments = decoded.split("/");
  if (segments.length < 2) return undefined;
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) {
    return undefined;
  }
  return segments;
}

/**
 * Maps a request path `/files/<citekey>/sources/<hash>.<ext>` to a file below `<library>/items`.
 * Returns undefined for anything that is not a plain file inside that directory: path traversal,
 * hidden segments, symlinks that point out, directories.
 */
export function resolveLibraryFile(libraryRoot: string, pathname: string): string | undefined {
  const segments = fileSegments(pathname);
  if (!segments) return undefined;
  try {
    const base = realpathSync(join(libraryRoot, "items"));
    const real = realpathSync(join(base, ...segments));
    if (!real.startsWith(base + sep)) return undefined;
    return statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves one library file to the renderer. The caller has checked host, origin and token already.
 * HTML is sandboxed, so a converted web page cannot run script in the core's origin.
 */
export async function serveLibraryFile(
  libraryRoot: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  /** Downloads an evicted iCloud file first. `rel` is relative to the library root. */
  ensureLocal?: (rel: string) => Promise<unknown>,
): Promise<void> {
  const fail = (status: number, error: string): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error }));
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    fail(405, "method not allowed");
    return;
  }
  const segments = fileSegments(pathname);
  if (segments && ensureLocal) await ensureLocal(`items/${segments.join("/")}`).catch(() => {});
  const file = resolveLibraryFile(libraryRoot, pathname);
  if (!file) {
    fail(404, "not found");
    return;
  }
  const size = statSync(file).size;
  res.writeHead(200, {
    "content-type": contentTypeOf(file),
    "content-length": size,
    "content-security-policy": "sandbox",
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=0, must-revalidate",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

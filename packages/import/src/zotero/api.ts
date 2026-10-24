import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CitegeistError } from "@citegeist/schema";
import type { AnnotationType, LinkMode, RawCollection, RawItem, RawLibrary } from "./raw.js";

export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiSource {
  port: number;
  /** For tests. Default: the global fetch. */
  fetch?: ApiFetch | undefined;
  /** Items per request; the API allows up to 100. */
  pageSize?: number | undefined;
  signal?: AbortSignal | undefined;
}

type Json = Record<string, unknown>;

const NOT_FIELDS = new Set([
  "key",
  "version",
  "itemType",
  "creators",
  "tags",
  "collections",
  "relations",
  "dateAdded",
  "dateModified",
  "parentItem",
  "linkMode",
  "contentType",
  "charset",
  "filename",
  "md5",
  "mtime",
  "note",
  "deleted",
  "inPublications",
  "annotationType",
  "annotationAuthorName",
  "annotationText",
  "annotationComment",
  "annotationColor",
  "annotationPageLabel",
  "annotationSortIndex",
  "annotationPosition",
  "path",
]);

function unreachable(port: number, detail: string): CitegeistError {
  return new CitegeistError({
    code: "ZOTERO_API_UNREACHABLE",
    message: `the Zotero local API on port ${port} did not answer: ${detail}`,
    fix: "Start Zotero 10 and turn on the local API (Settings, Advanced, 'Allow other applications on this computer to communicate with Zotero'), or import from a copy of zotero.sqlite.",
    recovery: "fix-and-retry",
    context: { port },
  });
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function toItem(j: Json): RawItem | undefined {
  const data = (j.data ?? {}) as Json;
  const meta = (j.meta ?? {}) as Json;
  const key = str(data.key ?? j.key);
  if (!key) return undefined;
  const itemType = str(data.itemType);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (NOT_FIELDS.has(k) || typeof v === "object") continue;
    if (v !== "" && v !== null && v !== undefined) fields[k] = str(v);
  }
  const item: RawItem = {
    key,
    itemType,
    ...(data.dateAdded ? { dateAdded: str(data.dateAdded) } : {}),
    fields,
    ...(meta.parsedDate ? { parsedDate: str(meta.parsedDate) } : {}),
    creators: ((data.creators as Json[] | undefined) ?? []).map((c) => ({
      type: str(c.creatorType),
      ...(c.name !== undefined
        ? { name: str(c.name) }
        : { first: str(c.firstName), last: str(c.lastName) }),
    })),
    tags: ((data.tags as Json[] | undefined) ?? []).map((t) => ({
      name: str(t.tag),
      auto: Number(t.type) === 1,
    })),
    collections: ((data.collections as string[] | undefined) ?? []).map(str),
  };
  if (data.parentItem) item.parentKey = str(data.parentItem);
  if (itemType === "note") item.note = str(data.note);
  if (itemType === "attachment") {
    item.attachment = {
      linkMode: (str(data.linkMode) || "imported_file") as LinkMode,
      ...(data.contentType ? { contentType: str(data.contentType) } : {}),
      ...(data.path ? { path: str(data.path) } : {}),
      ...(data.filename ? { filename: str(data.filename) } : {}),
    };
  }
  if (itemType === "annotation") {
    item.annotation = {
      type: (str(data.annotationType) || "highlight") as AnnotationType,
      text: str(data.annotationText),
      comment: str(data.annotationComment),
      ...(data.annotationColor ? { color: str(data.annotationColor) } : {}),
      ...(data.annotationPageLabel ? { pageLabel: str(data.annotationPageLabel) } : {}),
      ...(data.annotationSortIndex ? { sortIndex: str(data.annotationSortIndex) } : {}),
      position: str(data.annotationPosition),
    };
  }
  return item;
}

/** Reads the library through the Zotero 10 local API (port 23119 by default). */
export async function readZoteroApi(source: ApiSource): Promise<RawLibrary> {
  const doFetch: ApiFetch = source.fetch ?? ((url, init) => fetch(url, init));
  const base = `http://127.0.0.1:${source.port}/api/users/0`;
  const pageSize = source.pageSize ?? 100;
  const get = async (url: string, init?: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, { ...init, ...(source.signal ? { signal: source.signal } : {}) });
    } catch (err) {
      if (source.signal?.aborted) throw err;
      throw unreachable(source.port, (err as Error).message);
    }
  };

  async function pages(path: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let start = 0; ; start += pageSize) {
      const sep = path.includes("?") ? "&" : "?";
      const res = await get(`${base}${path}${sep}limit=${pageSize}&start=${start}&format=json`);
      if (!res.ok) {
        throw unreachable(
          source.port,
          res.status === 403
            ? "HTTP 403, the local API is switched off in Zotero"
            : `HTTP ${res.status}`,
        );
      }
      const batch = (await res.json()) as Json[];
      out.push(...batch);
      const total = Number(res.headers.get("Total-Results") ?? 0);
      if (batch.length < pageSize || (total > 0 && out.length >= total)) break;
    }
    return out;
  }

  const items = new Map<string, RawItem>();
  for (const j of await pages("/items")) {
    const it = toItem(j);
    if (it) items.set(it.key, it);
  }
  // Depending on the version annotations are not part of /items, so ask for them.
  try {
    for (const j of await pages("/items?itemType=annotation")) {
      const it = toItem(j);
      if (it) items.set(it.key, it);
    }
  } catch (err) {
    if (!(err instanceof CitegeistError)) throw err;
  }

  const collections: RawCollection[] = (await pages("/collections")).map((j) => {
    const d = (j.data ?? {}) as Json;
    return {
      key: str(d.key ?? j.key),
      name: str(d.name),
      ...(d.parentCollection ? { parentKey: str(d.parentCollection) } : {}),
    };
  });

  let tmp: string | undefined;
  const tmpDir = (): string => {
    tmp ??= mkdtempSync(join(tmpdir(), "citegeist-zotero-api-"));
    return tmp;
  };

  return {
    label: `Zotero (local API, port ${source.port})`,
    items: [...items.values()],
    collections,
    canCheckFiles: false,
    dispose() {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    },
    async resolveFile(item, opts) {
      const a = item.attachment;
      if (!a) return { missing: "not an attachment" };
      if (a.linkMode === "linked_file") {
        const p = a.path ?? "";
        if (p.startsWith("attachments:")) {
          if (!opts.linkedFilesBase) {
            return { missing: "linked file, set the base directory for linked attachments" };
          }
          const abs = join(opts.linkedFilesBase, p.slice("attachments:".length));
          return existsSync(abs) ? { path: abs } : { missing: `file not found: ${abs}` };
        }
        return isAbsolute(p) && existsSync(p) ? { path: p } : { missing: `file not found: ${p}` };
      }
      if (!opts.fetch) return {};
      // Zotero 10 can name the file on disk; otherwise the bytes come over HTTP.
      try {
        const url = await get(`${base}/items/${item.key}/file/view/url`);
        if (url.ok) {
          const text = (await url.text()).trim();
          if (text.startsWith("file://")) {
            const p = fileURLToPath(text);
            if (existsSync(p)) return { path: p };
          }
        }
        const res = await get(`${base}/items/${item.key}/file`, { redirect: "manual" });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location?.startsWith("file://")) {
          const p = fileURLToPath(location);
          return existsSync(p) ? { path: p } : { missing: `file not found: ${p}` };
        }
        if (!res.ok) return { missing: `Zotero returned HTTP ${res.status} for the file` };
        const dir = join(tmpDir(), item.key);
        mkdirSync(dir, { recursive: true });
        const name = basename(a.filename || item.fields.filename || `${item.key}.pdf`);
        const out = join(dir, name);
        writeFileSync(out, Buffer.from(await res.arrayBuffer()));
        return { path: out };
      } catch (err) {
        if (err instanceof CitegeistError) return { missing: err.detail.message };
        return { missing: (err as Error).message };
      }
    },
  };
}

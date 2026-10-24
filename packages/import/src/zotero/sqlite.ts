import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { CitegeistError } from "@citegeist/schema";
import Database from "better-sqlite3";
import type {
  AnnotationType,
  LinkMode,
  RawCollection,
  RawCreator,
  RawItem,
  RawLibrary,
} from "./raw.js";

const LINK_MODES: LinkMode[] = [
  "imported_file",
  "imported_url",
  "linked_file",
  "linked_url",
  "embedded_image",
];
const ANNOTATION_TYPES: Record<number, AnnotationType> = {
  1: "highlight",
  2: "note",
  3: "image",
  4: "ink",
  5: "underline",
  6: "text",
};

function importError(code: string, message: string, fix: string, context: Record<string, unknown>) {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

/** Finds zotero.sqlite: the path itself, or the file inside a Zotero data directory. */
export function locateZoteroDb(path: string): string {
  let target = path;
  if (existsSync(path) && statSync(path).isDirectory()) target = join(path, "zotero.sqlite");
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw importError(
      "IMPORT_SOURCE_NOT_FOUND",
      `no zotero.sqlite at ${target}`,
      "Pass the Zotero data directory (on macOS usually ~/Zotero) or the path of zotero.sqlite.",
      { path },
    );
  }
  return target;
}

/**
 * Copies zotero.sqlite with its write-ahead log to a temporary folder. Zotero 10 runs the database
 * in WAL mode, so the newest changes may live only in the -wal file. The original is only read.
 */
export function copyZoteroDb(dbPath: string): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "citegeist-zotero-"));
  const db = join(dir, "zotero.sqlite");
  copyFileSync(dbPath, db);
  // The -shm file is an index over the log that SQLite rebuilds, and a stale copy would mislead it.
  if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${db}-wal`);
  return { dir, db };
}

type Row = Record<string, unknown>;

const str = (v: unknown): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);

export interface SqliteSource {
  path: string;
  storage?: string | undefined;
}

export function readZoteroSqlite(source: SqliteSource): RawLibrary {
  const dbPath = locateZoteroDb(source.path);
  const storage = source.storage ?? join(dirname(dbPath), "storage");
  const copy = copyZoteroDb(dbPath);
  let db: Database.Database | undefined;
  const dispose = (): void => {
    db?.close();
    db = undefined;
    rmSync(copy.dir, { recursive: true, force: true });
  };
  try {
    db = new Database(copy.db, { readonly: true, fileMustExist: true });
    const lib = readAll(db, storage, dbPath);
    return { ...lib, dispose };
  } catch (err) {
    dispose();
    if (err instanceof CitegeistError) throw err;
    throw importError(
      "IMPORT_SOURCE_UNREADABLE",
      `zotero.sqlite could not be read: ${(err as Error).message}`,
      "Check that the file is a Zotero database. Quit Zotero and try again if the file is damaged.",
      { path: dbPath },
    );
  }
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function readAll(
  db: Database.Database,
  storage: string,
  dbPath: string,
): Omit<RawLibrary, "dispose"> {
  if (!hasTable(db, "items") || !hasTable(db, "itemData")) {
    throw importError(
      "IMPORT_SOURCE_UNREADABLE",
      `${basename(dbPath)} does not look like a Zotero database (no items table)`,
      "Pass the zotero.sqlite of a Zotero installation.",
      { path: dbPath },
    );
  }
  const all = (sql: string, ...params: unknown[]): Row[] => db.prepare(sql).all(...params) as Row[];

  const userLibrary = hasTable(db, "libraries")
    ? (db
        .prepare("SELECT libraryID FROM libraries WHERE type = 'user' ORDER BY libraryID LIMIT 1")
        .get() as { libraryID: number } | undefined)
    : undefined;
  const libraryID = userLibrary?.libraryID ?? 1;

  const trashed = new Set<number>();
  if (hasTable(db, "deletedItems")) {
    for (const r of all("SELECT itemID FROM deletedItems")) trashed.add(Number(r.itemID));
  }

  const byId = new Map<number, RawItem>();
  const keyOf = new Map<number, string>();
  for (const r of all(
    `SELECT i.itemID, i.key, i.dateAdded, t.typeName
     FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID
     WHERE i.libraryID = ?`,
    libraryID,
  )) {
    const id = Number(r.itemID);
    if (trashed.has(id)) continue;
    keyOf.set(id, str(r.key));
    byId.set(id, {
      key: str(r.key),
      itemType: str(r.typeName),
      ...(r.dateAdded ? { dateAdded: isoOf(str(r.dateAdded)) } : {}),
      fields: {},
      creators: [],
      tags: [],
      collections: [],
    });
  }

  for (const r of all(
    `SELECT d.itemID, f.fieldName, v.value
     FROM itemData d
     JOIN fields f ON f.fieldID = d.fieldID
     JOIN itemDataValues v ON v.valueID = d.valueID`,
  )) {
    const item = byId.get(Number(r.itemID));
    if (item) item.fields[str(r.fieldName)] = str(r.value);
  }

  for (const r of all(
    `SELECT ic.itemID, ct.creatorType, c.firstName, c.lastName, c.fieldMode
     FROM itemCreators ic
     JOIN creators c ON c.creatorID = ic.creatorID
     JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
     ORDER BY ic.itemID, ic.orderIndex`,
  )) {
    const item = byId.get(Number(r.itemID));
    if (!item) continue;
    const creator: RawCreator = { type: str(r.creatorType) };
    if (Number(r.fieldMode) === 1) creator.name = str(r.lastName);
    else {
      creator.last = str(r.lastName);
      creator.first = str(r.firstName);
    }
    item.creators.push(creator);
  }

  for (const r of all(
    "SELECT it.itemID, t.name, it.type FROM itemTags it JOIN tags t ON t.tagID = it.tagID ORDER BY it.itemID, t.name",
  )) {
    byId.get(Number(r.itemID))?.tags.push({ name: str(r.name), auto: Number(r.type) === 1 });
  }

  const collections: RawCollection[] = [];
  if (hasTable(db, "collections")) {
    const gone = new Set<number>();
    if (hasTable(db, "deletedCollections")) {
      for (const r of all("SELECT collectionID FROM deletedCollections")) {
        gone.add(Number(r.collectionID));
      }
    }
    const keyById = new Map<number, string>();
    const rows = all(
      "SELECT collectionID, key, collectionName, parentCollectionID FROM collections WHERE libraryID = ?",
      libraryID,
    ).filter((r) => !gone.has(Number(r.collectionID)));
    for (const r of rows) keyById.set(Number(r.collectionID), str(r.key));
    for (const r of rows) {
      const parent =
        r.parentCollectionID === null ? undefined : keyById.get(Number(r.parentCollectionID));
      collections.push({
        key: str(r.key),
        name: str(r.collectionName),
        ...(parent ? { parentKey: parent } : {}),
      });
    }
    for (const r of all("SELECT collectionID, itemID FROM collectionItems")) {
      const ck = keyById.get(Number(r.collectionID));
      const item = byId.get(Number(r.itemID));
      if (ck && item) item.collections.push(ck);
    }
  }

  for (const r of all("SELECT itemID, parentItemID, note, title FROM itemNotes")) {
    const item = byId.get(Number(r.itemID));
    if (!item) continue;
    item.itemType = "note";
    item.note = str(r.note);
    if (r.parentItemID !== null) {
      const parent = keyOf.get(Number(r.parentItemID));
      if (parent) item.parentKey = parent;
      else byId.delete(Number(r.itemID));
    }
  }

  for (const r of all(
    "SELECT itemID, parentItemID, linkMode, contentType, path FROM itemAttachments",
  )) {
    const item = byId.get(Number(r.itemID));
    if (!item) continue;
    item.attachment = {
      linkMode: LINK_MODES[Number(r.linkMode)] ?? "imported_file",
      ...(r.contentType ? { contentType: str(r.contentType) } : {}),
      ...(r.path ? { path: str(r.path) } : {}),
    };
    if (r.parentItemID !== null) {
      const parent = keyOf.get(Number(r.parentItemID));
      if (parent) item.parentKey = parent;
      else byId.delete(Number(r.itemID));
    }
  }

  if (hasTable(db, "itemAnnotations")) {
    for (const r of all(
      `SELECT itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal
       FROM itemAnnotations`,
    )) {
      const item = byId.get(Number(r.itemID));
      if (!item) continue;
      item.itemType = "annotation";
      item.annotation = {
        type: ANNOTATION_TYPES[Number(r.type)] ?? "highlight",
        text: str(r.text),
        comment: str(r.comment),
        ...(r.color ? { color: str(r.color) } : {}),
        ...(r.pageLabel ? { pageLabel: str(r.pageLabel) } : {}),
        ...(r.sortIndex ? { sortIndex: str(r.sortIndex) } : {}),
        position: str(r.position),
        isExternal: Number(r.isExternal) === 1,
      };
      const parent = keyOf.get(Number(r.parentItemID));
      if (parent) item.parentKey = parent;
      else byId.delete(Number(r.itemID));
    }
  }

  return {
    label: `Zotero (${basename(dbPath)})`,
    items: [...byId.values()],
    collections,
    canCheckFiles: true,
    async resolveFile(item, opts) {
      const a = item.attachment;
      if (!a?.path) return { missing: "the attachment has no file path" };
      const path = a.path;
      let abs: string | undefined;
      if (path.startsWith("storage:")) abs = join(storage, item.key, path.slice("storage:".length));
      else if (path.startsWith("attachments:")) {
        if (!opts.linkedFilesBase) {
          return { missing: "linked file, set the base directory for linked attachments" };
        }
        abs = join(opts.linkedFilesBase, path.slice("attachments:".length));
      } else if (isAbsolute(path)) abs = path;
      if (!abs) return { missing: `unknown path form '${path}'` };
      if (!existsSync(abs)) return { missing: `file not found: ${abs}` };
      return { path: abs };
    },
  };
}

/** Zotero stores UTC times as "YYYY-MM-DD HH:MM:SS". */
function isoOf(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(raw);
  return m ? `${m[1]}T${m[2]}.000Z` : raw;
}

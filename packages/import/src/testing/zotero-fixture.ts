// Builds a small synthetic Zotero data directory (zotero.sqlite in WAL mode plus storage/) for
// tests. The tables and columns follow userdata.sql of Zotero 10 (internal Zotero-parity research
// section 1.2); only the tables the importer reads exist. No real Zotero library is involved.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const DDL = `
CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT NOT NULL, editable INT NOT NULL,
  filesEditable INT NOT NULL, version INT NOT NULL DEFAULT 0, storageVersion INT NOT NULL DEFAULT 0,
  lastSync INT NOT NULL DEFAULT 0, archived INT NOT NULL DEFAULT 0);
CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT UNIQUE, templateItemTypeID INT, display INT DEFAULT 1);
CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT UNIQUE, fieldFormatID INT);
CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT UNIQUE);
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT NOT NULL,
  dateAdded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, dateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, libraryID INT NOT NULL, key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 0, synced INT NOT NULL DEFAULT 0, UNIQUE (libraryID, key));
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value UNIQUE);
CREATE TABLE itemData (itemID INT, fieldID INT, valueID, PRIMARY KEY (itemID, fieldID));
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT, UNIQUE (lastName, firstName, fieldMode));
CREATE TABLE itemCreators (itemID INT NOT NULL, creatorID INT NOT NULL, creatorTypeID INT DEFAULT 1,
  orderIndex INT NOT NULL DEFAULT 0, PRIMARY KEY (itemID, creatorID, creatorTypeID, orderIndex));
CREATE TABLE itemNotes (itemID INTEGER PRIMARY KEY, parentItemID INT, note TEXT, title TEXT);
CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT,
  charsetID INT, path TEXT, syncState INT DEFAULT 0, storageModTime INT, storageHash TEXT, lastProcessedModificationTime INT);
CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INT NOT NULL, type INTEGER NOT NULL,
  authorName TEXT, text TEXT, comment TEXT, color TEXT, pageLabel TEXT, sortIndex TEXT NOT NULL,
  position TEXT NOT NULL, isExternal INT NOT NULL);
CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE itemTags (itemID INT NOT NULL, tagID INT NOT NULL, type INT NOT NULL, PRIMARY KEY (itemID, tagID));
CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT NOT NULL, parentCollectionID INT DEFAULT NULL,
  clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, libraryID INT NOT NULL, key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 0, synced INT NOT NULL DEFAULT 0, UNIQUE (libraryID, key));
CREATE TABLE collectionItems (collectionID INT NOT NULL, itemID INT NOT NULL, orderIndex INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collectionID, itemID));
CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY, dateDeleted DEFAULT CURRENT_TIMESTAMP NOT NULL);
CREATE TABLE deletedCollections (collectionID INTEGER PRIMARY KEY, dateDeleted DEFAULT CURRENT_TIMESTAMP NOT NULL);
`;

export const LINK_MODE = {
  imported_file: 0,
  imported_url: 1,
  linked_file: 2,
  linked_url: 3,
  embedded_image: 4,
} as const;
export const ANNOTATION_TYPE = {
  highlight: 1,
  note: 2,
  image: 3,
  ink: 4,
  underline: 5,
  text: 6,
} as const;

export interface FixtureCreator {
  type: string;
  first?: string;
  last: string;
  /** Single-field name (fieldMode 1). */
  single?: boolean;
}

export interface FixtureItem {
  key: string;
  type: string;
  fields?: Record<string, string>;
  creators?: FixtureCreator[];
  tags?: { name: string; auto?: boolean }[];
  collections?: string[];
  dateAdded?: string;
  trashed?: boolean;
}

export interface FixtureAnnotation {
  key: string;
  type: keyof typeof ANNOTATION_TYPE;
  text?: string;
  comment?: string;
  color?: string;
  pageLabel?: string;
  sortIndex: string;
  position: unknown;
  tags?: string[];
}

/** A minimal PDF-looking file. The importer copies it; nothing parses it in these tests. */
export function tinyPdf(label: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );
}

export class ZoteroFixture {
  readonly db: Database.Database;
  private readonly ids = new Map<string, number>();
  private nextId = 1;

  constructor(
    readonly dir: string,
    opts: { walAutocheckpoint?: boolean } = {},
  ) {
    mkdirSync(join(dir, "storage"), { recursive: true });
    this.db = new Database(join(dir, "zotero.sqlite"));
    this.db.pragma("journal_mode = WAL");
    if (opts.walAutocheckpoint === false) this.db.pragma("wal_autocheckpoint = 0");
    this.db.exec(DDL);
    this.db
      .prepare(
        "INSERT INTO libraries (libraryID, type, editable, filesEditable) VALUES (1, 'user', 1, 1)",
      )
      .run();
    this.db
      .prepare(
        "INSERT INTO libraries (libraryID, type, editable, filesEditable) VALUES (2, 'group', 1, 1)",
      )
      .run();
  }

  get dbPath(): string {
    return join(this.dir, "zotero.sqlite");
  }

  private lookup(table: string, col: string, idCol: string, value: string): number {
    this.db.prepare(`INSERT OR IGNORE INTO ${table} (${col}) VALUES (?)`).run(value);
    return (
      this.db.prepare(`SELECT ${idCol} AS id FROM ${table} WHERE ${col} = ?`).get(value) as {
        id: number;
      }
    ).id;
  }

  private itemId(key: string): number {
    const id = this.ids.get(key);
    if (id === undefined) throw new Error(`unknown fixture item ${key}`);
    return id;
  }

  addCollection(key: string, name: string, parent?: string): void {
    const id = this.nextId++;
    this.ids.set(`collection:${key}`, id);
    const parentId = parent ? this.ids.get(`collection:${parent}`) : null;
    this.db
      .prepare(
        "INSERT INTO collections (collectionID, collectionName, parentCollectionID, libraryID, key) VALUES (?, ?, ?, 1, ?)",
      )
      .run(id, name, parentId ?? null, key);
  }

  addItem(item: FixtureItem, libraryID = 1): number {
    const id = this.nextId++;
    this.ids.set(item.key, id);
    const typeId = this.lookup("itemTypes", "typeName", "itemTypeID", item.type);
    this.db
      .prepare(
        "INSERT INTO items (itemID, itemTypeID, dateAdded, libraryID, key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, typeId, item.dateAdded ?? "2024-05-06 07:08:09", libraryID, item.key);
    for (const [name, value] of Object.entries(item.fields ?? {})) {
      const fieldId = this.lookup("fields", "fieldName", "fieldID", name);
      const valueId = this.lookup("itemDataValues", "value", "valueID", value);
      this.db
        .prepare("INSERT INTO itemData (itemID, fieldID, valueID) VALUES (?, ?, ?)")
        .run(id, fieldId, valueId);
    }
    (item.creators ?? []).forEach((c, i) => {
      const typeRow = this.lookup("creatorTypes", "creatorType", "creatorTypeID", c.type);
      this.db
        .prepare("INSERT OR IGNORE INTO creators (firstName, lastName, fieldMode) VALUES (?, ?, ?)")
        .run(c.single ? "" : (c.first ?? ""), c.last, c.single ? 1 : 0);
      const creator = this.db
        .prepare(
          "SELECT creatorID FROM creators WHERE lastName = ? AND firstName = ? AND fieldMode = ?",
        )
        .get(c.last, c.single ? "" : (c.first ?? ""), c.single ? 1 : 0) as { creatorID: number };
      this.db
        .prepare(
          "INSERT INTO itemCreators (itemID, creatorID, creatorTypeID, orderIndex) VALUES (?, ?, ?, ?)",
        )
        .run(id, creator.creatorID, typeRow, i);
    });
    for (const t of item.tags ?? []) this.addTag(id, t.name, t.auto ? 1 : 0);
    for (const c of item.collections ?? []) {
      this.db
        .prepare("INSERT INTO collectionItems (collectionID, itemID) VALUES (?, ?)")
        .run(this.ids.get(`collection:${c}`), id);
    }
    if (item.trashed) this.db.prepare("INSERT INTO deletedItems (itemID) VALUES (?)").run(id);
    return id;
  }

  private addTag(itemId: number, name: string, type: number): void {
    const tagId = this.lookup("tags", "name", "tagID", name);
    this.db
      .prepare("INSERT OR IGNORE INTO itemTags (itemID, tagID, type) VALUES (?, ?, ?)")
      .run(itemId, tagId, type);
  }

  addNote(key: string, html: string, parent?: string, extra: Partial<FixtureItem> = {}): void {
    const id = this.addItem({ key, type: "note", ...extra });
    this.db
      .prepare("INSERT INTO itemNotes (itemID, parentItemID, note, title) VALUES (?, ?, ?, ?)")
      .run(
        id,
        parent ? this.itemId(parent) : null,
        html,
        html
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 60),
      );
  }

  /** Adds an attachment row; a `file` creates storage/<key>/<name> with the given content. */
  addAttachment(
    key: string,
    opts: {
      parent?: string;
      linkMode?: keyof typeof LINK_MODE;
      contentType?: string;
      path?: string;
      title?: string;
      file?: { name: string; content: Buffer | string };
      collections?: string[];
    },
  ): void {
    const id = this.addItem({
      key,
      type: "attachment",
      ...(opts.title ? { fields: { title: opts.title } } : {}),
      ...(opts.collections ? { collections: opts.collections } : {}),
    });
    this.db
      .prepare(
        "INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        id,
        opts.parent ? this.itemId(opts.parent) : null,
        LINK_MODE[opts.linkMode ?? "imported_file"],
        opts.contentType ?? "application/pdf",
        opts.path ?? null,
      );
    if (opts.file) {
      mkdirSync(join(this.dir, "storage", key), { recursive: true });
      writeFileSync(join(this.dir, "storage", key, opts.file.name), opts.file.content);
    }
  }

  addAnnotation(parent: string, a: FixtureAnnotation): void {
    const id = this.addItem({
      key: a.key,
      type: "annotation",
      tags: (a.tags ?? []).map((name) => ({ name })),
    });
    this.db
      .prepare(
        "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
      )
      .run(
        id,
        this.itemId(parent),
        ANNOTATION_TYPE[a.type],
        a.text ?? null,
        a.comment ?? null,
        a.color ?? "#ffd400",
        a.pageLabel ?? null,
        a.sortIndex,
        JSON.stringify(a.position),
      );
  }

  close(): void {
    this.db.close();
  }
}

const NOTE_HTML =
  '<div data-schema-version="9"><h1>Reading notes</h1><p>The paper argues that <strong>systems</strong> differ from their <em>environment</em>.</p><ul><li>first point</li><li>second point with <a href="https://example.org/x">a link</a></li></ul><blockquote><p>A quoted line.</p></blockquote></div>';

/**
 * A library with the cases the importer has to handle: two nested collections, a journal article
 * with a Better BibTeX key, a note and an annotated PDF, a book, a book section, a case, a
 * preprint with a missing file, a stand-alone PDF and note, a trashed item, a duplicate pair and a
 * group library item that must be ignored.
 */
export function buildSampleLibrary(
  dir: string,
  opts: { walAutocheckpoint?: boolean } = {},
): ZoteroFixture {
  const z = new ZoteroFixture(dir, opts);
  z.addCollection("COLL0001", "Thesis");
  z.addCollection("COLL0002", "Chapter 2", "COLL0001");

  z.addItem({
    key: "ITEM0001",
    type: "journalArticle",
    dateAdded: "2023-11-02 10:30:00",
    fields: {
      title: "Social Systems and Their Environment",
      publicationTitle: "Journal of Systems",
      volume: "12",
      issue: "3",
      pages: "31–45",
      date: "1984-03-00 March 1984",
      DOI: "10.1000/xyz123",
      abstractNote: "An abstract about systems.",
      language: "English",
      extra: "Citation Key: Luhmann1984\nPMID: 12345\nPeer reviewed in 1984",
      accessDate: "2024-01-15 00:00:00",
    },
    creators: [
      { type: "author", first: "Niklas", last: "Luhmann" },
      { type: "author", first: "Jürgen", last: "Habermas" },
      { type: "editor", first: "Ada", last: "Editor" },
    ],
    tags: [{ name: "systems theory" }, { name: "auto-tag", auto: true }],
    collections: ["COLL0001", "COLL0002"],
  });
  z.addNote("NOTE0001", NOTE_HTML, "ITEM0001");
  z.addAttachment("ATTA0001", {
    parent: "ITEM0001",
    path: "storage:paper.pdf",
    file: { name: "paper.pdf", content: tinyPdf("paper") },
  });
  const rect = [[100.5, 600.25, 300.75, 612.5]];
  z.addAnnotation("ATTA0001", {
    key: "ANNO0001",
    type: "highlight",
    text: "Systems differ from their environment.",
    comment: "This is the core claim.",
    pageLabel: "33",
    sortIndex: "00001|000100|00200",
    position: { pageIndex: 1, rects: rect },
    tags: ["core"],
  });
  z.addAnnotation("ATTA0001", {
    key: "ANNO0002",
    type: "underline",
    text: "Second passage.",
    sortIndex: "00002|000050|00100",
    position: {
      pageIndex: 2,
      rects: [
        [10, 20, 30, 40],
        [12, 44, 80, 60],
      ],
    },
  });
  z.addAnnotation("ATTA0001", {
    key: "ANNO0003",
    type: "image",
    sortIndex: "00004|000000|00000",
    position: { pageIndex: 4, rects: [[0, 0, 50, 50]] },
  });
  z.addAnnotation("ATTA0001", {
    key: "ANNO0004",
    type: "note",
    comment: "A sticky note without text.",
    sortIndex: "00005|000000|00000",
    position: { pageIndex: 5, rects: [[0, 0, 5, 5]] },
  });

  z.addItem({
    key: "ITEM0002",
    type: "book",
    fields: {
      title: "Die Gesellschaft der Gesellschaft",
      date: "1997-00-00 1997",
      ISBN: "978-3-518-28960-7",
      publisher: "Suhrkamp",
      place: "Frankfurt am Main",
      language: "de-DE",
    },
    creators: [{ type: "author", first: "Niklas", last: "Luhmann" }],
    collections: ["COLL0001"],
  });

  z.addItem({
    key: "ITEM0003",
    type: "bookSection",
    fields: {
      title: "On Methods",
      bookTitle: "Handbook of Research",
      date: "2010",
      pages: "10-20",
      publisher: "Springer",
    },
    creators: [
      { type: "author", first: "Maria", last: "Muster" },
      { type: "editor", first: "Hans", last: "Herausgeber" },
      { type: "bookAuthor", first: "Hanna", last: "Buch" },
    ],
  });

  z.addItem({
    key: "ITEM0004",
    type: "case",
    fields: {
      caseName: "Brown v. Board of Education",
      court: "Supreme Court",
      dateDecided: "1954-05-17 May 17, 1954",
      reporter: "U.S.",
    },
    creators: [{ type: "author", last: "Warren", first: "Earl" }],
  });

  z.addItem({
    key: "ITEM0005",
    type: "preprint",
    fields: {
      title: "Attention Is All You Need",
      date: "2017-06-12 June 12, 2017",
      repository: "arXiv",
      archiveID: "arXiv:1706.03762",
      url: "https://arxiv.org/abs/1706.03762",
    },
    creators: [{ type: "author", first: "Ashish", last: "Vaswani" }],
  });
  z.addAttachment("ATTA0005", { parent: "ITEM0005", path: "storage:missing.pdf" });

  z.addItem({
    key: "ITEM0006",
    type: "report",
    fields: { title: "Education at a Glance", date: "2022", institution: "OECD" },
    creators: [{ type: "author", last: "OECD", single: true }],
  });

  z.addAttachment("ATTA0007", {
    title: "PDF",
    path: "storage:Loose Paper.pdf",
    file: { name: "Loose Paper.pdf", content: tinyPdf("loose") },
    collections: ["COLL0001"],
  });
  z.addNote("NOTE0002", "<p>A stand-alone note about nothing in particular.</p>");

  z.addItem({
    key: "ITEM0008",
    type: "journalArticle",
    fields: { title: "Trashed Article", date: "2001" },
    trashed: true,
  });
  // Same DOI as ITEM0001 (upper case), added a second time by mistake.
  z.addItem({
    key: "ITEM0009",
    type: "journalArticle",
    fields: { title: "Social systems and their environment.", date: "1984", DOI: "10.1000/XYZ123" },
    creators: [{ type: "author", first: "N.", last: "Luhmann" }],
  });
  z.addItem(
    { key: "GROUP001", type: "book", fields: { title: "A Book In A Group Library", date: "2020" } },
    2,
  );
  return z;
}

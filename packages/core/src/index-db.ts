import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Block,
  CardBody,
  CardFrontmatter,
  ItemFrontmatter,
  NoteFrontmatter,
  ProjectFrontmatter,
} from "@citegeist/schema";
import { Creator } from "@citegeist/schema";
import Database from "better-sqlite3";
import type { FileKind } from "./classify.js";
import type { Issue } from "./parse.js";
import { stemmedText } from "./text.js";
import { extractWikiLinks, wikiTarget } from "./wikilinks.js";

/** 2: cards table has a nullable kind and a note column instead of core, own_words and comment. */
export const INDEX_SCHEMA_VERSION = 2;

const TABLES = [
  "items",
  "creators",
  "cards",
  "notes",
  "links",
  "projects",
  "tags",
  "project_members",
  "blocks",
  "docs",
] as const;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  path TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL,
  size INTEGER NOT NULL, mtime_ms REAL NOT NULL
);
CREATE TABLE problems (
  path TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (path, code)
);
CREATE TABLE items (
  citekey TEXT PRIMARY KEY, id TEXT NOT NULL, path TEXT NOT NULL,
  title TEXT NOT NULL, subtitle TEXT, type TEXT NOT NULL, year TEXT, authors TEXT,
  language TEXT, status TEXT NOT NULL, inbox INTEGER NOT NULL,
  doi TEXT, isbn TEXT, url TEXT, abstract TEXT, source_count INTEGER NOT NULL,
  created TEXT NOT NULL, modified TEXT, frontmatter_json TEXT NOT NULL
);
CREATE UNIQUE INDEX items_id ON items(id);
CREATE INDEX items_path ON items(path);
CREATE INDEX items_doi ON items(doi);
CREATE TABLE creators (
  path TEXT NOT NULL, citekey TEXT NOT NULL, role TEXT NOT NULL, pos INTEGER NOT NULL,
  family TEXT, given TEXT, literal TEXT, orcid TEXT
);
CREATE INDEX creators_path ON creators(path);
CREATE INDEX creators_family ON creators(family);
CREATE TABLE cards (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, citekey TEXT NOT NULL, source TEXT, kind TEXT,
  quote TEXT NOT NULL, quote_ok INTEGER NOT NULL, paraphrase TEXT, note TEXT,
  created TEXT NOT NULL, frontmatter_json TEXT NOT NULL, body_json TEXT NOT NULL
);
CREATE INDEX cards_path ON cards(path);
CREATE INDEX cards_citekey ON cards(citekey);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
  type TEXT NOT NULL, created TEXT NOT NULL, modified TEXT, frontmatter_json TEXT NOT NULL
);
CREATE INDEX notes_path ON notes(path);
CREATE INDEX notes_slug ON notes(slug);
CREATE TABLE links (
  path TEXT NOT NULL, src_kind TEXT NOT NULL, src_ref TEXT NOT NULL, dst TEXT NOT NULL,
  anchor TEXT, rel TEXT, status TEXT NOT NULL, why TEXT, evidence TEXT, actor TEXT,
  origin TEXT NOT NULL
);
CREATE INDEX links_path ON links(path);
CREATE INDEX links_src ON links(src_kind, src_ref);
CREATE INDEX links_dst ON links(dst);
CREATE TABLE projects (
  slug TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  style TEXT NOT NULL, locale TEXT NOT NULL, created TEXT NOT NULL, frontmatter_json TEXT NOT NULL
);
CREATE INDEX projects_path ON projects(path);
CREATE TABLE tags (path TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX tags_path ON tags(path);
CREATE INDEX tags_owner ON tags(kind, ref);
CREATE INDEX tags_tag ON tags(tag);
CREATE TABLE project_members (
  path TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, project TEXT NOT NULL
);
CREATE INDEX pm_path ON project_members(path);
CREATE INDEX pm_owner ON project_members(kind, ref);
CREATE INDEX pm_project ON project_members(project);
CREATE TABLE blocks (
  path TEXT NOT NULL, citekey TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL,
  type TEXT NOT NULL, sec TEXT, flow TEXT NOT NULL, page TEXT, text TEXT NOT NULL,
  PRIMARY KEY (citekey, source, id)
);
CREATE INDEX blocks_path ON blocks(path);
CREATE TABLE docs (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
  citekey TEXT, title TEXT NOT NULL
);
CREATE INDEX docs_path ON docs(path);
CREATE INDEX docs_ref ON docs(kind, ref);
CREATE VIRTUAL TABLE fts_words USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE fts_tri USING fts5(title, body, tokenize = 'trigram');
CREATE VIEW resolved_links AS
  SELECT l.*,
    CASE WHEN i.citekey IS NOT NULL THEN 'item'
         WHEN c.id IS NOT NULL THEN 'card'
         WHEN n.id IS NOT NULL THEN 'note' END AS dst_kind,
    COALESCE(i.citekey, c.id, n.id) AS dst_ref
  FROM links l
  LEFT JOIN items i ON i.citekey = l.dst
  LEFT JOIN cards c ON c.id = l.dst
  LEFT JOIN notes n ON n.slug = l.dst OR n.id = l.dst;
`;

const CREATOR_ROLES = [
  "author",
  "editor",
  "translator",
  "contributor",
  "container-author",
  "director",
  "interviewer",
  "recipient",
  "reviewed-author",
  "composer",
  "illustrator",
  "collection-editor",
  "editorial-director",
  "original-author",
  "organizer",
  "chair",
  "compiler",
  "curator",
  "host",
  "narrator",
  "producer",
  "performer",
];

export interface FileRecord {
  path: string;
  kind: FileKind;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface Scope {
  project?: string | undefined;
  tags?: string[] | undefined;
  status?: string | undefined;
  inbox?: boolean | undefined;
}

type Row = Record<string, unknown>;

/** The local SQLite index: everything in it can be rebuilt from the library folder. */
export class Index {
  readonly db: Database.Database;
  private readonly stmts = new Map<string, Database.Statement>();

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = OFF");
    if (this.meta("schema_version") !== String(INDEX_SCHEMA_VERSION)) this.reset();
  }

  close(): void {
    this.db.close();
  }

  private stmt(sql: string): Database.Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  meta(key: string): string | undefined {
    try {
      const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return r?.value;
    } catch {
      return undefined;
    }
  }

  setMeta(key: string, value: string): void {
    this.stmt("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, value);
  }

  /** Drops everything and recreates the empty schema. */
  reset(): void {
    this.stmts.clear();
    this.db.transaction(() => {
      this.db.exec("DROP VIEW IF EXISTS resolved_links");
      for (const t of ["fts_words", "fts_tri", ...TABLES, "files", "problems", "meta"]) {
        this.db.exec(`DROP TABLE IF EXISTS ${t}`);
      }
      this.db.exec(SCHEMA);
      this.setMeta("schema_version", String(INDEX_SCHEMA_VERSION));
    })();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Files and problems -----------------------------------------------------------------------

  getFile(path: string): FileRecord | undefined {
    const r = this.stmt("SELECT * FROM files WHERE path = ?").get(path) as Row | undefined;
    return r ? toFileRecord(r) : undefined;
  }

  listFiles(): FileRecord[] {
    return (this.stmt("SELECT * FROM files").all() as Row[]).map(toFileRecord);
  }

  putFile(f: FileRecord): void {
    this.stmt(
      "INSERT OR REPLACE INTO files(path, kind, hash, size, mtime_ms) VALUES (?, ?, ?, ?, ?)",
    ).run(f.path, f.kind, f.hash, f.size, f.mtimeMs);
  }

  setProblems(path: string, issues: Issue[]): void {
    this.stmt("DELETE FROM problems WHERE path = ?").run(path);
    for (const i of issues) {
      this.stmt("INSERT OR REPLACE INTO problems(path, code, message) VALUES (?, ?, ?)").run(
        path,
        i.code,
        i.message,
      );
    }
  }

  problems(): { path: string; code: string; message: string }[] {
    return this.stmt("SELECT path, code, message FROM problems ORDER BY path, code").all() as {
      path: string;
      code: string;
      message: string;
    }[];
  }

  problemPaths(): string[] {
    return (this.stmt("SELECT DISTINCT path FROM problems").all() as { path: string }[]).map(
      (r) => r.path,
    );
  }

  /** Removes every row that came from one file, including search entries, files and problems. */
  removeFile(path: string): void {
    this.deleteRows(path);
    this.stmt("DELETE FROM files WHERE path = ?").run(path);
    this.stmt("DELETE FROM problems WHERE path = ?").run(path);
  }

  /** Paths of all indexed files and problems below a directory prefix ("items/foo/"). */
  pathsUnder(prefix: string): string[] {
    const like = `${prefix.replace(/[\\%_]/g, "\\$&")}%`;
    const a = this.stmt("SELECT path FROM files WHERE path LIKE ? ESCAPE '\\'").all(like) as {
      path: string;
    }[];
    const b = this.stmt("SELECT DISTINCT path FROM problems WHERE path LIKE ? ESCAPE '\\'").all(
      like,
    ) as { path: string }[];
    return [...new Set([...a, ...b].map((r) => r.path))];
  }

  private deleteRows(path: string): void {
    this.stmt("DELETE FROM fts_words WHERE rowid IN (SELECT id FROM docs WHERE path = ?)").run(
      path,
    );
    this.stmt("DELETE FROM fts_tri WHERE rowid IN (SELECT id FROM docs WHERE path = ?)").run(path);
    for (const t of TABLES) this.stmt(`DELETE FROM ${t} WHERE path = ?`).run(path);
  }

  // Writers: each replaces everything previously indexed from `path` ---------------------------

  /** Returns a reason when another file already owns the unique id/key, else undefined. */
  conflictFor(table: "items" | "cards" | "notes" | "projects", key: string, path: string) {
    const col = table === "items" ? "citekey" : table === "projects" ? "slug" : "id";
    const r = this.stmt(`SELECT path FROM ${table} WHERE ${col} = ? AND path != ?`).get(
      key,
      path,
    ) as { path: string } | undefined;
    return r?.path;
  }

  itemIdConflict(id: string, path: string): string | undefined {
    const r = this.stmt("SELECT path FROM items WHERE id = ? AND path != ?").get(id, path) as
      | { path: string }
      | undefined;
    return r?.path;
  }

  putItem(path: string, citekey: string, fm: ItemFrontmatter, noteBody: string): void {
    this.deleteRows(path);
    const rec = fm as Record<string, unknown>;
    const creators: { role: string; c: Creator }[] = [];
    for (const role of CREATOR_ROLES) {
      const arr = rec[role];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        const c = Creator.safeParse(raw);
        if (c.success) creators.push({ role, c: c.data });
      }
    }
    const authors = creators.filter((x) => x.role === "author").map((x) => x.c);
    this.stmt(
      `INSERT INTO items(citekey, id, path, title, subtitle, type, year, authors, language, status,
        inbox, doi, isbn, url, abstract, source_count, created, modified, frontmatter_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      citekey,
      fm.id,
      path,
      fm.title,
      fm.subtitle ?? null,
      fm.type,
      yearOf(fm.issued),
      authorsLabel(authors),
      fm.language ?? null,
      fm.status,
      fm.inbox ? 1 : 0,
      fm.DOI ?? null,
      fm.ISBN ?? null,
      fm.URL ?? null,
      fm.abstract ?? null,
      fm.sources.length,
      fm.created.at,
      fm.modified?.at ?? null,
      JSON.stringify(fm),
    );
    let pos = 0;
    for (const { role, c } of creators) {
      this.stmt(
        "INSERT INTO creators(path, citekey, role, pos, family, given, literal, orcid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        path,
        citekey,
        role,
        pos++,
        "family" in c ? c.family : null,
        "given" in c ? (c.given ?? null) : null,
        "literal" in c ? c.literal : null,
        "orcid" in c ? (c.orcid ?? null) : null,
      );
    }
    this.putMembership(path, "item", citekey, fm.tags, fm.projects);
    this.putWikiLinks(path, "item", citekey, noteBody);
    const names = creators.map((x) => creatorName(x.c)).join(" ");
    this.addDoc({
      path,
      kind: "item",
      ref: citekey,
      citekey,
      title: fm.title,
      ftsTitle: [fm.title, fm.subtitle].filter(Boolean).join(" "),
      ftsBody: [
        names,
        fm.abstract,
        fm["container-title"],
        fm.publisher,
        fm.tags.join(" "),
        noteBody,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  putCard(path: string, citekey: string, fm: CardFrontmatter, body: CardBody, quoteOk: boolean) {
    this.deleteRows(path);
    this.stmt(
      `INSERT INTO cards(id, path, citekey, source, kind, quote, quote_ok, paraphrase, note,
        created, frontmatter_json, body_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fm.id,
      path,
      citekey,
      fm.source ?? null,
      fm.kind ?? null,
      body.quote,
      quoteOk ? 1 : 0,
      body.paraphrase ?? null,
      body.note ?? null,
      fm.created.at,
      JSON.stringify(fm),
      JSON.stringify(body),
    );
    this.putMembership(path, "card", fm.id, fm.tags, fm.projects);
    this.stmt(
      `INSERT INTO links(path, src_kind, src_ref, dst, rel, status, actor, origin)
       VALUES (?, 'card', ?, ?, 'excerpt-of', 'accepted', 'system', 'auto')`,
    ).run(path, fm.id, citekey);
    // The legacy core statement is shown nowhere, so it is not searched either.
    const free = [body.paraphrase, body.note, ...extraTexts(body)];
    this.putWikiLinks(path, "card", fm.id, free.filter(Boolean).join("\n"));
    this.addDoc({
      path,
      kind: "card",
      ref: fm.id,
      citekey,
      title: body.quote.replace(/\s+/g, " ").slice(0, 80),
      ftsTitle: "",
      ftsBody: [body.quote, ...free, fm.tags.join(" ")].filter(Boolean).join("\n"),
    });
  }

  putNote(path: string, slug: string, fm: NoteFrontmatter, body: string): void {
    this.deleteRows(path);
    this.stmt(
      `INSERT INTO notes(id, path, slug, title, type, created, modified, frontmatter_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fm.id,
      path,
      slug,
      fm.title,
      fm.type,
      fm.created.at,
      fm.modified?.at ?? null,
      JSON.stringify(fm),
    );
    this.putMembership(path, "note", fm.id, fm.tags, fm.projects);
    for (const l of fm.links) {
      // A rejected link is kept in the file only as a memory for `links.propose`.
      if (l.status === "rejected") continue;
      const ev = l.evidence ? wikiTarget(l.evidence) : null;
      this.stmt(
        `INSERT INTO links(path, src_kind, src_ref, dst, rel, status, why, evidence, actor, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'frontmatter')`,
      ).run(
        path,
        // a connection that starts at a card is the card's edge, stored in the literature note
        l.from ? "card" : "note",
        l.from ?? fm.id,
        wikiTarget(l.to),
        l.rel ?? null,
        l.status,
        l.why ?? null,
        ev,
        l.by,
      );
    }
    this.putWikiLinks(path, "note", fm.id, body);
    this.addDoc({
      path,
      kind: "note",
      ref: fm.id,
      citekey: null,
      title: fm.title,
      ftsTitle: fm.title,
      ftsBody: `${fm.tags.join(" ")}\n${(fm.aliases ?? []).join(" ")}\n${body}`,
    });
  }

  putProject(path: string, fm: ProjectFrontmatter): void {
    this.deleteRows(path);
    this.stmt(
      `INSERT INTO projects(slug, path, title, status, style, locale, created, frontmatter_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fm.slug,
      path,
      fm.title,
      fm.status,
      fm.style,
      fm.locale,
      fm.created.at,
      JSON.stringify(fm),
    );
  }

  putBlocks(path: string, citekey: string, source: string, blocks: Block[]): void {
    this.deleteRows(path);
    for (const b of blocks) {
      const page = b.spans[0]?.label ?? (b.spans[0] ? String(b.spans[0].page + 1) : null);
      this.stmt(
        `INSERT OR REPLACE INTO blocks(path, citekey, source, id, type, sec, flow, page, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(path, citekey, source, b.id, b.type, b.sec ?? null, b.flow, page, b.text);
      if (b.flow === "furniture" || b.type === "page-furniture" || b.text.trim() === "") continue;
      this.addDoc({
        path,
        kind: "block",
        ref: `${source}:${b.id}`,
        citekey,
        title: b.sec ?? "",
        ftsTitle: "",
        ftsBody: b.text,
      });
    }
  }

  private putMembership(
    path: string,
    kind: string,
    ref: string,
    tags: string[],
    projects: string[],
  ): void {
    for (const t of new Set(tags)) {
      this.stmt("INSERT INTO tags(path, kind, ref, tag) VALUES (?, ?, ?, ?)").run(
        path,
        kind,
        ref,
        t,
      );
    }
    for (const p of new Set(projects)) {
      this.stmt("INSERT INTO project_members(path, kind, ref, project) VALUES (?, ?, ?, ?)").run(
        path,
        kind,
        ref,
        p,
      );
    }
  }

  private putWikiLinks(path: string, kind: string, ref: string, markdown: string): void {
    const seen = new Set<string>();
    for (const l of extractWikiLinks(markdown)) {
      const key = `${l.target}#${l.anchor ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.stmt(
        `INSERT INTO links(path, src_kind, src_ref, dst, anchor, status, origin)
         VALUES (?, ?, ?, ?, ?, 'accepted', 'wiki')`,
      ).run(path, kind, ref, l.target, l.anchor ?? null);
    }
  }

  private addDoc(d: {
    path: string;
    kind: string;
    ref: string;
    citekey: string | null;
    title: string;
    ftsTitle: string;
    ftsBody: string;
  }): void {
    const info = this.stmt(
      "INSERT INTO docs(path, kind, ref, citekey, title) VALUES (?, ?, ?, ?, ?)",
    ).run(d.path, d.kind, d.ref, d.citekey, d.title);
    const rowid = info.lastInsertRowid;
    this.stmt("INSERT INTO fts_words(rowid, title, body) VALUES (?, ?, ?)").run(
      rowid,
      stemmedText(d.ftsTitle),
      stemmedText(d.ftsBody),
    );
    this.stmt("INSERT INTO fts_tri(rowid, title, body) VALUES (?, ?, ?)").run(
      rowid,
      d.ftsTitle,
      d.ftsBody,
    );
  }

  // Readers --------------------------------------------------------------------------------------

  count(table: "items" | "cards" | "notes" | "projects" | "blocks"): number {
    return (this.stmt(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }
}

function toFileRecord(r: Row): FileRecord {
  return {
    path: r.path as string,
    kind: r.kind as FileKind,
    hash: r.hash as string,
    size: r.size as number,
    mtimeMs: r.mtime_ms as number,
  };
}

function extraTexts(body: CardBody): string[] {
  return body.extra.map((e) => e.text);
}

export function yearOf(issued: ItemFrontmatter["issued"]): string | null {
  if (issued === undefined) return null;
  const m = /^-?\d{1,4}/.exec(String(issued));
  return m ? m[0] : null;
}

function creatorName(c: Creator): string {
  return "literal" in c ? c.literal : [c.given, c.family].filter(Boolean).join(" ");
}

export function authorsLabel(authors: Creator[]): string | null {
  const names = authors.map((a) => ("literal" in a ? a.literal : a.family));
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

/**
 * SQL conditions that restrict rows to a scope. The expressions say where the row's owner lives:
 * `kind`/`ref` of the owner for tags and project membership, `citekey` of the parent item.
 */
export function scopeClauses(
  scope: Scope,
  e: { ownerKind: string; ownerRef: string; citekey: string },
): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (scope.project) {
    sql.push(
      `(EXISTS (SELECT 1 FROM project_members pm WHERE pm.kind = ${e.ownerKind} AND pm.ref = ${e.ownerRef} AND pm.project = ?)
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.kind = 'item' AND pm.ref = ${e.citekey} AND pm.project = ?))`,
    );
    params.push(scope.project, scope.project);
  }
  if (scope.tags && scope.tags.length > 0) {
    const uniq = [...new Set(scope.tags)];
    sql.push(
      `(SELECT COUNT(DISTINCT t.tag) FROM tags t WHERE t.kind = ${e.ownerKind} AND t.ref = ${e.ownerRef} AND t.tag IN (${uniq.map(() => "?").join(",")})) = ${uniq.length}`,
    );
    params.push(...uniq);
  }
  if (scope.status) {
    sql.push(`EXISTS (SELECT 1 FROM items si WHERE si.citekey = ${e.citekey} AND si.status = ?)`);
    params.push(scope.status);
  }
  return { sql, params };
}

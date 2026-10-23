import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  type Actor,
  type CardBody,
  type CardFrontmatter,
  CitegeistError,
  type ItemFrontmatter,
  LIBRARY_FORMAT_VERSION,
  LibraryManifest,
  NoteFrontmatter,
  ProjectFrontmatter,
} from "@citegeist/schema";
import watcher from "@parcel/watcher";
import { serializeCardBody } from "./card-body.js";
import { classify } from "./classify.js";
import { MarkdownFile } from "./frontmatter.js";
import { TEMP_FILE, writeFileAtomic } from "./fsutil.js";
import { newNoteId, slugify } from "./ids.js";
import { Index, type Scope, scopeClauses } from "./index-db.js";
import { Indexer, type IndexResult, type SyncSummary } from "./indexer.js";
import { type Issue, type Parsed, parseLibraryFile } from "./parse.js";
import { defaultLocalBase, LibraryPaths, LocalPaths } from "./paths.js";
import { type SearchHit, type SearchInput, search } from "./search.js";

export interface OpenOptions {
  /** Base directory for machine-local data. Default: ~/Library/Application Support/citegeist */
  localBase?: string;
  /** Watch the folder for external changes. Default true. */
  watch?: boolean;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

export interface InitOptions extends OpenOptions {
  name?: string;
  id?: string;
}

export interface ChangeEvent extends IndexResult {
  /** True when the change came from outside the core (watcher), false for the core's own writes. */
  external: boolean;
}

export interface ProblemEntry extends Issue {
  /** Absolute path of the affected file. */
  path: string;
}

export interface LibraryStatus {
  path: string;
  items: number;
  cards: number;
  notes: number;
  problems: ProblemEntry[];
}

const DEBOUNCE_MS = 25;

const AGENTS_MD = `# Agent rules for this library

This folder is a citegeist library. Every file is plain Markdown, JSON or YAML.

- Read and edit notes in \`notes/\`, literature notes in \`items/<citekey>/<citekey>.md\` and project briefs in \`projects/<slug>/project.md\`.
- Keep the YAML frontmatter valid. Files that fail validation show up in the problem list and are not used.
- Never edit the quote of a card (the blockquote in \`items/<citekey>/cards/*.md\`). Its hash is stored in the frontmatter.
- Never edit anything under \`derived/\` or \`sources/\`. The core writes and restores these files.
- Link with \`[[citekey]]\`, \`[[card-id]]\` or \`[[note-file-name]]\`.
- Prefer the \`cg\` command or the MCP tools for changes that touch several files.
`;

const CLAUDE_MD = "See AGENTS.md for the rules of this library.\n";

function problem(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
) {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

/** An open citegeist library: folder, index and watcher. */
export class Library extends EventEmitter {
  readonly paths: LibraryPaths;
  readonly local: LocalPaths;
  readonly index: Index;
  readonly indexer: Indexer;
  manifest: LibraryManifest;
  private readonly now: () => Date;
  private subscription: { unsubscribe(): Promise<void> } | undefined;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  private constructor(root: string, manifest: LibraryManifest, opts: OpenOptions) {
    super();
    this.paths = new LibraryPaths(root);
    this.manifest = manifest;
    this.now = opts.now ?? (() => new Date());
    this.local = new LocalPaths(opts.localBase ?? defaultLocalBase(), manifest.id);
    mkdirSync(this.local.dir, { recursive: true });
    this.index = new Index(this.local.indexDb);
    this.indexer = new Indexer(root, this.index, (rel, parsed) => this.onParsed(rel, parsed));
  }

  get root(): string {
    return this.paths.root;
  }

  /** Creates a new library folder with manifest and AGENTS.md. Fails if one exists already. */
  static async init(root: string, opts: InitOptions = {}): Promise<Library> {
    mkdirSync(root, { recursive: true });
    const real = realpathSync(root);
    const paths = new LibraryPaths(real);
    if (existsSync(paths.manifest)) {
      throw problem(
        "LIBRARY_EXISTS",
        `${paths.manifest} already exists`,
        "Open the library instead of initializing it again.",
        { path: real },
      );
    }
    const manifest = LibraryManifest.parse({
      format: LIBRARY_FORMAT_VERSION,
      id: opts.id ?? randomUUID(),
      name: opts.name ?? basename(real),
    });
    for (const d of [paths.itemsDir, paths.notesDir, paths.projectsDir, paths.chatsDir]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileAtomic(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    if (!existsSync(paths.agentsMd)) writeFileAtomic(paths.agentsMd, AGENTS_MD);
    if (!existsSync(paths.claudeMd)) writeFileAtomic(paths.claudeMd, CLAUDE_MD);
    return Library.open(real, opts);
  }

  /** Opens an existing library, catches the index up with the folder and starts the watcher. */
  static async open(root: string, opts: OpenOptions = {}): Promise<Library> {
    let real: string;
    try {
      real = realpathSync(root);
    } catch {
      throw problem(
        "LIBRARY_NOT_FOUND",
        `library folder ${root} does not exist`,
        "Pass the path of an existing library folder or initialize a new one.",
        { path: root },
      );
    }
    const manifestPath = new LibraryPaths(real).manifest;
    if (!existsSync(manifestPath)) {
      throw problem(
        "LIBRARY_NOT_FOUND",
        `no citegeist.json in ${real}`,
        "Initialize the folder as a library first.",
        { path: real },
      );
    }
    const parsed = parseLibraryFile(
      { kind: "manifest", key: "manifest" },
      readFileSync(manifestPath, "utf8"),
    );
    if (!parsed.ok || parsed.parsed.kind !== "manifest") {
      throw problem(
        "MANIFEST_INVALID",
        `citegeist.json is invalid: ${parsed.ok ? "" : parsed.issues.map((i) => i.message).join("; ")}`,
        "Fix citegeist.json so that it matches the LibraryManifest schema (format 1).",
        { path: manifestPath },
      );
    }
    const lib = new Library(real, parsed.parsed.manifest, opts);
    lib.prepareIndex();
    if (opts.watch !== false) await lib.startWatching();
    lib.sync();
    return lib;
  }

  static async openOrInit(root: string, opts: InitOptions = {}): Promise<Library> {
    return existsSync(join(root, "citegeist.json"))
      ? Library.open(root, opts)
      : Library.init(root, opts);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.subscription?.unsubscribe();
    this.index.close();
  }

  // Index maintenance --------------------------------------------------------------------------

  private prepareIndex(): void {
    if (this.index.meta("library_id") !== this.manifest.id) {
      this.index.reset();
      this.index.setMeta("library_id", this.manifest.id);
    }
  }

  /** Catches the index up with the folder. */
  sync(): SyncSummary {
    return this.indexer.sync();
  }

  /** Full rebuild: reads only the library folder. */
  rebuild(): SyncSummary {
    const summary = this.indexer.rebuild();
    this.index.setMeta("library_id", this.manifest.id);
    return summary;
  }

  private onParsed(_rel: string, parsed: Parsed): void {
    if (parsed.kind === "manifest") this.manifest = parsed.manifest;
  }

  // Watcher ------------------------------------------------------------------------------------

  private async startWatching(): Promise<void> {
    this.subscription = await watcher.subscribe(
      this.root,
      (err, events) => {
        if (err) {
          this.emit("error", err);
          return;
        }
        for (const e of events) this.queue(e.path);
      },
      { ignore: [join(this.root, ".git"), join(this.root, ".obsidian")] },
    );
  }

  private queue(abs: string): void {
    const rel = this.paths.rel(abs);
    if (rel === "" || rel.startsWith("..")) return;
    const name = basename(abs);
    if (TEMP_FILE.test(name) || name === ".DS_Store") return;
    this.pending.add(rel);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private flush(): void {
    this.timer = undefined;
    if (this.closed) return;
    const rels = [...this.pending];
    this.pending.clear();
    for (const rel of rels) {
      try {
        for (const r of this.processExternal(rel)) {
          if (r.status === "unchanged" || r.status === "ignored") continue;
          this.emit("change", { ...r, external: true } satisfies ChangeEvent);
        }
      } catch (err) {
        this.emit("error", err);
      }
    }
  }

  private processExternal(rel: string): IndexResult[] {
    const abs = this.paths.abs(rel);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(abs);
    } catch {
      st = undefined;
    }
    if (!st) {
      return [...this.indexer.removeUnder(rel), this.indexer.removePath(rel)];
    }
    if (st.isDirectory()) {
      const out: IndexResult[] = [];
      const walk = (dir: string): void => {
        for (const e of readdirSync(this.paths.abs(dir), { withFileTypes: true })) {
          const child = `${dir}/${e.name}`;
          if (e.isDirectory()) walk(child);
          else out.push(this.indexer.indexFile(child));
        }
      };
      walk(rel);
      return out;
    }
    return [this.indexer.indexFile(rel)];
  }

  /** Resolves once the debounce queue is empty (all seen external changes are indexed). */
  async settled(): Promise<void> {
    while (this.timer) await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  }

  // Writing ------------------------------------------------------------------------------------

  /** Atomic write, then immediate indexing. `rel` uses forward slashes. */
  writeFile(rel: string, content: string): IndexResult {
    writeFileAtomic(this.paths.abs(rel), content);
    const result = this.indexer.indexFile(rel);
    this.emit("change", { ...result, external: false } satisfies ChangeEvent);
    return result;
  }

  /** Writes a whole item file (validated by the index on the way in). */
  writeItem(fm: ItemFrontmatter, body = ""): IndexResult {
    return this.writeFile(
      `items/${fm.citekey}/${fm.citekey}.md`,
      MarkdownFile.create(fm as Record<string, unknown>, body).toString(),
    );
  }

  writeCard(fm: CardFrontmatter, body: CardBody): IndexResult {
    return this.writeFile(
      `items/${fm.item}/cards/${fm.id}.md`,
      MarkdownFile.create(fm as Record<string, unknown>, serializeCardBody(body)).toString(),
    );
  }

  stamp(actor: Actor): { at: string; by: Actor } {
    return { at: this.now().toISOString(), by: actor };
  }

  // Reading ------------------------------------------------------------------------------------

  status(): LibraryStatus {
    return {
      path: this.root,
      items: this.index.count("items"),
      cards: this.index.count("cards"),
      notes: this.index.count("notes"),
      problems: this.index.problems().map((p) => ({
        path: this.paths.abs(p.path),
        code: p.code,
        message: p.message,
      })),
    };
  }

  /** Reads and validates one indexed file from disk (the folder is the source of truth). */
  readParsed(rel: string): Parsed {
    const c = classify(rel);
    if (!c || c.kind === "conflict" || c.kind === "placeholder") {
      throw problem("INTERNAL", `${rel} is not a library file`, "Report this as a bug.");
    }
    const r = parseLibraryFile(c, readFileSync(this.paths.abs(rel), "utf8"));
    if (!r.ok) {
      throw problem(
        "FILE_INVALID",
        `${rel} is invalid: ${r.issues.map((i) => `${i.code} ${i.message}`).join("; ")}`,
        `Open ${rel}, fix the frontmatter and save the file.`,
        { path: rel },
      );
    }
    return r.parsed;
  }

  getItem(citekey: string) {
    const row = this.index.get<{ path: string }>(
      "SELECT path FROM items WHERE citekey = ?",
      citekey,
    );
    if (!row) {
      throw new CitegeistError({
        code: "ITEM_NOT_FOUND",
        message: `no item with citekey '${citekey}'`,
        fix: "Call items.list or search.query to find the right citekey.",
        recovery: "fix-and-retry",
        context: { citekey },
      });
    }
    const p = this.readParsed(row.path);
    if (p.kind !== "item")
      throw problem("INTERNAL", `${row.path} is not an item`, "Rebuild the index.");
    const cards =
      this.index.get<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE citekey = ?", citekey)
        ?.n ?? 0;
    return { frontmatter: p.fm, note: p.body, cards, path: this.paths.abs(row.path) };
  }

  listItems(input: Scope & { limit: number; cursor?: string | undefined }) {
    const sc = scopeClauses(input, {
      ownerKind: "'item'",
      ownerRef: "i.citekey",
      citekey: "i.citekey",
    });
    const where = [...sc.sql];
    const params = [...sc.params];
    if (input.inbox !== undefined) {
      where.push("i.inbox = ?");
      params.push(input.inbox ? 1 : 0);
    }
    if (input.cursor) {
      where.push("i.citekey > ?");
      params.push(input.cursor);
    }
    const rows = this.index.all<{
      citekey: string;
      title: string;
      year: string | null;
      authors: string | null;
      type: string;
      status: string;
      inbox: number;
    }>(
      `SELECT i.citekey, i.title, i.year, i.authors, i.type, i.status, i.inbox FROM items i
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.citekey LIMIT ?`,
      ...params,
      input.limit + 1,
    );
    const page = rows.slice(0, input.limit);
    const items = page.map((r) => ({
      citekey: r.citekey,
      title: r.title,
      ...(r.year ? { year: r.year } : {}),
      ...(r.authors ? { authors: r.authors } : {}),
      type: r.type,
      status: r.status,
      inbox: r.inbox === 1,
    }));
    const next = rows.length > input.limit ? page[page.length - 1]?.citekey : undefined;
    return { items, ...(next ? { next } : {}) };
  }

  listCards(
    input: Scope & {
      citekey?: string | undefined;
      query?: string | undefined;
      kind?: string | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ) {
    const parse = (r: { frontmatter_json: string; body_json: string }) => ({
      frontmatter: JSON.parse(r.frontmatter_json) as CardFrontmatter,
      body: JSON.parse(r.body_json) as CardBody,
    });
    const sc = scopeClauses(input, {
      ownerKind: "'card'",
      ownerRef: "c.id",
      citekey: "c.citekey",
    });
    const where = [...sc.sql];
    const params = [...sc.params];
    if (input.citekey) {
      where.push("c.citekey = ?");
      params.push(input.citekey);
    }
    if (input.kind) {
      where.push("c.kind = ?");
      params.push(input.kind);
    }
    if (input.query) {
      const hits = search(this.index, {
        q: input.query,
        kinds: ["card"],
        limit: 100,
        project: input.project,
        tags: input.tags,
        status: input.status,
      });
      const ids = hits.map((h) => h.id);
      if (ids.length === 0) return { cards: [] };
      where.push(`c.id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
      const rows = this.index.all<{ id: string; frontmatter_json: string; body_json: string }>(
        `SELECT c.id, c.frontmatter_json, c.body_json FROM cards c WHERE ${where.join(" AND ")}`,
        ...params,
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.flatMap((id) => {
        const r = byId.get(id);
        return r ? [parse(r)] : [];
      });
      return { cards: ordered.slice(0, input.limit) };
    }
    if (input.cursor) {
      where.push("c.id > ?");
      params.push(input.cursor);
    }
    const rows = this.index.all<{ id: string; frontmatter_json: string; body_json: string }>(
      `SELECT c.id, c.frontmatter_json, c.body_json FROM cards c
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.id LIMIT ?`,
      ...params,
      input.limit + 1,
    );
    const page = rows.slice(0, input.limit);
    const next = rows.length > input.limit ? page[page.length - 1]?.id : undefined;
    return { cards: page.map(parse), ...(next ? { next } : {}) };
  }

  search(input: SearchInput): SearchHit[] {
    return search(this.index, input);
  }

  // Notes --------------------------------------------------------------------------------------

  getNote(id: string) {
    const row = this.index.get<{ path: string }>("SELECT path FROM notes WHERE id = ?", id);
    if (!row) {
      throw new CitegeistError({
        code: "NOTE_NOT_FOUND",
        message: `no note with id '${id}'`,
        fix: 'Use search.query with kinds ["note"] to find the note id.',
        recovery: "fix-and-retry",
        context: { id },
      });
    }
    const p = this.readParsed(row.path);
    if (p.kind !== "note")
      throw problem("INTERNAL", `${row.path} is not a note`, "Rebuild the index.");
    return { frontmatter: p.fm, body: p.body, path: this.paths.abs(row.path) };
  }

  createNote(
    actor: Actor,
    input: { title: string; body: string; type: NoteFrontmatter["type"]; projects: string[] },
  ) {
    const id = newNoteId(this.now().getTime());
    const base = slugify(input.title);
    let slug = base;
    for (let n = 2; existsSync(this.paths.noteFile(slug)); n++) slug = `${base}-${n}`;
    const fm = NoteFrontmatter.parse({
      id,
      type: input.type,
      title: input.title,
      projects: input.projects,
      created: this.stamp(actor),
    });
    this.writeFile(
      `notes/${slug}.md`,
      MarkdownFile.create(fm as Record<string, unknown>, input.body).toString(),
    );
    return this.getNote(id);
  }

  updateNote(
    actor: Actor,
    input: { id: string; title?: string | undefined; body?: string | undefined },
  ) {
    const row = this.getNote(input.id);
    const rel = this.paths.rel(row.path);
    const file = MarkdownFile.parse(readFileSync(row.path, "utf8"));
    if (input.title !== undefined && input.title !== row.frontmatter.title) {
      file.patch({ title: input.title });
    }
    if (input.title !== undefined || input.body !== undefined) {
      file.patch({ modified: this.stamp(actor) });
    }
    if (input.body !== undefined) file.setBody(input.body);
    this.writeFile(rel, file.toString());
    return this.getNote(input.id);
  }

  // Projects -----------------------------------------------------------------------------------

  private projectRel(slug: string): string {
    return `projects/${slug}/project.md`;
  }

  getProject(slug: string) {
    if (!this.index.get("SELECT 1 FROM projects WHERE slug = ?", slug)) {
      throw new CitegeistError({
        code: "PROJECT_NOT_FOUND",
        message: `no project with slug '${slug}'`,
        fix: "Call projects.list to see the existing projects, or projects.create to make one.",
        recovery: "fix-and-retry",
        context: { slug },
      });
    }
    const p = this.readParsed(this.projectRel(slug));
    if (p.kind !== "project") throw problem("INTERNAL", "not a project", "Rebuild the index.");
    const items =
      this.index.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM project_members WHERE kind = 'item' AND project = ?",
        slug,
      )?.n ?? 0;
    return { frontmatter: p.fm, brief: p.body, items };
  }

  listProjects(): { projects: ProjectFrontmatter[] } {
    const rows = this.index.all<{ frontmatter_json: string }>(
      "SELECT frontmatter_json FROM projects ORDER BY slug",
    );
    return { projects: rows.map((r) => JSON.parse(r.frontmatter_json) as ProjectFrontmatter) };
  }

  createProject(actor: Actor, input: { slug: string; title: string; brief: string }) {
    const rel = this.projectRel(input.slug);
    if (
      existsSync(this.paths.abs(rel)) ||
      this.index.get("SELECT 1 FROM projects WHERE slug = ?", input.slug)
    ) {
      throw new CitegeistError({
        code: "PROJECT_EXISTS",
        message: `project '${input.slug}' already exists`,
        fix: "Choose another slug or change the existing project with projects.update.",
        recovery: "fix-and-retry",
        context: { slug: input.slug },
      });
    }
    const fm = ProjectFrontmatter.parse({
      slug: input.slug,
      title: input.title,
      style: this.manifest.defaults.style,
      locale: this.manifest.defaults.locale,
      created: this.stamp(actor),
    });
    this.writeFile(rel, MarkdownFile.create(fm as Record<string, unknown>, input.brief).toString());
    return { frontmatter: fm, brief: input.brief.replace(/^\s+|\s+$/g, "") };
  }

  /** `patch` replaces top-level frontmatter keys; a value of null removes the key. */
  updateProject(input: {
    slug: string;
    patch: Record<string, unknown>;
    brief?: string | undefined;
  }) {
    this.getProject(input.slug);
    const rel = this.projectRel(input.slug);
    for (const k of ["slug", "created"]) {
      if (k in input.patch) {
        throw problem(
          "INVALID_PATCH",
          `field '${k}' of a project cannot be changed`,
          `Remove '${k}' from the patch.`,
          { slug: input.slug },
        );
      }
    }
    const file = MarkdownFile.parse(readFileSync(this.paths.abs(rel), "utf8"));
    const patch: Record<string, unknown> = {};
    const merged: Record<string, unknown> = { ...(file.data ?? {}) };
    for (const [k, v] of Object.entries(input.patch)) {
      patch[k] = v === null ? undefined : v;
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const check = ProjectFrontmatter.safeParse(merged);
    if (!check.success) {
      throw problem(
        "INVALID_PATCH",
        `patch makes the project invalid: ${check.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        "Fix the patch values so that they match the project schema.",
        { slug: input.slug },
      );
    }
    file.patch(patch);
    if (input.brief !== undefined) file.setBody(input.brief);
    this.writeFile(rel, file.toString());
    return this.getProject(input.slug);
  }
}

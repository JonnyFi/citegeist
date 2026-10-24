import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { AiRouter } from "@citegeist/ai";
import { generateCitekey, parseBibtex, resolveImportedCitekey } from "@citegeist/cite";
import {
  detectIdentifier,
  extractIdentifiers,
  type FetchLike,
  type Identifier,
  pickPrimary,
  type ResolveOptions,
  type ResolveResult,
  type TitleQuery,
  type TitleResolveResult,
} from "@citegeist/metadata";
import {
  type Actor,
  CitegeistError,
  ItemFrontmatter,
  type Job,
  Pages,
  type Source,
} from "@citegeist/schema";
import { writeFileAtomic } from "../fsutil.js";
import { sha256Hex } from "../hash.js";
import { newItemId } from "../ids.js";
import { type JobContext, JobQueue, TransientError } from "../jobs/queue.js";
import type { Library } from "../library.js";
import { readDocument } from "./documents.js";
import { findDuplicate } from "./dupes.js";
import { enrichAfterConvert, splitName } from "./enrich.js";
import {
  acceptInbox,
  assertMayTrash,
  loadItem,
  problem,
  rejectInbox,
  renameItem,
  saveItem,
  trashItem,
  updateItem,
} from "./items.js";
import { extractPdfText, guessHeader, type PdfTextExtractor } from "./pdf-text.js";
import type { ConvertParams, ConvertWorker } from "./worker.js";

/** The part of MetadataResolver the pipeline uses. Tests pass a resolver with replayed responses. */
export interface MetadataLookup {
  resolve(input: string | Identifier, options?: ResolveOptions): Promise<ResolveResult>;
  resolveByTitle(query: TitleQuery, options?: ResolveOptions): Promise<TitleResolveResult>;
}

export interface IngestDeps {
  resolver: MetadataLookup;
  worker: ConvertWorker;
  /** For open-access PDFs, arXiv HTML and web pages. Default: the global fetch. */
  fetch?: FetchLike;
  /** Reads the first pages of a PDF. Default: pdfjs-dist. */
  pdfText?: PdfTextExtractor;
  /**
   * AI tasks, for reading title, author and year from a first page after a conversion. Without
   * it, the header heuristic does that.
   */
  ai?: Pick<AiRouter, "run">;
  /** Use an existing queue instead of one in the library's state.sqlite. */
  queue?: JobQueue;
  backoffMs?: (attempt: number) => number;
  /**
   * Makes sure a library file is on disk before it is read: iCloud keeps big files as
   * placeholders. `rel` is relative to the library root. Default: every file is local.
   */
  ensureLocal?: (rel: string) => Promise<boolean>;
  /** Start running jobs immediately. Default true. */
  autoStart?: boolean;
}

export interface AddInput {
  identifier: string;
  projects: string[];
  tags: string[];
  target: "inbox" | "library";
  why?: string | undefined;
}

export interface AddResult {
  citekey: string;
  job: string;
  duplicateOf?: string;
  /** The matched item had no working source; the new file or download was attached to it. */
  repaired?: boolean;
}

interface RemotePlan {
  /** arXiv id: HTML and PDF come from arxiv.org. */
  arxiv?: string;
  /** Open-access PDF url from the metadata sources. */
  pdfUrl?: string;
}

interface LocalFile {
  buf: Buffer;
  kind: Source["kind"];
  ext: string;
  filename: string;
  url?: string;
}

interface Prepared {
  fields: Record<string, unknown>;
  provenance: Record<string, string>;
  ids: Record<string, string>;
  remote: RemotePlan;
  file?: LocalFile;
  proposal?: Record<string, unknown>;
  /** Citekey from an imported BibTeX entry, used when free. */
  importedKey?: string;
}

const CONVERT_KINDS: Record<Source["kind"], ConvertParams["kind"]> = {
  pdf: "pdf",
  "arxiv-html": "arxiv-html",
  html: "web",
  web: "web",
  epub: "epub",
};

const FILE_KINDS: Record<string, { kind: Source["kind"]; ext: string }> = {
  ".pdf": { kind: "pdf", ext: "pdf" },
  ".html": { kind: "web", ext: "html" },
  ".htm": { kind: "web", ext: "html" },
  ".epub": { kind: "epub", ext: "epub" },
};

const MAX_DOWNLOAD = 300 * 1024 * 1024;

/** Servers that turn away unknown clients answer a browser. Redirects are followed by fetch. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ACCEPT_ANY = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8";

/** Ingest pipeline, item operations and the job queue behind them. */
export class IngestService {
  readonly queue: JobQueue;
  private readonly fetchFn: FetchLike;
  private readonly pdfText: PdfTextExtractor;

  constructor(
    readonly lib: Library,
    readonly deps: IngestDeps,
  ) {
    this.queue =
      deps.queue ??
      new JobQueue({
        dbPath: lib.local.stateDb,
        ...(deps.backoffMs ? { backoffMs: deps.backoffMs } : {}),
      });
    this.fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
    this.pdfText = deps.pdfText ?? extractPdfText;
    this.queue.register("ingest", (ctx) => this.runIngest(ctx), { concurrency: 3 });
    this.queue.register("convert", (ctx) => this.runConvert(ctx), { concurrency: 1 });
    this.queue.on("job", (job: Job) => this.onJob(job));
    if (deps.autoStart !== false) this.queue.start();
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.deps.worker.close();
  }

  // items.add --------------------------------------------------------------------------------

  async addItem(actor: Actor, input: AddInput): Promise<AddResult> {
    const raw = input.identifier.trim();
    const early = this.earlyDuplicate(raw);
    // An item whose source failed is not a finished duplicate: the new input may repair it.
    if (early && !this.mayRepair(early)) return this.duplicate(actor, early);

    const prepared = await this.prepare(actor, raw);
    const lookupHash = prepared.file ? sha256Hex(prepared.file.buf).slice(0, 12) : undefined;
    const first = (
      prepared.fields.author as { family?: string; literal?: string }[] | undefined
    )?.[0];
    const dup =
      early ??
      findDuplicate(this.lib, {
        doi: prepared.fields.DOI as string | undefined,
        arxiv: prepared.ids.arxiv,
        pmid: prepared.ids.pmid,
        isbn: detectIdentifier(raw)?.kind === "isbn" ? detectIdentifier(raw)?.value : undefined,
        url: prepared.file?.url,
        hash: lookupHash,
        title: prepared.proposal ? undefined : (prepared.fields.title as string | undefined),
        year: prepared.fields.issued as string | number | undefined,
        firstAuthor: first?.family ?? first?.literal,
      });
    if (dup) return this.repairDuplicate(actor, dup, prepared) ?? this.duplicate(actor, dup);

    const jobId = this.queue.newId();
    const citekey = this.createItem(actor, input, prepared, jobId);
    const hasSources =
      prepared.file !== undefined || prepared.remote.arxiv || prepared.remote.pdfUrl;
    this.queue.enqueue({
      id: jobId,
      kind: "ingest",
      by: actor,
      input: { citekey, remote: prepared.remote, convert: !!hasSources },
    });
    return { citekey, job: jobId };
  }

  /** True when a source exists that was converted: the item can be read. */
  hasWorkingSource(citekey: string): boolean {
    const item = loadItem(this.lib, citekey);
    return item.fm.sources.some((s) => existsSync(this.lib.paths.derivedManifest(citekey, s.hash)));
  }

  /** True while an ingest or conversion of the item is queued or running. */
  private conversionPending(citekey: string): boolean {
    return this.queue
      .open()
      .some(
        (j) =>
          (j.kind === "convert" || j.kind === "ingest") &&
          (j.input as { citekey?: unknown } | null)?.citekey === citekey,
      );
  }

  /** No source works and nothing is converting: the item is broken, not just still working. */
  private needsRepair(citekey: string): boolean {
    return !this.hasWorkingSource(citekey) && !this.conversionPending(citekey);
  }

  /** An early duplicate is only final when it works, or never had a source to fail. */
  private mayRepair(citekey: string): boolean {
    if (!this.needsRepair(citekey)) return false;
    const fm = loadItem(this.lib, citekey).fm;
    return fm.sources.length > 0 || fm.incomplete !== undefined;
  }

  /**
   * The matched item has no working source (its download or conversion failed, or it never had a
   * file): attach what the new input brings and convert, instead of dropping it as a duplicate.
   */
  private repairDuplicate(actor: Actor, citekey: string, p: Prepared): AddResult | undefined {
    if (!this.needsRepair(citekey)) return undefined;
    let jobId: string;
    if (p.file) {
      this.dropBrokenSources(citekey);
      const hash = sha256Hex(p.file.buf).slice(0, 12);
      this.addSource(actor, citekey, p.file);
      jobId = this.queue.enqueue({
        kind: "convert",
        by: actor,
        input: { citekey, source: hash, force: true },
      }).id;
    } else if (p.remote.arxiv || p.remote.pdfUrl) {
      this.dropBrokenSources(citekey);
      jobId = this.queue.enqueue({
        kind: "ingest",
        by: actor,
        input: { citekey, remote: p.remote, convert: true },
      }).id;
    } else {
      return undefined;
    }
    if (actor === "human") {
      const item = loadItem(this.lib, citekey);
      if (item.fm.inbox) saveItem(this.lib, actor, item, { inbox: undefined });
    }
    return { citekey, job: jobId, duplicateOf: citekey, repaired: true };
  }

  /**
   * Moves sources that never converted out of the item (into the library trash) so that a new
   * file replaces them. Only called for an item without any working source.
   */
  private dropBrokenSources(citekey: string): void {
    const item = loadItem(this.lib, citekey);
    const broken = item.fm.sources.filter(
      (s) => !existsSync(this.lib.paths.derivedManifest(citekey, s.hash)),
    );
    if (broken.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(this.lib.root, ".trash", `${citekey}-sources-${stamp}`);
    mkdirSync(dest, { recursive: true });
    for (const s of broken) {
      const ext = s.kind === "pdf" ? "pdf" : s.kind === "epub" ? "epub" : "html";
      const file = this.lib.paths.sourceFile(citekey, s.hash, ext);
      if (existsSync(file)) renameSync(file, join(dest, basename(file)));
    }
    const keep = item.fm.sources.filter((s) => !broken.includes(s));
    saveItem(this.lib, "system", item, { sources: keep });
  }

  private duplicate(actor: Actor, citekey: string): AddResult {
    // A human who adds something that waits in the inbox accepts it.
    if (actor === "human") {
      const item = loadItem(this.lib, citekey);
      if (item.fm.inbox) saveItem(this.lib, actor, item, { inbox: undefined });
    }
    const job = this.queue.enqueueFinished({
      kind: "ingest",
      by: actor,
      input: { duplicateOf: citekey },
      result: { duplicateOf: citekey },
      message: `already in the library as ${citekey}`,
    });
    return { citekey, job: job.id, duplicateOf: citekey };
  }

  /** Duplicate check on what the input string already says, before any network call. */
  private earlyDuplicate(raw: string): string | undefined {
    const id = detectIdentifier(raw);
    if (!id) return undefined;
    if (id.kind === "doi") return findDuplicate(this.lib, { doi: id.value });
    if (id.kind === "arxiv") return findDuplicate(this.lib, { arxiv: id.value });
    if (id.kind === "isbn") return findDuplicate(this.lib, { isbn: id.value });
    if (id.kind === "url") return findDuplicate(this.lib, { url: id.value });
    return undefined;
  }

  private async prepare(actor: Actor, raw: string): Promise<Prepared> {
    const path = this.asLocalPath(raw);
    if (path) return this.prepareFile(actor, path);
    if (/^\s*@[A-Za-z]+\s*\{/.test(raw)) return this.prepareBibtex(raw);
    const id = detectIdentifier(raw);
    if (!id) {
      throw problem(
        "INVALID_IDENTIFIER",
        `'${raw.slice(0, 80)}' is not a DOI, arXiv id, ISBN, PMID, URL, BibTeX entry or an existing file path`,
        "Pass a DOI like 10.1038/s41586-020-2649-2, an arXiv id like 1706.03762, an ISBN, a URL, a BibTeX entry or the path of a PDF.",
        { input: raw.slice(0, 80) },
      );
    }
    if (id.kind === "url") return this.prepareUrl(actor, id.value);
    const res = await this.deps.resolver.resolve(id);
    return this.fromResolved(res, id);
  }

  /** The path of an existing file the input names, or undefined when it is not a path. */
  private asLocalPath(raw: string): string | undefined {
    if (raw.includes("\n")) return undefined;
    let explicit = true;
    let p = raw;
    if (p.startsWith("file://")) p = fileURLToPath(p);
    else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
    else if (isAbsolute(p) || p.startsWith("./") || p.startsWith("../")) p = resolvePath(p);
    else {
      explicit = false;
      p = resolvePath(p);
    }
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // handled below
    }
    if (!explicit) return undefined;
    throw problem(
      "FILE_NOT_FOUND",
      `file '${p}' does not exist`,
      "Check the path and pass an existing PDF, HTML or EPUB file.",
      { path: p },
    );
  }

  private fromResolved(res: ResolveResult, id?: Identifier): Prepared {
    if (res.status === "unsupported") {
      throw problem(
        "IDENTIFIER_UNSUPPORTED",
        `${id?.kind ?? "this"} identifiers cannot be resolved yet`,
        "Pass a DOI, arXiv id or ISBN, or add the file or URL instead.",
        { kind: id?.kind ?? null },
      );
    }
    if (res.status !== "resolved" || !res.fields.title) {
      const sourceErrors = res.errors.length > 0;
      throw problem(
        sourceErrors ? "METADATA_UNAVAILABLE" : "METADATA_NOT_FOUND",
        sourceErrors
          ? `no metadata source answered for ${id?.raw ?? "the identifier"}: ${res.errors.map((e) => `${e.source}: ${e.message}`).join("; ")}`
          : `no metadata found for ${id?.raw ?? "the identifier"}`,
        sourceErrors
          ? "Try again in a minute."
          : "Check the identifier for typos, or add the PDF itself so that citegeist reads it from the first page.",
        { identifier: id?.raw ?? null },
        sourceErrors ? "retry" : "fix-and-retry",
      );
    }
    const { ids, ...fields } = res.fields;
    const idMap: Record<string, string> = { ...(ids ?? {}) };
    const arxiv = idMap.arxiv ?? (id?.kind === "arxiv" ? id.value : undefined);
    const pdfUrl = res.enrichment.openAccess?.pdfUrl;
    return {
      fields: fields as Record<string, unknown>,
      provenance: res.provenance,
      ids: idMap,
      remote: {
        ...(arxiv ? { arxiv } : {}),
        ...(!arxiv && pdfUrl ? { pdfUrl } : {}),
      },
    };
  }

  private prepareBibtex(raw: string): Prepared {
    const parsed = parseBibtex(raw);
    const draft = parsed.items[0];
    if (!draft) {
      throw problem(
        "BIBTEX_INVALID",
        `the BibTeX entry could not be read: ${parsed.errors.join("; ") || "no entry found"}`,
        "Pass one complete entry such as @article{key, title={...}, author={...}, year={...}}.",
      );
    }
    const { citekey, ids, tags, provenance, ...rest } = draft as Record<string, unknown> & {
      ids?: Record<string, string>;
      tags?: string[];
      provenance?: Record<string, string>;
      citekey?: string;
    };
    const today = this.lib.stamp("system").at.slice(0, 10);
    const prov: Record<string, string> = { ...(provenance ?? {}) };
    for (const k of Object.keys(rest)) prov[k] ??= `bibtex@${today}`;
    return {
      fields: { ...rest, ...(tags ? { tags } : {}) },
      provenance: prov,
      ids: { ...(ids ?? {}) },
      remote: {},
      ...(citekey ? { importedKey: citekey } : {}),
    };
  }

  /**
   * Fetches a URL as a browser would and decides by the content, not by the URL or the content
   * type: a PDF is added like a local PDF, a page like a web page. A file URL that answers with
   * a page (login, cookie or bot wall) is refused, because the page is not the file.
   */
  private async prepareUrl(actor: Actor, url: string): Promise<Prepared> {
    const res = await this.get(url, undefined, ACCEPT_ANY);
    if (!res) {
      throw problem(
        "URL_UNREACHABLE",
        `${url} did not return a page (the server answered 401, 403, 404 or 410)`,
        "Open the URL in a browser to check it. If it needs a login, download the file there and add it by its local path with items.add, or add the article by DOI.",
        { url },
      );
    }
    const kind = sniffContent(res.buf, res.contentType);
    if (kind === "pdf") return this.prepareDownloadedPdf(actor, url, res.buf);
    const claimsFile = isFileUrl(url) || /pdf|epub/i.test(res.contentType);
    if (kind === "html" && claimsFile) {
      throw problem(
        "URL_RETURNED_HTML",
        `${url} returned an HTML page, not the file the address names (a login, cookie or bot wall, or a moved file)`,
        "Download the file in a browser and add it by its local path with items.add, for example ~/Downloads/paper.pdf.",
        { url, contentType: res.contentType || null },
      );
    }
    if (kind !== "html") {
      throw problem(
        "URL_UNSUPPORTED_CONTENT",
        `${url} returned content that is neither a PDF nor a web page${res.contentType ? ` (${res.contentType})` : ""}`,
        "Download the file and add it by its local path with items.add if it is a PDF, HTML page or EPUB.",
        { url, contentType: res.contentType || null },
      );
    }
    const html = res.buf.toString("utf8");
    const found = pageTitle(html);
    const title = found ?? titleFromUrl(url);
    const today = this.lib.stamp("system").at.slice(0, 10);
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      fields: { type: "webpage", title, URL: url, "container-title": host },
      provenance: {
        title: `web@${today}`,
        URL: `web@${today}`,
        "container-title": `web@${today}`,
      },
      ids: {},
      remote: {},
      file: { buf: res.buf, kind: "web", ext: "html", filename: `${slugFile(title)}.html`, url },
      ...(found
        ? {}
        : {
            proposal: {
              status: "needs-review",
              source: "url",
              reason: "the page has no title, the title was taken from the address",
            },
          }),
    };
  }

  /** A PDF that came from a URL: handled like a local PDF, with the URL as its origin. */
  private async prepareDownloadedPdf(actor: Actor, url: string, buf: Buffer): Promise<Prepared> {
    const stem = urlStem(url);
    const dir = mkdtempSync(join(tmpdir(), "citegeist-url-"));
    const path = join(dir, `${slugFile(stem)}.pdf`);
    try {
      writeFileSync(path, buf);
      const file: LocalFile = {
        buf,
        kind: "pdf",
        ext: "pdf",
        filename: `${slugFile(stem)}.pdf`,
        url,
      };
      const prepared = await this.preparePdf(actor, path, file, stem);
      return { ...prepared, fields: { URL: url, ...prepared.fields } };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async prepareFile(actor: Actor, path: string): Promise<Prepared> {
    const ext = extname(path).toLowerCase();
    const type = FILE_KINDS[ext];
    if (!type) {
      throw problem(
        "FILE_TYPE_UNSUPPORTED",
        `files of type '${ext || "none"}' cannot be added (${basename(path)})`,
        "Add a PDF, HTML or EPUB file.",
        { path, ext },
      );
    }
    const buf = readFileSync(path);
    if (type.kind === "pdf" && !isPdf(buf) && sniffContent(buf, "") === "html") {
      throw problem(
        "FILE_IS_HTML",
        `${basename(path)} has the extension .pdf but holds an HTML page (usually a download that failed)`,
        "Download the file again in a browser, check that it opens as a PDF, and pass its path.",
        { path },
      );
    }
    const file: LocalFile = { buf, kind: type.kind, ext: type.ext, filename: basename(path) };
    const today = this.lib.stamp(actor).at.slice(0, 10);
    const stem = basename(path, extname(path));

    if (type.kind === "web") {
      const title = pageTitle(buf.toString("utf8")) ?? stem;
      return {
        fields: { type: "webpage", title },
        provenance: { title: `html@${today}` },
        ids: {},
        remote: {},
        file,
      };
    }
    if (type.kind === "epub") {
      return {
        fields: { type: "book", title: stem.replace(/[_-]+/g, " ") },
        provenance: { title: `filename@${today}` },
        ids: {},
        remote: {},
        file,
        proposal: {
          status: "needs-review",
          source: "filename",
          reason: "no metadata in an EPUB file",
        },
      };
    }

    return this.preparePdf(actor, path, file, stem);
  }

  /** PDF: identifiers in the first pages, then title matching on the first page. */
  private async preparePdf(
    actor: Actor,
    path: string,
    file: LocalFile,
    stem: string,
  ): Promise<Prepared> {
    const today = this.lib.stamp(actor).at.slice(0, 10);
    const text = await this.pdfText(path);
    const found = pickPrimary(extractIdentifiers(text.leading));
    if (found) {
      try {
        const res = await this.deps.resolver.resolve(found);
        if (res.status === "resolved" && res.fields.title) {
          return { ...this.fromResolved(res, found), remote: {}, file };
        }
      } catch (err) {
        if (!(err instanceof CitegeistError)) throw err;
      }
    }
    const header = guessHeader(text.firstPage);
    if (!header) {
      return {
        fields: { type: "document", title: stem.replace(/[_-]+/g, " ") },
        provenance: { title: `filename@${today}` },
        ids: {},
        remote: {},
        file,
        proposal: {
          status: "needs-review",
          source: "filename",
          reason: text.firstPage
            ? "no title found on the first page"
            : "no text layer on the first page",
        },
      };
    }
    const query: TitleQuery = {
      title: header.title,
      ...(header.firstAuthor ? { firstAuthor: header.firstAuthor } : {}),
      ...(header.year !== undefined ? { year: header.year } : {}),
      ...(header.type ? { type: header.type } : {}),
    };
    let match: TitleResolveResult | undefined;
    try {
      match = await this.deps.resolver.resolveByTitle(query);
    } catch {
      match = undefined;
    }
    if (match?.match.verdict === "accept" && match.resolved?.status === "resolved") {
      if (match.resolved.fields.title) {
        return { ...this.fromResolved(match.resolved), remote: {}, file };
      }
    }
    const author = header.firstAuthor ? splitName(header.firstAuthor) : undefined;
    return {
      fields: {
        type: "document",
        title: header.title,
        ...(author ? { author: [author] } : {}),
        ...(header.year !== undefined ? { issued: header.year } : {}),
      },
      provenance: {
        title: `pdf-text@${today}`,
        ...(author ? { author: `pdf-text@${today}` } : {}),
        ...(header.year !== undefined ? { issued: `pdf-text@${today}` } : {}),
      },
      ids: {},
      remote: {},
      file,
      proposal: {
        status: "needs-review",
        source: "pdf-first-page",
        reason: match
          ? `title matching gave '${match.match.verdict}', no confident match`
          : "title matching was not possible (metadata sources unreachable)",
        candidates: (match?.match.scored ?? []).slice(0, 3).map((s) => ({
          title: s.candidate.title ?? null,
          DOI: s.candidate.DOI ?? null,
          similarity: Number(s.titleSimilarity.toFixed(2)),
        })),
      },
    };
  }

  private existingKeys(): Set<string> {
    const keys = new Set(
      this.lib.index.all<{ citekey: string }>("SELECT citekey FROM items").map((r) => r.citekey),
    );
    try {
      for (const e of readdirSync(this.lib.paths.itemsDir)) keys.add(e);
    } catch {
      // no items folder yet
    }
    return keys;
  }

  private createItem(actor: Actor, input: AddInput, p: Prepared, jobId: string): string {
    const stamp = this.lib.stamp(actor);
    const existing = this.existingKeys();
    const formula = this.lib.manifest.defaults.citekey;
    const keySource = {
      title: String(p.fields.title),
      ...(p.fields.author ? { author: p.fields.author as never } : {}),
      ...(p.fields.editor ? { editor: p.fields.editor as never } : {}),
      ...(p.fields.issued !== undefined ? { issued: p.fields.issued as never } : {}),
    };
    const citekey = p.importedKey
      ? resolveImportedCitekey({ ...keySource, citekey: p.importedKey }, existing, formula)
      : generateCitekey(keySource, existing, formula);

    const sources: Source[] = [];
    if (p.file) {
      const hash = sha256Hex(p.file.buf).slice(0, 12);
      writeFileAtomic(this.lib.paths.sourceFile(citekey, hash, p.file.ext), p.file.buf);
      sources.push({
        hash,
        kind: p.file.kind,
        filename: p.file.filename,
        role: "main",
        ...(p.file.url ? { url: p.file.url } : {}),
        added: stamp,
      });
    }
    const toInbox = actor !== "human" && input.target !== "library";
    const { tags: draftTags, ...fields } = p.fields as { tags?: string[] } & Record<
      string,
      unknown
    >;
    const fm = ItemFrontmatter.parse({
      id: newItemId(),
      citekey,
      type: "document",
      ...fields,
      ids: p.ids,
      tags: [...new Set([...(draftTags ?? []), ...input.tags])],
      projects: input.projects,
      provenance: p.provenance,
      sources,
      ...(toInbox
        ? { inbox: { by: actor, ...(input.why ? { why: input.why } : {}), job: jobId } }
        : {}),
      ...(p.proposal ? { proposal: p.proposal } : {}),
      created: stamp,
    });
    const result = this.lib.writeItem(fm);
    if (result.status !== "indexed") {
      throw problem(
        "ITEM_NOT_CREATED",
        `the new item ${citekey} was not accepted by the index: ${(result.issues ?? []).map((i) => i.message).join("; ") || result.status}`,
        "Check the problem list in library.status and retry.",
        { citekey },
      );
    }
    return citekey;
  }

  // Remote files -------------------------------------------------------------------------------

  /** GET with transient-error mapping. Undefined for 401, 403, 404 and 410 (not available). */
  private async get(
    url: string,
    signal: AbortSignal | undefined,
    accept: string,
  ): Promise<{ buf: Buffer; contentType: string } | undefined> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...(signal ? { signal } : {}),
        redirect: "follow",
        headers: {
          accept,
          "user-agent": BROWSER_UA,
          "accept-language": "en-US,en;q=0.9,de;q=0.8",
        },
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new TransientError(`could not fetch ${url}: ${(err as Error).message}`, { cause: err });
    }
    if ([401, 403, 404, 410].includes(res.status)) return undefined;
    if (!res.ok) throw new TransientError(`HTTP ${res.status} for ${url}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get("content-type") ?? "" };
  }

  private addSource(actor: Actor, citekey: string, file: LocalFile): Source | undefined {
    const hash = sha256Hex(file.buf).slice(0, 12);
    const item = loadItem(this.lib, citekey);
    if (item.fm.sources.some((s) => s.hash === hash || (file.url && s.url === file.url))) {
      return undefined;
    }
    writeFileAtomic(this.lib.paths.sourceFile(citekey, hash, file.ext), file.buf);
    const source: Source = {
      hash,
      kind: file.kind,
      filename: file.filename,
      role: "main",
      ...(file.url ? { url: file.url } : {}),
      added: this.lib.stamp(actor),
    };
    saveItem(this.lib, actor, item, { sources: [...item.fm.sources, source] });
    return source;
  }

  /**
   * items.attach: copies a local file into an existing item and queues its conversion. A file the
   * item has already (same content, or same origin URL) is not added again; the answer then names
   * the source that is there and starts no job. A second main file of the same kind becomes a
   * supplement, so the reader keeps showing the first one.
   */
  attachFile(
    actor: Actor,
    input: {
      citekey: string;
      path: string;
      url?: string | undefined;
      filename?: string | undefined;
    },
  ): { citekey: string; source: string; added: boolean; job?: string } {
    const item = loadItem(this.lib, input.citekey);
    const path = this.asLocalPath(input.path);
    if (!path) {
      throw problem(
        "FILE_NOT_FOUND",
        `file '${input.path}' does not exist`,
        "Pass the absolute path of an existing PDF, HTML or EPUB file.",
        { path: input.path },
      );
    }
    const ext = extname(path).toLowerCase();
    const type = FILE_KINDS[ext];
    if (!type) {
      throw problem(
        "FILE_TYPE_UNSUPPORTED",
        `files of type '${ext || "none"}' cannot be attached (${basename(path)})`,
        "Attach a PDF, HTML or EPUB file.",
        { path, ext },
      );
    }
    const buf = readFileSync(path);
    if (type.kind === "pdf" && !isPdf(buf)) {
      throw problem(
        "FILE_TYPE_UNSUPPORTED",
        `${basename(path)} has the extension .pdf but is not a PDF file`,
        "Attach a real PDF file.",
        { path },
      );
    }
    const url = input.url && /^https?:\/\//i.test(input.url) ? input.url : undefined;
    const hash = sha256Hex(buf).slice(0, 12);
    const known = item.fm.sources.find((s) => s.hash === hash || (url && s.url === url));
    if (known) {
      if (existsSync(this.lib.paths.derivedManifest(input.citekey, known.hash))) {
        return { citekey: input.citekey, source: known.hash, added: false };
      }
      if (!this.needsRepair(input.citekey)) {
        return { citekey: input.citekey, source: known.hash, added: false };
      }
      // The file is there but never converted: convert it again.
      const retry = this.queue.enqueue({
        kind: "convert",
        by: actor,
        input: { citekey: input.citekey, source: known.hash, force: true },
      });
      return { citekey: input.citekey, source: known.hash, added: false, job: retry.id };
    }

    // Sources that never converted give way to the new file when the item has no working one.
    if (this.needsRepair(input.citekey)) this.dropBrokenSources(input.citekey);
    writeFileAtomic(this.lib.paths.sourceFile(input.citekey, hash, type.ext), buf);
    const fresh = loadItem(this.lib, input.citekey);
    const hasMain = fresh.fm.sources.some((s) => s.kind === type.kind && s.role === "main");
    const source: Source = {
      hash,
      kind: type.kind,
      filename: input.filename ?? basename(path),
      role: hasMain ? "supplement" : "main",
      ...(url ? { url } : {}),
      added: this.lib.stamp(actor),
    };
    saveItem(this.lib, actor, fresh, { sources: [...fresh.fm.sources, source] });
    const job = this.queue.enqueue({
      kind: "convert",
      by: actor,
      input: { citekey: input.citekey, source: hash, force: false },
    });
    return { citekey: input.citekey, source: hash, added: true, job: job.id };
  }

  private async fetchSources(
    ctx: JobContext,
    citekey: string,
    remote: RemotePlan,
  ): Promise<string[]> {
    const notes: string[] = [];
    const actor = ctx.job.by;
    const have = (url: string): boolean =>
      loadItem(this.lib, citekey).fm.sources.some((s) => s.url === url);
    if (remote.arxiv) {
      const id = remote.arxiv;
      const htmlUrl = `https://arxiv.org/html/${id}`;
      const pdfUrl = `https://arxiv.org/pdf/${id}`;
      if (!have(htmlUrl)) {
        const html = await this.get(htmlUrl, ctx.signal, "text/html");
        if (html && /html/i.test(html.contentType) && html.buf.length > 500) {
          this.addSource(actor, citekey, {
            buf: html.buf,
            kind: "arxiv-html",
            ext: "html",
            filename: `${slugFile(id)}.html`,
            url: htmlUrl,
          });
        } else notes.push("no arXiv HTML");
      }
      ctx.progress(0.1);
      if (!have(pdfUrl)) {
        const pdf = await this.get(pdfUrl, ctx.signal, "application/pdf");
        if (pdf && isPdf(pdf.buf)) {
          this.addSource(actor, citekey, {
            buf: pdf.buf,
            kind: "pdf",
            ext: "pdf",
            filename: `${slugFile(id)}.pdf`,
            url: pdfUrl,
          });
        } else notes.push("no arXiv PDF");
      }
    } else if (remote.pdfUrl && !have(remote.pdfUrl)) {
      const pdf = await this.get(remote.pdfUrl, ctx.signal, "application/pdf");
      if (pdf && isPdf(pdf.buf)) {
        this.addSource(actor, citekey, {
          buf: pdf.buf,
          kind: "pdf",
          ext: "pdf",
          filename: `${citekey}.pdf`,
          url: remote.pdfUrl,
        });
      } else notes.push("open-access PDF not downloadable");
    }
    return notes;
  }

  // Jobs ---------------------------------------------------------------------------------------

  private async runIngest(ctx: JobContext): Promise<unknown> {
    const input = ctx.job.input as { citekey: string; remote?: RemotePlan; convert?: boolean };
    const { citekey } = input;
    ctx.progress(0.05, "fetching sources");
    const notes = await this.fetchSources(ctx, citekey, input.remote ?? {});
    const item = loadItem(this.lib, citekey);
    if (item.fm.sources.length === 0) {
      return {
        citekey,
        sources: 0,
        converted: false,
        message: `no source file available${notes.length ? ` (${notes.join(", ")})` : ""}`,
      };
    }
    ctx.progress(0.3, "converting");
    const child = this.queue.enqueue({
      kind: "convert",
      by: ctx.job.by,
      parent: ctx.job.id,
      input: { citekey, force: false },
    });
    const onAbort = (): void => {
      this.queue.cancel(child.id);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const sub = (job: { id: string; progress: number; message?: string | undefined }): void => {
      if (job.id === child.id) ctx.progress(0.3 + 0.7 * job.progress, job.message);
    };
    this.queue.on("job", sub);
    let done: Awaited<ReturnType<JobQueue["waitFor"]>>;
    try {
      done = await this.queue.waitFor(child.id);
    } finally {
      this.queue.off("job", sub);
      ctx.signal.removeEventListener("abort", onAbort);
    }
    if (done.status === "cancelled") throw new Error("The operation was cancelled");
    if (done.status === "failed") {
      throw problem(
        done.error?.code ?? "CONVERT_FAILED",
        `the item ${citekey} was added, but its conversion failed: ${done.error?.message ?? "unknown error"}`,
        `The item is marked incomplete. Retry with documents.convert (force) once the cause is fixed, attach a correct file with items.attach, or remove the item with items.trash.`,
        { citekey, convertJob: child.id },
      );
    }
    const finalKey = (done.result as { citekey?: string } | undefined)?.citekey ?? citekey;
    return {
      citekey: finalKey,
      sources: item.fm.sources.length,
      converted: true,
      convertJob: child.id,
      notes,
    };
  }

  private async runConvert(ctx: JobContext): Promise<unknown> {
    const input = ctx.job.input as { citekey: string; source?: string; force?: boolean };
    const { citekey } = input;
    const item = loadItem(this.lib, citekey);
    const todo = item.fm.sources.filter(
      (s) =>
        (input.source === undefined || s.hash === input.source) &&
        (input.force || !existsSync(this.lib.paths.derivedManifest(citekey, s.hash))),
    );
    const converted: string[] = [];
    const failed: string[] = [];
    let n = 0;
    for (const source of todo) {
      const base = n / todo.length;
      const span = 1 / todo.length;
      n++;
      ctx.progress(base, `converting ${source.filename}`);
      try {
        // A step without a position keeps the last one and only changes the message.
        let at = base;
        await this.convertSource(ctx, citekey, source, (p, message) => {
          if (p !== undefined) at = base + span * p;
          ctx.progress(at, message);
        });
        converted.push(source.hash);
      } catch (err) {
        // The HTML of an arXiv paper may fail while the PDF works: keep going, fail at the end.
        if (todo.length === 1 || ctx.signal.aborted || isFatal(err)) throw err;
        failed.push(`${source.filename}: ${(err as Error).message}`);
      }
    }
    if (converted.length === 0 && failed.length > 0) {
      throw problem(
        "CONVERT_FAILED",
        `no source of ${citekey} could be converted: ${failed.join("; ")}`,
        "The item is marked incomplete. Attach a correct file with items.attach, retry with documents.convert (force), or remove the item with items.trash.",
        { citekey },
      );
    }
    let finalKey = citekey;
    let renamed: { from: string; to: string } | undefined;
    if (converted.length > 0) {
      const done = await this.afterConvert(ctx, citekey, converted);
      finalKey = done.citekey;
      renamed = done.renamed;
    }
    return {
      citekey: finalKey,
      converted,
      skipped: item.fm.sources.length - todo.length,
      failed,
      ...(renamed ? { renamed } : {}),
    };
  }

  /**
   * A conversion worked: the item is no longer incomplete, and when its metadata was only a
   * guess, the first page now improves it (and a placeholder citekey, if nothing cites the item).
   */
  private async afterConvert(
    ctx: JobContext,
    citekey: string,
    converted: string[],
  ): Promise<{ citekey: string; renamed?: { from: string; to: string } }> {
    const actor = ctx.job.by;
    let key = citekey;
    let renamed: { from: string; to: string } | undefined;
    const item = loadItem(this.lib, citekey);
    const wasIncomplete = item.fm.incomplete !== undefined;
    const source = item.fm.sources.find((s) => converted.includes(s.hash) && s.kind === "pdf");
    if (source) {
      try {
        const sourcePath = this.lib.paths.sourceFile(citekey, source.hash, "pdf");
        const res = await enrichAfterConvert(
          {
            lib: this.lib,
            resolver: this.deps.resolver,
            pdfText: this.pdfText,
            ai: this.deps.ai,
          },
          actor,
          citekey,
          source,
          sourcePath,
          wasIncomplete,
        );
        if (res.renamed) {
          key = res.renamed.to;
          renamed = res.renamed;
        }
      } catch {
        // Better metadata is a bonus; the conversion itself worked.
      }
    }
    try {
      const now = loadItem(this.lib, key);
      if (now.fm.incomplete !== undefined)
        saveItem(this.lib, actor, now, { incomplete: undefined });
    } catch {
      // the item was removed in the meantime
    }
    return { citekey: key, ...(renamed ? { renamed } : {}) };
  }

  /** Marks an item incomplete when its ingest or conversion failed and no source works. */
  private onJob(job: Job): void {
    if (job.status !== "failed" || (job.kind !== "convert" && job.kind !== "ingest")) return;
    const citekey = (job.input as { citekey?: unknown } | null)?.citekey;
    if (typeof citekey !== "string") return;
    try {
      if (!this.lib.index.get("SELECT 1 FROM items WHERE citekey = ?", citekey)) return;
      if (this.hasWorkingSource(citekey)) return;
      const item = loadItem(this.lib, citekey);
      // The convert job names the cause; the ingest job around it only repeats it.
      if (item.fm.incomplete && job.kind === "ingest") return;
      saveItem(this.lib, "system", item, {
        incomplete: {
          code: job.error?.code ?? "JOB_FAILED",
          message: job.error?.message ?? job.message ?? "the job failed",
          at: this.lib.stamp("system").at,
          job: job.id,
        },
      });
    } catch {
      // The item is gone or the library is closing. Nothing to mark.
    }
  }

  private async convertSource(
    ctx: JobContext,
    citekey: string,
    source: Source,
    progress: (fraction: number | undefined, message?: string) => void,
  ): Promise<void> {
    const lib = this.lib;
    const finalDir = lib.paths.derivedDir(citekey, source.hash);
    const tmpDir = join(dirname(finalDir), `.${source.hash}.${randomBytes(4).toString("hex")}.tmp`);
    const previous = lib.paths.blocks(citekey, source.hash);
    const sourcePath = lib.paths.sourceFile(
      citekey,
      source.hash,
      source.kind === "pdf" ? "pdf" : source.kind === "epub" ? "epub" : "html",
    );
    mkdirSync(dirname(finalDir), { recursive: true });
    await this.deps.ensureLocal?.(relative(lib.root, sourcePath));
    try {
      const result = await this.deps.worker.convert(
        {
          sourcePath,
          source: source.hash,
          outDir: tmpDir,
          kind: CONVERT_KINDS[source.kind],
          ...(existsSync(previous) ? { previousBlocks: previous } : {}),
        },
        { signal: ctx.signal, onProgress: progress },
      );
      if (!existsSync(join(tmpDir, "manifest.json"))) {
        writeFileAtomic(
          join(tmpDir, "manifest.json"),
          `${JSON.stringify(result.manifest, null, 2)}\n`,
        );
      }
      rmSync(finalDir, { recursive: true, force: true });
      renameSync(tmpDir, finalDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    const blocks = `items/${citekey}/derived/${source.hash}/blocks.jsonl`;
    if (existsSync(lib.paths.abs(blocks))) lib.indexer.indexFile(blocks);
    const pagesFile = lib.paths.pages(citekey, source.hash);
    if (existsSync(pagesFile)) {
      const pages = Pages.safeParse(JSON.parse(readFileSync(pagesFile, "utf8")));
      if (pages.success && pages.data.pages.length > 0) {
        const item = loadItem(lib, citekey);
        const sources = item.fm.sources.map((s) =>
          s.hash === source.hash ? { ...s, pages: pages.data.pages.length } : s,
        );
        saveItem(lib, ctx.job.by, item, { sources });
      }
    }
  }

  // Operations ---------------------------------------------------------------------------------

  convertItem(actor: Actor, citekey: string, force: boolean): { job: string } {
    const item = loadItem(this.lib, citekey);
    if (item.fm.sources.length === 0) {
      throw problem(
        "NO_SOURCES",
        `item ${citekey} has no source file to convert`,
        "Add a PDF or HTML file to the item first.",
        { citekey },
        "do-first",
      );
    }
    const job = this.queue.enqueue({ kind: "convert", by: actor, input: { citekey, force } });
    return { job: job.id };
  }

  readDocument = (input: Parameters<typeof readDocument>[1]) => readDocument(this.lib, input);
  updateItem = (actor: Actor, citekey: string, patch: Record<string, unknown>) =>
    updateItem(this.lib, actor, citekey, patch);
  renameItem = (actor: Actor, from: string, to: string) => renameItem(this.lib, actor, from, to);
  trashItem = (actor: Actor, citekey: string) => {
    assertMayTrash(this.lib, actor, citekey);
    trashItem(this.lib, citekey, actor);
  };
  acceptInbox = (actor: Actor, citekeys: string[]) => acceptInbox(this.lib, actor, citekeys);
  rejectInbox = (citekeys: string[], actor: Actor = "human") =>
    rejectInbox(this.lib, citekeys, actor);
}

function isFatal(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** What a response really is, judged by its bytes first and by the content type second. */
function sniffContent(buf: Buffer, contentType: string): "pdf" | "html" | "other" {
  // Some servers put a few bytes in front of the PDF header; the spec allows the first 1024.
  if (buf.subarray(0, 1024).toString("latin1").includes("%PDF-")) return "pdf";
  const head = buf.subarray(0, 4096).toString("utf8").toLowerCase();
  if (/<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<title[\s>]/.test(head)) return "html";
  if (/html|xml/i.test(contentType) && head.trim().startsWith("<")) return "html";
  return "other";
}

/** An address that names a file, not a page: it ends in .pdf or .epub before query and anchor. */
function isFileUrl(url: string): boolean {
  try {
    return /\.(pdf|epub)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** File name stem of the last path segment, for a name and a title when nothing better exists. */
function urlStem(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    const stem = last
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .replace(/[_+-]+/g, " ")
      .trim();
    return stem || "download";
  } catch {
    return "download";
  }
}

/** A page without a title gets the readable part of its address, never its domain name. */
function titleFromUrl(url: string): string {
  const stem = urlStem(url);
  return stem === "download" ? url.replace(/^https?:\/\//i, "").replace(/\/$/, "") : stem;
}

function pageTitle(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const t = og ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const clean = t
    ?.replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function slugFile(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file"
  );
}

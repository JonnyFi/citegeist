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
  arxivFromDoi,
  detectIdentifier,
  extractPageMetadata,
  type FetchLike,
  type Identifier,
  type PageMetadata,
  type PdfLocation,
  type ResolveOptions,
  type ResolveResult,
  type TitleQuery,
  type TitleResolveResult,
  titleSimilarity,
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
import { findDuplicate, findEnrichable } from "./dupes.js";
import { enrichAfterConvert, splitName } from "./enrich.js";
import {
  findPdfLinks,
  hostOf,
  MAX_CANDIDATES,
  MAX_REQUESTS,
  mergeCandidates,
  type OpenAccessSource,
  orderCandidates,
  type PdfCandidate,
  rewriteRepositoryUrl,
} from "./fulltext.js";
import {
  acceptInbox,
  assertMayTrash,
  isCited,
  isInInbox,
  loadItem,
  problem,
  rejectInbox,
  renameItem,
  restoreItem,
  saveItem,
  trashItem,
  updateItem,
} from "./items.js";
import { lookupAddresses, MAX_REDIRECTS, refusePrivateUrl } from "./net-guard.js";
import { extractPdfText, guessHeader, type PdfTextExtractor, pdfIdentifiers } from "./pdf-text.js";
import { hasThinMetadata } from "./placeholder.js";
import {
  fillFromTwin,
  type Lookup,
  type MergeOutcome,
  mergeLookup,
  resolveItem,
} from "./resolve.js";
import type { ConvertParams, ConvertWorker } from "./worker.js";

/** The part of MetadataResolver the pipeline uses. Tests pass a resolver with replayed responses. */
export interface MetadataLookup {
  resolve(input: string | Identifier, options?: ResolveOptions): Promise<ResolveResult>;
  resolveByTitle(query: TitleQuery, options?: ResolveOptions): Promise<TitleResolveResult>;
  /** Unpaywall: open-access status, the best PDF url and every PDF location of a DOI. */
  findOpenAccess?(
    doi: string,
  ): Promise<{ pdfUrl?: string | undefined; pdfLocations?: PdfLocation[] | undefined } | undefined>;
  /** OpenAlex: PDF locations of a DOI (best, primary, all others, oa_url), best first. */
  findOpenAlexPdfs?(doi: string): Promise<(string | PdfLocation)[]>;
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
  /**
   * Resolves a host name to its addresses, for the SSRF check of downloads that agents and jobs
   * start (M5). Default: the system resolver. Without it and with an injected `fetch` (tests), names
   * are not resolved.
   */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Largest download in bytes. Default 300 MiB. */
  maxDownloadBytes?: number;
}

function sourceExt(kind: Source["kind"]): string {
  return kind === "pdf" ? "pdf" : kind === "epub" ? "epub" : "html";
}

export interface AddInput {
  identifier: string;
  projects: string[];
  tags: string[];
  target: "inbox" | "library";
  why?: string | undefined;
  /**
   * Add the identifier to this existing item and look its metadata up again, instead of adding a
   * new item. For items that arrived without authors or year.
   */
  citekey?: string | undefined;
}

export interface AddResult {
  citekey: string;
  job: string;
  duplicateOf?: string;
  /** The matched item had no working source; the new file or download was attached to it. */
  repaired?: boolean;
  /** The matched item waits in the inbox. Adding it again does not accept it. */
  inInbox?: boolean;
  /** Fields of the existing item that the new identifier filled or corrected. */
  enriched?: string[];
  /** The item has a placeholder citekey and now has what a real one needs. Nothing was renamed. */
  suggestedCitekey?: string;
}

interface RemotePlan {
  /**
   * DOI of the work. With it the job looks for a full text in order: Unpaywall, OpenAlex
   * open-access locations, arXiv, the citation_pdf_url tag of the publisher page.
   */
  doi?: string;
  /** Landing page of the work (the URL field), for the publisher step. */
  landing?: string;
  /** arXiv id: HTML and PDF come from arxiv.org. */
  arxiv?: string;
  /** Open-access PDF url from the metadata sources. */
  pdfUrl?: string;
}

/**
 * One entry of the full text lookup log for a DOI: a source that failed or had no location, or one
 * address that was tried. `source` is the one that named the address, `detail` starts with its
 * host and says what came back (pdf, html-no-link, HTTP status, blocked).
 */
export interface FulltextAttempt {
  source: "unpaywall" | "openalex" | "arxiv" | "publisher";
  outcome: "ok" | "none" | "failed";
  url?: string;
  detail?: string;
}

type Fetched =
  | { kind: "ok"; buf: Buffer; contentType: string; url: string }
  | { kind: "status"; status: number }
  | { kind: "large" };

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
  /** A library item the file's identifier already names: the file goes there, no new item. */
  duplicateOf?: string;
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

/** The body of a response, read in chunks. Undefined when it is larger than `limit` bytes. */
async function readLimited(res: Response, limit: number): Promise<Buffer | undefined> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, size);
}

/** Servers that turn away unknown clients answer a browser. Redirects are followed by fetch. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ACCEPT_ANY = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8";

/** Ingest pipeline, item operations and the job queue behind them. */
export class IngestService {
  readonly queue: JobQueue;
  private readonly fetchFn: FetchLike;
  private readonly pdfText: PdfTextExtractor;
  private readonly resolveHost: ((host: string) => Promise<string[]>) | undefined;
  private readonly maxDownload: number;

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
    this.resolveHost = deps.resolveHost ?? (deps.fetch ? undefined : lookupAddresses);
    this.maxDownload = deps.maxDownloadBytes ?? MAX_DOWNLOAD;
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
    if (input.citekey) return this.addToItem(actor, input.citekey, raw);
    const early = this.earlyDuplicate(raw);
    const named = detectIdentifier(raw);
    // An item whose source failed is not a finished duplicate: the new input may repair it. An
    // item without author or year is not finished either: the identifier may fill them in.
    const mayEnrich =
      early !== undefined && named !== undefined && named.kind !== "url" && this.isThin(early);
    if (early && !this.mayRepair(early) && !mayEnrich) return this.duplicate(actor, early);

    let prepared: Prepared;
    try {
      prepared = await this.prepare(actor, raw);
    } catch (err) {
      if (early) return this.duplicate(actor, early);
      throw err;
    }
    if (prepared.duplicateOf) {
      return (
        this.repairDuplicate(actor, prepared.duplicateOf, prepared) ??
        this.duplicate(actor, prepared.duplicateOf)
      );
    }
    const lookupHash = prepared.file ? sha256Hex(prepared.file.buf).slice(0, 12) : undefined;
    const first = (
      prepared.fields.author as { family?: string; literal?: string }[] | undefined
    )?.[0];
    const doi = prepared.fields.DOI as string | undefined;
    const dup =
      early ??
      findDuplicate(this.lib, {
        doi,
        arxiv: prepared.ids.arxiv,
        pmid: prepared.ids.pmid,
        isbn: detectIdentifier(raw)?.kind === "isbn" ? detectIdentifier(raw)?.value : undefined,
        url: prepared.file?.url,
        urls: [
          ...(typeof prepared.fields.URL === "string" ? [prepared.fields.URL] : []),
          ...(doi ? [`https://doi.org/${doi}`] : []),
        ],
        hash: lookupHash,
        title: prepared.proposal ? undefined : (prepared.fields.title as string | undefined),
        year: prepared.fields.issued as string | number | undefined,
        firstAuthor: first?.family ?? first?.literal,
      });
    if (dup) return this.finishDuplicate(actor, dup, prepared);
    // An item that came in by its page and has no author or year yet may be this very work.
    if (this.isResolved(prepared)) {
      const twin = findEnrichable(this.lib, {
        title: String(prepared.fields.title),
        year: prepared.fields.issued as string | number | undefined,
        firstAuthor: first?.family ?? first?.literal,
      });
      if (twin) return this.finishDuplicate(actor, twin, prepared);
    }

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

  /**
   * items.add with a citekey and projects but no identifier: the existing item joins the
   * projects. No new item, no download. The job is finished at once, as for a duplicate.
   */
  addToProjects(actor: Actor, citekey: string, projects: string[]): AddResult {
    for (const slug of projects) this.lib.getProject(slug);
    const item = loadItem(this.lib, citekey);
    const joined = [...new Set([...item.fm.projects, ...projects])];
    if (joined.length !== item.fm.projects.length) {
      saveItem(this.lib, actor, item, { projects: joined });
    }
    const job = this.queue.enqueueFinished({
      kind: "ingest",
      by: actor,
      input: { citekey, projects },
      result: { citekey, projects: joined },
      message: `${citekey} is in the projects ${projects.join(", ")}`,
    });
    return { citekey, job: job.id };
  }

  /** True when the item names no author or no year. */
  private isThin(citekey: string): boolean {
    return hasThinMetadata(loadItem(this.lib, citekey).fm);
  }

  /** The input was an identifier that a metadata source answered, not a page or a file. */
  private isResolved(p: Prepared): boolean {
    return p.file === undefined && p.proposal === undefined && p.duplicateOf === undefined;
  }

  /**
   * The input is a work the library has: its identifier, address or title matched `citekey`. When
   * the input brings metadata the item lacks (authors, year, an identifier), the item takes it.
   */
  private finishDuplicate(actor: Actor, citekey: string, p: Prepared): AddResult {
    let outcome: MergeOutcome | undefined;
    if (this.isResolved(p)) {
      const item = loadItem(this.lib, citekey);
      const missesId =
        (typeof p.fields.DOI === "string" && !item.fm.DOI) ||
        (typeof p.fields.ISBN === "string" && !item.fm.ISBN);
      if (hasThinMetadata(item.fm) || missesId) {
        outcome = mergeLookup(
          this.lib,
          actor,
          citekey,
          { fields: p.fields, ids: p.ids, provenance: p.provenance },
          { clearProposal: true },
        );
      }
    }
    const enriched = outcome && outcome.changed.length > 0 ? outcome : undefined;
    let base = this.repairDuplicate(actor, citekey, p);
    if (!base && enriched && p.remote.doi && this.needsRepair(citekey)) {
      // The identifier is new to the item, so the full text lookup has not run for it yet.
      const job = this.queue.enqueue({
        kind: "ingest",
        by: actor,
        input: { citekey, remote: p.remote, convert: true },
      });
      base = { citekey, job: job.id, duplicateOf: citekey };
    }
    base ??= this.duplicate(actor, citekey);
    return {
      ...base,
      ...(enriched ? { enriched: enriched.changed } : {}),
      ...(enriched?.suggestedCitekey ? { suggestedCitekey: enriched.suggestedCitekey } : {}),
    };
  }

  /** items.add with a citekey: the identifier goes into that item and its metadata is looked up. */
  private async addToItem(actor: Actor, citekey: string, identifier: string): Promise<AddResult> {
    const out = await this.resolveItem(actor, citekey, identifier);
    let job: string;
    const doi = loadItem(this.lib, citekey).fm.DOI;
    const remote: RemotePlan = { ...(typeof doi === "string" ? { doi } : {}) };
    if (remote.doi && this.needsRepair(citekey)) {
      job = this.queue.enqueue({
        kind: "ingest",
        by: actor,
        input: { citekey, remote, convert: true },
      }).id;
    } else {
      job = this.queue.enqueueFinished({
        kind: "ingest",
        by: actor,
        input: { citekey, identifier },
        result: { citekey, changed: out.changed },
        message:
          out.changed.length > 0
            ? `updated ${out.changed.join(", ")} of ${citekey}`
            : `nothing new for ${citekey}`,
      }).id;
    }
    return {
      citekey,
      job,
      enriched: out.changed,
      ...(out.suggestedCitekey ? { suggestedCitekey: out.suggestedCitekey } : {}),
    };
  }

  /** items.resolve: look the item up again, optionally with a new identifier (see resolveItem). */
  resolveItem = (actor: Actor, citekey: string, identifier?: string) =>
    resolveItem(
      {
        lib: this.lib,
        resolver: this.deps.resolver,
        fromUrl: (a, url) => this.lookupUrl(a, url),
        refetchUrl: (a, url) => this.refetchUrl(a, url),
      },
      actor,
      citekey,
      identifier,
    );

  /**
   * Reads the page at the address of an item again, for its metadata only: nothing is stored as a
   * source and nothing is converted. A PDF or any other non-page answer counts as a page that
   * yields nothing. A page that names an identifier goes through the normal resolvers; otherwise
   * the fields of the page are the lookup. Undefined when the page has nothing to merge.
   */
  private async refetchUrl(
    actor: Actor,
    url: string,
  ): Promise<{ lookup: Lookup; viaIdentifier: boolean } | undefined> {
    const unreachable = (why: string, recovery: "retry" | "fix-and-retry"): CitegeistError =>
      problem(
        "URL_UNREACHABLE",
        `${url} could not be read again (${why})`,
        "Open the URL in a browser to check it. If the site turns programs away, add a DOI or ISBN of the work by hand with items.add and the citekey of the item.",
        { url },
        recovery,
      );
    let res: { buf: Buffer; contentType: string; url: string } | undefined;
    try {
      res = await this.get(url, undefined, ACCEPT_ANY, actor);
    } catch (err) {
      if (err instanceof TransientError) throw unreachable(err.message, "retry");
      throw err;
    }
    if (!res) throw unreachable("the server answered 401, 403, 404 or 410", "fix-and-retry");
    if (sniffContent(res.buf, res.contentType) !== "html") return undefined;
    const page = extractPageMetadata(res.buf.toString("utf8"), res.url || url);
    if (page.challenge) {
      throw problem(
        "URL_BOT_CHALLENGE",
        `${url} answered with a bot check page ("Just a moment...", a captcha or an access wall), so its metadata cannot be read`,
        "Add a DOI or ISBN of the work by hand with items.add and the citekey of the item.",
        { url },
      );
    }
    const resolved = await this.resolvePageIdentifiers(page);
    if (resolved) {
      return {
        lookup: { fields: resolved.fields, ids: resolved.ids, provenance: resolved.provenance },
        viaIdentifier: true,
      };
    }
    const ids: Record<string, string> = {};
    const fields: Record<string, unknown> = { ...page.fields };
    for (const id of page.identifiers) {
      if (id.kind === "doi" && fields.DOI === undefined) fields.DOI = id.value;
      if (id.kind === "isbn" && fields.ISBN === undefined) fields.ISBN = id.value;
      if (id.kind === "arxiv" && ids.arxiv === undefined) ids.arxiv = id.value;
      if (id.kind === "pmid" && ids.pmid === undefined) ids.pmid = id.value;
    }
    // A title alone is what a title match does better.
    const informative = Object.keys(fields).some((k) => k !== "title" && k !== "type");
    if (!informative && Object.keys(ids).length === 0) return undefined;
    const today = this.lib.stamp("system").at.slice(0, 10);
    const provenance: Record<string, string> = {};
    for (const key of Object.keys(fields)) provenance[key] = `web@${today}`;
    return { lookup: { fields, ids, provenance }, viaIdentifier: false };
  }

  /** What a web page says about its work, in the shape of a metadata lookup. */
  private async lookupUrl(actor: Actor, url: string): Promise<Lookup> {
    const p = await this.prepareUrl(actor, url);
    return { fields: p.fields, ids: p.ids, provenance: p.provenance };
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
    return {
      citekey,
      job: jobId,
      duplicateOf: citekey,
      repaired: true,
      ...(isInInbox(this.lib, citekey) ? { inInbox: true } : {}),
    };
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

  /**
   * The input is a work the library has. An item in the inbox stays there: only inbox.accept
   * moves it into the library, so the answer says `inInbox` and the caller offers that.
   */
  private duplicate(actor: Actor, citekey: string): AddResult {
    const inInbox = isInInbox(this.lib, citekey);
    const job = this.queue.enqueueFinished({
      kind: "ingest",
      by: actor,
      input: { duplicateOf: citekey },
      result: { duplicateOf: citekey, ...(inInbox ? { inInbox } : {}) },
      message: inInbox
        ? `already in the inbox as ${citekey}`
        : `already in the library as ${citekey}`,
    });
    return { citekey, job: job.id, duplicateOf: citekey, ...(inInbox ? { inInbox } : {}) };
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
    try {
      const res = await this.deps.resolver.resolve(id);
      return this.fromResolved(res, id);
    } catch (err) {
      // An identifier guessed from the address (SSRN number, DOI in the path) may be wrong or
      // unknown to the sources; the page itself can still say what the work is.
      if (id.via !== "url" || !(err instanceof CitegeistError)) throw err;
      try {
        return await this.prepareUrl(actor, id.raw);
      } catch {
        throw err;
      }
    }
  }

  /**
   * True when `items.add` would read a local file for this input: a path, a file URL or a bare
   * file name. A path that does not exist counts too, so that the refusal does not reveal what
   * is on the disk.
   */
  namesLocalFile(identifier: string): boolean {
    const raw = identifier.trim();
    if (/^\s*@[A-Za-z]+\s*\{/.test(raw)) return false;
    try {
      return this.asLocalPath(raw) !== undefined;
    } catch {
      return true;
    }
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
    // A DOI the user gave (or the one a PDF names) starts the full text lookup chain. An arXiv
    // id the user gave names its own files.
    const doi = typeof fields.DOI === "string" && id?.kind !== "arxiv" ? fields.DOI : undefined;
    const landing = typeof fields.URL === "string" ? fields.URL : undefined;
    return {
      fields: fields as Record<string, unknown>,
      provenance: res.provenance,
      ids: idMap,
      remote: {
        ...(doi ? { doi } : {}),
        ...(doi && landing ? { landing } : {}),
        ...(arxiv ? { arxiv } : {}),
        ...(pdfUrl ? { pdfUrl } : {}),
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
    const res = await this.get(url, undefined, ACCEPT_ANY, actor);
    if (!res) {
      throw problem(
        "URL_UNREACHABLE",
        `${url} did not return a page (the server answered 401, 403, 404 or 410)`,
        "Open the URL in a browser to check it. Some sites turn away programs (SSRN does); add the article by its DOI, ISBN or arXiv id instead. If it needs a login, download the file there and add it by its local path with items.add.",
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
    const page = extractPageMetadata(html, res.url || url);
    if (page.challenge) {
      throw problem(
        "URL_BOT_CHALLENGE",
        `${url} answered with a bot check page ("Just a moment...", a captcha or an access wall), not with the page`,
        "Add the work by its DOI, ISBN or arXiv id instead. If it has none, open the page in a browser, save it or download the PDF, and add the file by its local path with items.add.",
        { url },
      );
    }
    const resolved = await this.resolvePageIdentifiers(page);
    if (resolved) return resolved;

    const today = this.lib.stamp("system").at.slice(0, 10);
    const host = new URL(url).hostname.replace(/^www\./, "");
    const title = page.fields.title ?? titleFromUrl(url);
    const fields: Record<string, unknown> = {
      ...page.fields,
      type: page.fields.type ?? "webpage",
      title,
      URL: url,
      "container-title": page.fields["container-title"] ?? host,
    };
    // A DOI or ISBN the page names stays on the item even when no source answered for it now,
    // so that a lookup later (items.resolve) has something to start from.
    const ids: Record<string, string> = {};
    for (const id of page.identifiers) {
      if (id.kind === "doi" && fields.DOI === undefined) fields.DOI = id.value;
      if (id.kind === "isbn" && fields.ISBN === undefined) fields.ISBN = id.value;
      if (id.kind === "arxiv" && ids.arxiv === undefined) ids.arxiv = id.value;
      if (id.kind === "pmid" && ids.pmid === undefined) ids.pmid = id.value;
    }
    const provenance: Record<string, string> = {};
    for (const key of Object.keys(fields)) provenance[key] = `web@${today}`;
    const reasons: string[] = [];
    if (page.fields.title === undefined)
      reasons.push("the page has no title, the title was taken from the address");
    else if (!page.fields.author) reasons.push("the page names no author");
    if (page.fields.title !== undefined && !page.fields.issued)
      reasons.push("the page names no date");
    return {
      fields,
      provenance,
      ids,
      remote: {},
      file: { buf: res.buf, kind: "web", ext: "html", filename: `${slugFile(title)}.html`, url },
      ...(reasons.length > 0
        ? { proposal: { status: "needs-review", source: "url", reason: reasons.join("; ") } }
        : {}),
    };
  }

  /**
   * The identifiers a page names for itself (DOI, ISBN, arXiv id, PMID) go through the normal
   * resolvers, because those know more than the page does. A source whose record has nothing
   * to do with the page's own title is not trusted: pages name the DOI of a work they cite, too.
   */
  private async resolvePageIdentifiers(page: PageMetadata): Promise<Prepared | undefined> {
    for (const id of page.identifiers.slice(0, 3)) {
      try {
        const res = await this.deps.resolver.resolve(id);
        if (res.status !== "resolved" || !res.fields.title) continue;
        const own = page.fields.title;
        if (own && titleSimilarity(own, res.fields.title) < 0.45) continue;
        return this.fromResolved(res, id);
      } catch {
        // the next identifier, then the page itself
      }
    }
    return undefined;
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
    // XMP and the first pages name the work: DOI, arXiv id, ISBN, PMID. An identifier the library
    // knows already ends the search, and the file goes to that item.
    // Only the first two count: a later number in the running text is often a cited work.
    const found = pdfIdentifiers(text)
      .filter((i) => i.kind !== "url")
      .slice(0, 2);
    for (const id of found) {
      const hit = findDuplicate(this.lib, {
        ...(id.kind === "doi" ? { doi: id.value } : {}),
        ...(id.kind === "arxiv" ? { arxiv: id.value } : {}),
        ...(id.kind === "isbn" ? { isbn: id.value } : {}),
        ...(id.kind === "pmid" ? { pmid: id.value } : {}),
      });
      if (hit) {
        return {
          fields: { type: "document", title: stem },
          provenance: {},
          ids: {},
          remote: {},
          file,
          duplicateOf: hit,
        };
      }
    }
    for (const id of found) {
      try {
        const res = await this.deps.resolver.resolve(id);
        if (res.status === "resolved" && res.fields.title) {
          return { ...this.fromResolved(res, id), remote: {}, file };
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

  /**
   * GET with transient-error mapping. Undefined for 401, 403, 404 and 410 (not available).
   *
   * The human may fetch any address, an intranet PDF included. Every other actor (an agent, a
   * job of the system) only reaches public servers: each hop of the request, redirects included,
   * is checked against loopback, private networks and link-local addresses, after the name was
   * resolved (M5). A name that resolves differently for the fetch itself (DNS rebinding) is not
   * covered. The body is read as a stream and stops at the size limit.
   */
  private async get(
    url: string,
    signal: AbortSignal | undefined,
    accept: string,
    actor: Actor,
  ): Promise<{ buf: Buffer; contentType: string; url: string } | undefined> {
    const res = await this.fetchOnce(url, signal, accept, actor);
    return res.kind === "ok" ? res : undefined;
  }

  /** Like get, but says why nothing came back: an HTTP status that refuses us, or a file too big. */
  private async fetchOnce(
    url: string,
    signal: AbortSignal | undefined,
    accept: string,
    actor: Actor,
  ): Promise<Fetched> {
    const guarded = actor !== "human";
    let current = url;
    let res: Response | undefined;
    for (let hop = 0; ; hop++) {
      if (guarded) await refusePrivateUrl(current, this.resolveHost);
      try {
        res = await this.fetchFn(current, {
          ...(signal ? { signal } : {}),
          redirect: guarded ? "manual" : "follow",
          headers: {
            accept,
            "user-agent": BROWSER_UA,
            "accept-language": "en-US,en;q=0.9,de;q=0.8",
          },
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new TransientError(`could not fetch ${current}: ${(err as Error).message}`, {
          cause: err,
        });
      }
      const location = res.headers.get("location");
      if (!guarded || !location || res.status < 300 || res.status >= 400) break;
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new TransientError(`too many redirects for ${url}`);
      current = new URL(location, current).href;
    }
    if ([401, 403, 404, 410].includes(res.status)) {
      await res.body?.cancel().catch(() => {});
      return { kind: "status", status: res.status };
    }
    if (!res.ok) throw new TransientError(`HTTP ${res.status} for ${current}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > this.maxDownload) return { kind: "large" };
    const buf = await readLimited(res, this.maxDownload);
    if (!buf) return { kind: "large" };
    return {
      kind: "ok",
      buf,
      contentType: res.headers.get("content-type") ?? "",
      url: res.url || current,
    };
  }

  private addSource(
    actor: Actor,
    citekey: string,
    file: LocalFile,
    role: Source["role"] = "main",
  ): Source | undefined {
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
      role,
      ...(file.url ? { url: file.url } : {}),
      added: this.lib.stamp(actor),
    };
    saveItem(this.lib, actor, item, { sources: [...item.fm.sources, source], fulltext: undefined });
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
    saveItem(this.lib, actor, fresh, {
      sources: [...fresh.fm.sources, source],
      fulltext: undefined,
    });
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
  ): Promise<{ notes: string[]; tried: FulltextAttempt[] }> {
    if (remote.doi) return this.lookupFulltext(ctx, citekey, remote.doi, remote);
    const notes: string[] = [];
    const actor = ctx.job.by;
    const have = (url: string): boolean =>
      loadItem(this.lib, citekey).fm.sources.some((s) => s.url === url);
    if (remote.arxiv) {
      await this.fetchArxiv(ctx, citekey, remote.arxiv, notes);
    } else if (remote.pdfUrl && !have(remote.pdfUrl)) {
      const pdf = await this.get(remote.pdfUrl, ctx.signal, "application/pdf", actor);
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
    return { notes, tried: [] };
  }

  /** arXiv: the HTML version and the PDF. True when at least one of them is on the item. */
  private async fetchArxiv(
    ctx: JobContext,
    citekey: string,
    id: string,
    notes: string[],
  ): Promise<boolean> {
    const actor = ctx.job.by;
    const have = (url: string): boolean =>
      loadItem(this.lib, citekey).fm.sources.some((s) => s.url === url);
    const htmlUrl = `https://arxiv.org/html/${id}`;
    const pdfUrl = `https://arxiv.org/pdf/${id}`;
    let got = false;
    if (!have(htmlUrl)) {
      const html = await this.get(htmlUrl, ctx.signal, "text/html", actor);
      if (html && /html/i.test(html.contentType) && html.buf.length > 500) {
        this.addSource(actor, citekey, {
          buf: html.buf,
          kind: "arxiv-html",
          ext: "html",
          filename: `${slugFile(id)}.html`,
          url: htmlUrl,
        });
        got = true;
      } else notes.push("no arXiv HTML");
    } else got = true;
    ctx.progress(0.1);
    if (!have(pdfUrl)) {
      const pdf = await this.get(pdfUrl, ctx.signal, "application/pdf", actor);
      if (pdf && isPdf(pdf.buf)) {
        this.addSource(actor, citekey, {
          buf: pdf.buf,
          kind: "pdf",
          ext: "pdf",
          filename: `${slugFile(id)}.pdf`,
          url: pdfUrl,
        });
        got = true;
      } else notes.push("no arXiv PDF");
    } else got = true;
    return got;
  }

  /**
   * Full text for a work with a DOI. Collects every PDF address Unpaywall and OpenAlex name, orders
   * them (published version first, repositories before aggregators), tries up to MAX_CANDIDATES
   * of them, then arXiv, then the landing page of the publisher. The first file that is a PDF
   * wins. The log has one entry per address tried, so "no PDF location" only appears when a source
   * really named none. A failing source never stops the next one.
   */
  private async lookupFulltext(
    ctx: JobContext,
    citekey: string,
    doi: string,
    remote: RemotePlan,
  ): Promise<{ notes: string[]; tried: FulltextAttempt[] }> {
    const notes: string[] = [];
    const tried: FulltextAttempt[] = [];
    const actor = ctx.job.by;
    const seen = new Set<string>();
    let requests = 0;
    const guard = async <T>(source: FulltextAttempt["source"], run: () => Promise<T>) => {
      try {
        return await run();
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        tried.push({ source, outcome: "failed", detail: (err as Error).message });
        return undefined;
      }
    };
    const log = (
      source: FulltextAttempt["source"],
      outcome: FulltextAttempt["outcome"],
      url: string,
      what: string,
      by: string,
    ): void => {
      tried.push({
        source,
        outcome,
        url,
        detail: `${hostOf(url)}: ${what}${by ? ` (${by})` : ""}`,
      });
    };
    const save = (url: string, buf: Buffer): void => {
      this.addSource(actor, citekey, {
        buf,
        kind: "pdf",
        ext: "pdf",
        filename: `${citekey}.pdf`,
        url,
      });
    };

    /**
     * One address: a known repository rewrite first, then the address itself. A page that answers
     * with HTML is searched for a PDF link, which is tried once (level 1, no further pages).
     */
    const tryAddress = async (
      source: FulltextAttempt["source"],
      address: string,
      by: string,
      level: 0 | 1,
    ): Promise<boolean> => {
      const rewrite = rewriteRepositoryUrl(address);
      const targets = rewrite
        ? [
            { url: rewrite.url, by: `${by}; rewritten by ${rewrite.rule}` },
            { url: address, by },
          ]
        : [{ url: address, by }];
      for (const target of targets) {
        if (seen.has(target.url)) continue;
        if (requests >= MAX_REQUESTS) {
          log(source, "none", target.url, "skipped, request limit reached", target.by);
          continue;
        }
        seen.add(target.url);
        requests++;
        let res: Fetched;
        try {
          res = await this.fetchOnce(target.url, ctx.signal, ACCEPT_ANY, actor);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          log(source, "failed", target.url, (err as Error).message, target.by);
          continue;
        }
        if (res.kind === "status") {
          const blocked = res.status === 401 || res.status === 403;
          log(
            source,
            "none",
            target.url,
            blocked ? `blocked (HTTP ${res.status})` : `HTTP ${res.status}`,
            target.by,
          );
          continue;
        }
        if (res.kind === "large") {
          log(source, "none", target.url, "file too large", target.by);
          continue;
        }
        const kind = sniffContent(res.buf, res.contentType);
        if (kind === "pdf" && isPdf(res.buf)) {
          save(target.url, res.buf);
          log(source, "ok", target.url, "pdf", target.by);
          return true;
        }
        if (kind !== "html") {
          log(
            source,
            "none",
            target.url,
            `not a PDF (${res.contentType || "unknown type"})`,
            target.by,
          );
          continue;
        }
        const links =
          level === 0
            ? findPdfLinks(res.buf.toString("utf8"), res.url).filter((l) => !seen.has(l))
            : [];
        if (links.length === 0) {
          log(source, "none", target.url, "html-no-link", target.by);
          continue;
        }
        log(
          source,
          "none",
          target.url,
          `html, ${links.length} PDF link(s) found in the page`,
          target.by,
        );
        for (const link of links) {
          if (await tryAddress(source, link, `link in the page of ${hostOf(target.url)}`, 1)) {
            return true;
          }
        }
      }
      return false;
    };

    const resolver = this.deps.resolver;
    // 1. Unpaywall and OpenAlex name addresses. A resolver without the Unpaywall lookup hands over
    //    what the metadata cascade found.
    const named: { source: OpenAccessSource; locations: (string | PdfLocation)[] }[] = [];
    const unpaywall = await guard("unpaywall", async () => {
      if (!resolver.findOpenAccess) return remote.pdfUrl ? [remote.pdfUrl] : [];
      const oa = await resolver.findOpenAccess(doi);
      const all: (string | PdfLocation)[] = [...(oa?.pdfLocations ?? [])];
      if (oa?.pdfUrl && !all.some((l) => typeof l !== "string" && l.url === oa.pdfUrl)) {
        all.unshift(oa.pdfUrl);
      }
      return all;
    });
    if (unpaywall) {
      if (unpaywall.length === 0) {
        tried.push({ source: "unpaywall", outcome: "none", detail: "no PDF location" });
      }
      named.push({ source: "unpaywall", locations: unpaywall });
    }
    const alex = await guard("openalex", async () => resolver.findOpenAlexPdfs?.(doi) ?? []);
    if (alex) {
      if (alex.length === 0) {
        tried.push({ source: "openalex", outcome: "none", detail: "no PDF location" });
      }
      named.push({ source: "openalex", locations: alex });
    }
    const ordered = orderCandidates(mergeCandidates(named));
    const candidates: PdfCandidate[] = ordered.slice(0, MAX_CANDIDATES);
    for (const c of candidates) {
      const by = `named by ${c.sources.join(", ")}`;
      if (await tryAddress(c.sources[0] ?? "unpaywall", c.url, by, 0)) return { notes, tried };
    }
    for (const c of ordered.slice(MAX_CANDIDATES)) {
      tried.push({
        source: c.sources[0] ?? "unpaywall",
        outcome: "none",
        url: c.url,
        detail: `${hostOf(c.url)}: not tried, limit of ${MAX_CANDIDATES} locations reached`,
      });
    }
    // 2. arXiv.
    const arxiv = remote.arxiv ?? arxivFromDoi(doi);
    if (!arxiv) tried.push({ source: "arxiv", outcome: "none", detail: "no arXiv id" });
    else {
      const got = await guard("arxiv", () => this.fetchArxiv(ctx, citekey, arxiv, notes));
      if (got) {
        tried.push({ source: "arxiv", outcome: "ok", url: `https://arxiv.org/pdf/${arxiv}` });
        return { notes, tried };
      }
      if (got === false) tried.push({ source: "arxiv", outcome: "none", detail: notes.join("; ") });
    }
    // 3. The landing page of the publisher: PDF links it names (citation_pdf_url and the like).
    const landing = remote.landing ?? `https://doi.org/${doi}`;
    const page = await guard("publisher", async () => {
      requests++;
      const res = await this.fetchOnce(landing, ctx.signal, ACCEPT_ANY, actor);
      if (res.kind === "status") {
        const blocked = res.status === 401 || res.status === 403;
        log(
          "publisher",
          "none",
          landing,
          blocked ? `blocked (HTTP ${res.status})` : `HTTP ${res.status}`,
          "landing page",
        );
        return [];
      }
      if (res.kind === "large") {
        log("publisher", "none", landing, "file too large", "landing page");
        return [];
      }
      const kind = sniffContent(res.buf, res.contentType);
      if (kind === "pdf") return [res.url];
      const links = kind === "html" ? findPdfLinks(res.buf.toString("utf8"), res.url) : [];
      if (links.length === 0) {
        log(
          "publisher",
          "none",
          res.url,
          kind === "html" ? "html-no-link" : "not a PDF or a page",
          "landing page",
        );
      }
      return links;
    });
    for (const link of page ?? []) {
      if (seen.has(link)) {
        log("publisher", "none", link, "already tried", "landing page");
        continue;
      }
      if (await tryAddress("publisher", link, "link in the landing page", 1)) {
        return { notes, tried };
      }
    }
    notes.push(`no full text (tried ${tried.filter((t) => t.url).length} locations)`);
    return { notes, tried };
  }

  // Jobs ---------------------------------------------------------------------------------------

  private async runIngest(ctx: JobContext): Promise<unknown> {
    const input = ctx.job.input as { citekey: string; remote?: RemotePlan; convert?: boolean };
    const { citekey } = input;
    ctx.progress(0.05, "fetching sources");
    const { notes, tried } = await this.fetchSources(ctx, citekey, input.remote ?? {});
    const item = loadItem(this.lib, citekey);
    if (item.fm.sources.length === 0) {
      // Not a failure: the metadata is fine, the file is missing. The item says so and keeps
      // the record of where it looked, so that the user can attach a PDF.
      if (input.remote?.doi) {
        saveItem(this.lib, "system", item, {
          fulltext: { status: "missing", tried, checked_at: this.lib.stamp("system").at },
        });
      }
      return {
        citekey,
        sources: 0,
        converted: false,
        ...(input.remote?.doi ? { fulltext: "missing", tried } : {}),
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
    // The conversion may have renamed the item or merged it into one the library already had:
    // the result names the key that exists now, which items.add could not know at the time.
    const out = done.result as
      | {
          citekey?: string;
          renamed?: { from: string; to: string };
          merged?: { from: string; into: string; job: string };
        }
      | undefined;
    const finalKey = out?.citekey ?? citekey;
    return {
      citekey: finalKey,
      sources: item.fm.sources.length,
      converted: true,
      convertJob: child.id,
      ...(out?.renamed ? { renamed: out.renamed } : {}),
      ...(out?.merged ? { merged: out.merged } : {}),
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
    let merged: { from: string; into: string; job: string } | undefined;
    if (converted.length > 0) {
      const done = await this.afterConvert(ctx, citekey, converted);
      finalKey = done.citekey;
      renamed = done.renamed;
      merged = done.merged;
    }
    return {
      citekey: finalKey,
      converted,
      skipped: item.fm.sources.length - todo.length,
      failed,
      ...(renamed ? { renamed } : {}),
      ...(merged ? { merged } : {}),
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
  ): Promise<{
    citekey: string;
    renamed?: { from: string; to: string };
    merged?: { from: string; into: string; job: string; inInbox?: boolean };
  }> {
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
        if (res.applied === "duplicate" && res.duplicateOf) {
          const merged = this.mergeInto(actor, citekey, res.duplicateOf);
          if (merged) return { citekey: res.duplicateOf, merged };
        }
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
      if (now.fm.incomplete !== undefined || now.fm.fulltext !== undefined) {
        saveItem(this.lib, actor, now, { incomplete: undefined, fulltext: undefined });
      }
    } catch {
      // the item was removed in the meantime
    }
    return { citekey: key, ...(renamed ? { renamed } : {}) };
  }

  /**
   * The PDF of `from` turned out to be a work the library has already (`into`): moves the files
   * there, carries tags and projects over, queues the conversion for `into` and trashes the
   * empty item. Returns undefined, and changes nothing, when something refers to `from`.
   */
  private mergeInto(
    actor: Actor,
    from: string,
    into: string,
  ): { from: string; into: string; job: string; inInbox?: boolean } | undefined {
    if (from === into || isCited(this.lib, from)) return undefined;
    const source = loadItem(this.lib, from);
    const target = loadItem(this.lib, into);
    // A target without a working source gives its broken files up for the new one.
    if (this.needsRepair(into)) this.dropBrokenSources(into);
    let first: string | undefined;
    for (const s of source.fm.sources) {
      const ext = s.kind === "pdf" ? "pdf" : s.kind === "epub" ? "epub" : "html";
      const file = this.lib.paths.sourceFile(from, s.hash, ext);
      if (!existsSync(file)) continue;
      const have = loadItem(this.lib, into).fm.sources;
      const role = have.some((h) => h.kind === s.kind && h.role === "main") ? "supplement" : s.role;
      const added = this.addSource(
        actor,
        into,
        {
          buf: readFileSync(file),
          kind: s.kind,
          ext,
          filename: s.filename,
          ...(s.url ? { url: s.url } : {}),
        },
        role,
      );
      first ??= (added ?? have.find((h) => h.hash === s.hash))?.hash;
    }
    if (!first) return undefined;
    const fresh = loadItem(this.lib, into);
    const tags = [...new Set([...target.fm.tags, ...source.fm.tags])];
    const projects = [...new Set([...target.fm.projects, ...source.fm.projects])];
    saveItem(this.lib, actor, fresh, { tags, projects });
    const job = this.queue.enqueue({
      kind: "convert",
      by: actor,
      input: { citekey: into, source: first, force: true },
    });
    trashItem(this.lib, from, "system");
    return { from, into, job: job.id, ...(fresh.fm.inbox ? { inInbox: true } : {}) };
  }

  /**
   * items.merge: an inbox item is the same work as `into`. The sources of the inbox item move to
   * the target and are converted there, empty metadata is filled (see fillFromTwin), tags and
   * projects are united, and the inbox item goes to the trash, where items.restore finds it. A
   * finished job records the merge. Only a person merges: the target may be in the library.
   */
  mergeInboxItem(
    actor: Actor,
    from: string,
    into: string,
  ): { citekey: string; job: string; filled: string[]; moved: string[]; convert?: string } {
    if (actor !== "human" && actor !== "system") {
      throw problem(
        "MERGE_NOT_ALLOWED",
        `${actor} may not merge ${from} into ${into}`,
        "Ask the user to merge the two items in the app.",
        { from, into },
        "ask-human",
      );
    }
    if (from === into) {
      throw problem(
        "MERGE_SAME_ITEM",
        `${from} cannot be merged into itself`,
        "Pass two different citekeys.",
        { from, into },
      );
    }
    const source = loadItem(this.lib, from);
    loadItem(this.lib, into);
    if (!source.fm.inbox) {
      throw problem(
        "NOT_IN_INBOX",
        `item ${from} is in the library, not in the inbox, so it cannot be merged into ${into}`,
        "Only an item that waits in the inbox merges into another item. Use items.trash to remove an item from the library.",
        { citekey: from },
      );
    }
    if (isCited(this.lib, from)) {
      throw problem(
        "ITEM_REFERENCED",
        `${from} has quote cards or links that refer to it, so it cannot be merged away`,
        "Remove the cards or links first, or keep both items.",
        { citekey: from },
        "ask-human",
      );
    }
    const files = source.fm.sources.filter((s) =>
      existsSync(this.lib.paths.sourceFile(from, s.hash, sourceExt(s.kind))),
    );
    // A target without a working source gives its broken files up for the new ones.
    if (files.length > 0 && this.needsRepair(into)) this.dropBrokenSources(into);
    const moved: string[] = [];
    for (const s of files) {
      const have = loadItem(this.lib, into).fm.sources;
      const role = have.some((h) => h.kind === s.kind && h.role === "main") ? "supplement" : s.role;
      const added = this.addSource(
        actor,
        into,
        {
          buf: readFileSync(this.lib.paths.sourceFile(from, s.hash, sourceExt(s.kind))),
          kind: s.kind,
          ext: sourceExt(s.kind),
          filename: s.filename,
          ...(s.url ? { url: s.url } : {}),
        },
        role,
      );
      if (added) moved.push(added.hash);
    }
    const target = loadItem(this.lib, into);
    const today = this.lib.stamp(actor).at.slice(0, 10);
    const { patch, changed } = fillFromTwin(
      target.fm as unknown as Record<string, unknown>,
      source.fm as unknown as Record<string, unknown>,
      today,
    );
    saveItem(this.lib, actor, target, {
      ...patch,
      tags: [...new Set([...target.fm.tags, ...source.fm.tags])],
      projects: [...new Set([...target.fm.projects, ...source.fm.projects])],
    });
    const first = moved[0];
    const convert = first
      ? this.queue.enqueue({
          kind: "convert",
          by: actor,
          input: { citekey: into, source: first, force: true },
        }).id
      : undefined;
    const record = this.queue.enqueueFinished({
      kind: "ingest",
      by: actor,
      input: { merge: { from, into } },
      result: { citekey: into, merged: { from, into }, filled: changed, moved },
      message: `merged the inbox item ${from} into ${into}`,
    });
    trashItem(this.lib, from, actor);
    return {
      citekey: into,
      job: record.id,
      filled: changed,
      moved,
      ...(convert ? { convert } : {}),
    };
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
  restoreItem = (citekey: string) => {
    restoreItem(this.lib, citekey);
  };

  trashItem = (actor: Actor, citekey: string) => {
    assertMayTrash(this.lib, actor, citekey);
    trashItem(this.lib, citekey, actor);
  };
  acceptInbox = (actor: Actor, citekeys: string[]) => acceptInbox(this.lib, actor, citekeys);
  rejectInbox = (citekeys: string[], actor: Actor = "human") =>
    rejectInbox(this.lib, citekeys, actor);
}

export { citationPdfUrls } from "./fulltext.js";

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

import {
  Block,
  CardBody,
  CardFrontmatter,
  CardId,
  CardKind,
  Citekey,
  DerivedManifest,
  ItemFrontmatter,
  Job,
  JobId,
  Language,
  Link,
  Locator,
  NoteFrontmatter,
  NoteType,
  Pages,
  ProjectFrontmatter,
  ProjectSlug,
  Relation,
} from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";
import { ALERT_CONTRACTS } from "./alerts.js";
import { CHAT_CONTRACTS } from "./chat.js";
import { CONCEPT_CONTRACTS } from "./concepts.js";
import { GRAPH_CONTRACTS, RetractionSummary } from "./graph.js";
import { IMPORT_CONTRACTS } from "./import.js";
import { LITSEARCH_CONTRACTS } from "./litsearch.js";
import { MATRIX_CONTRACTS } from "./matrix.js";
import { PLANNING_CONTRACTS } from "./planning.js";
import { SYNC_CONTRACTS } from "./sync.js";
import { TEXTS_CONTRACTS } from "./texts.js";
import { USAGE_CONTRACTS } from "./usage.js";
import { DEFAULT_HOOKS_PORT, HooksPort, WEBHOOK_CONTRACTS } from "./webhooks.js";

const Paged = z.object({
  limit: z.number().int().positive().max(500).default(50),
  cursor: z.string().optional(),
});
const Scope = z.object({
  project: ProjectSlug.optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["unread", "reading", "read"]).optional(),
});
const ItemRef = z.object({ citekey: Citekey });
const Ok = z.object({ ok: z.literal(true) });
const JobHandle = z.object({ job: JobId });

const Card = z.object({ frontmatter: CardFrontmatter, body: CardBody });
const Note = z.object({ frontmatter: NoteFrontmatter, body: z.string(), path: z.string() });
const ItemSummary = z.object({
  citekey: Citekey,
  title: z.string(),
  year: z.string().optional(),
  authors: z.string().optional(),
  type: z.string(),
  status: z.string(),
  inbox: z.boolean(),
  /** Who added an inbox item and why (docs/decisions/0014-agent-content-goes-to-inbox.md). */
  inboxBy: z.string().optional(),
  inboxWhy: z.string().optional(),
  /** Projects the item belongs to. Absent when it belongs to none. */
  projects: z.array(ProjectSlug).optional(),
  /** Ingest did not finish: no working source. Retry, attach a file or trash the item. */
  incomplete: z.boolean().optional(),
  incompleteReason: z.string().optional(),
  /** Outcome of the full text lookup: "missing" shows as "ohne Volltext" in the library table. */
  fulltext: z.enum(["found", "missing"]).optional(),
  /** Set when items.checkRetractions found a retraction, withdrawal, concern or correction. */
  retraction: RetractionSummary.optional(),
});

export * from "./alerts.js";
export * from "./chat.js";
export * from "./concepts.js";
export * from "./graph.js";
export * from "./import.js";
export * from "./litsearch.js";
export * from "./matrix.js";
export * from "./planning.js";
export * from "./sync.js";
export * from "./texts.js";
export * from "./usage.js";
export * from "./webhooks.js";

// Library -----------------------------------------------------------------------------------------
export const libraryStatus = defineContract({
  name: "library.status",
  summary: "Library path, counts, index health and problems",
  access: "read",
  input: z.object({}),
  output: z.object({
    path: z.string(),
    items: z.number(),
    cards: z.number(),
    notes: z.number(),
    problems: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
    /** Library defaults from citegeist.json, e.g. the AI language used when nothing overrides it. */
    defaults: z
      .object({ ai_language: z.string(), style: z.string(), locale: z.string() })
      .optional(),
  }),
});
export const libraryReindex = defineContract({
  name: "library.reindex",
  summary: "Rebuild the local index from the library folder",
  access: "admin",
  input: z.object({}),
  output: JobHandle,
});

// Items ---------------------------------------------------------------------------------------------
export const itemsAdd = defineContract({
  name: "items.add",
  summary:
    "Add an item by DOI, arXiv ID, ISBN, PMID, URL, BibTeX snippet or local file path. To put an item that is already in the library into projects, pass its citekey and projects without an identifier: no new item is created and the projects are added to the item. A work the library has already (same DOI, ISBN, address or a confident title match with an item that lacks author or year) is not added twice: the existing item is returned as duplicateOf and takes over the metadata it lacked. To repair an item that arrived without authors or year, pass its citekey together with a DOI, ISBN, arXiv ID, PMID or URL: the identifier is added to that item and its metadata is looked up again (the fields that changed are in enriched)",
  access: "write",
  input: z
    .object({
      /** Required, except together with citekey and projects: then the item only joins the projects. */
      identifier: z.string().min(1).optional(),
      /**
       * Repair an existing item: the identifier is added to it and the metadata is looked up again,
       * instead of a new item. Use it for items that arrived without authors or year. Fields a
       * person or an agent edited are kept.
       */
      citekey: Citekey.optional(),
      projects: z.array(ProjectSlug).default([]),
      tags: z.array(z.string()).default([]),
      /** Agents land in the inbox unless they pass "library". Humans always land in the library. */
      target: z.enum(["inbox", "library"]).default("inbox"),
      why: z.string().optional(),
    })
    .refine(
      (v) => v.identifier !== undefined || (v.citekey !== undefined && v.projects.length > 0),
      {
        path: ["identifier"],
        message:
          "identifier is required, except together with a citekey and projects (which puts that item into the projects)",
      },
    ),
  output: z.object({
    /**
     * The item the input belongs to. When the library already has the work and the match is
     * certain at once (DOI, arXiv id, ISBN, PMID or URL, also one found inside a PDF), this is the
     * existing citekey and `duplicateOf` repeats it. A PDF that is only recognised after the
     * conversion (GROBID header, title match) starts as a new item; the ingest job result then
     * names the final citekey (`citekey`, with `merged` or `renamed`).
     */
    citekey: Citekey,
    job: JobId,
    duplicateOf: Citekey.optional(),
    /** True when the matched item had no working source and the new file or download repairs it. */
    repaired: z.boolean().optional(),
    /** Fields of the existing item that the identifier filled or corrected. */
    enriched: z.array(z.string()).optional(),
    /**
     * The item had a placeholder citekey (such as anonnd...) and now has author and year. This is
     * the key the citekey formula would give it. Nothing was renamed; items.rename does it.
     */
    suggestedCitekey: Citekey.optional(),
  }),
  cliPositional: "identifier",
  mcp: { tool: "add_item", readOnly: false },
});
export const itemsAttach = defineContract({
  name: "items.attach",
  summary:
    "Attach a local file (PDF, HTML page or EPUB) to an existing item and convert it; a file the item already has is not added twice",
  access: "write",
  input: ItemRef.extend({
    /** Absolute path of the file. It is copied into the item, so the original can be deleted. */
    path: z.string().min(1),
    /** Where the file came from, such as the page the browser saved it from. */
    url: z.string().optional(),
    /** Name to show for the file. Default: the file name. */
    filename: z.string().min(1).optional(),
  }),
  output: z.object({
    citekey: Citekey,
    /** Hash that names the file among the item's sources. */
    source: z.string(),
    /** False when the item already had this file. */
    added: z.boolean(),
    /** Conversion of the new file. Absent when nothing was added. */
    job: JobId.optional(),
  }),
  mcp: { tool: "attach_file", readOnly: false },
});
export const itemsGet = defineContract({
  name: "items.get",
  summary: "Metadata, sources, literature note and card count of one item",
  access: "read",
  input: ItemRef,
  output: z.object({
    frontmatter: ItemFrontmatter,
    note: z.string(),
    cards: z.number(),
    path: z.string(),
  }),
  mcp: { tool: "get_item", readOnly: true },
});
export const itemsList = defineContract({
  name: "items.list",
  summary: "List items in a scope",
  access: "read",
  input: Scope.extend({ inbox: z.boolean().optional() }).merge(Paged),
  output: z.object({ items: z.array(ItemSummary), next: z.string().optional() }),
});
export const itemsUpdate = defineContract({
  name: "items.update",
  summary: "Update metadata fields, tags, projects, status or AI language of an item",
  access: "write",
  input: ItemRef.extend({ patch: z.record(z.string(), z.unknown()) }),
  output: z.object({
    frontmatter: ItemFrontmatter,
    /**
     * Set when the item's citekey was a placeholder (such as anonnd...) and the patch gave it an
     * author and a year. The key the citekey formula would give it now; items.rename applies it.
     */
    suggestedCitekey: Citekey.optional(),
  }),
});
export const itemsResolve = defineContract({
  name: "items.resolve",
  summary:
    "Look the metadata of an item up again from its DOI, arXiv id, ISBN, PMID or URL (title as a last resort) and merge the answer into the item. With identifier, the item first gets that DOI, ISBN, arXiv id, PMID or URL and is looked up with it; nothing is stored when the lookup fails. Fields that a person or an agent edited are kept; fields from earlier lookups or guesses are replaced. Returns the names of the fields that changed.",
  access: "write",
  input: ItemRef.extend({
    /** A DOI, arXiv id, ISBN, PMID or a URL (also one that contains a DOI) to add to the item. */
    identifier: z.string().min(1).optional(),
  }),
  output: z.object({
    citekey: Citekey,
    changed: z.array(z.string()),
    /** The citekey was a placeholder and the item now has author and year. See items.update. */
    suggestedCitekey: Citekey.optional(),
  }),
});
export const itemsRename = defineContract({
  name: "items.rename",
  summary: "Change a citekey and rewrite every link to it",
  access: "write",
  input: ItemRef.extend({ to: Citekey }),
  output: z.object({ rewritten: z.number() }),
});
export const itemsTrash = defineContract({
  name: "items.trash",
  summary:
    "Move an item to the trash. An agent may trash inbox items, incomplete items and items an agent added, as long as no card or link refers to them; the folder stays in the library trash and records who removed it",
  access: "write",
  input: ItemRef,
  output: Ok,
  mcp: { tool: "trash_item", readOnly: false },
});
export const itemsRestore = defineContract({
  name: "items.restore",
  summary:
    "Put the most recently trashed item with this citekey back into the library, for example right after items.trash. Fails when the citekey is in use again",
  access: "write",
  input: ItemRef,
  output: Ok,
});
export const inboxAccept = defineContract({
  name: "inbox.accept",
  summary: "Move inbox items into the library",
  access: "write",
  input: z.object({ citekeys: z.array(Citekey).min(1) }),
  output: Ok,
});
export const inboxReject = defineContract({
  name: "inbox.reject",
  summary: "Discard inbox items",
  access: "write",
  input: z.object({ citekeys: z.array(Citekey).min(1) }),
  output: Ok,
});

// Documents -----------------------------------------------------------------------------------------
export const documentsRead = defineContract({
  name: "documents.read",
  summary: "Read an item's converted text as Markdown, by printed page range, section or block ids",
  access: "read",
  input: ItemRef.extend({
    pages: z.string().optional(),
    section: z.string().optional(),
    blocks: z.array(z.string()).optional(),
    maxChars: z.number().int().positive().default(20000),
  }),
  output: z.object({
    markdown: z.string(),
    truncated: z.boolean(),
    manifest: DerivedManifest.optional(),
  }),
  mcp: { tool: "read_document", readOnly: true },
});
export const documentsConvert = defineContract({
  name: "documents.convert",
  summary: "(Re)convert an item's sources",
  access: "write",
  input: ItemRef.extend({ force: z.boolean().default(false) }),
  output: JobHandle,
});
export const documentsConfirmPages = defineContract({
  name: "documents.confirmPages",
  summary:
    "Confirm or correct the printed page label mapping of a PDF with an offset or explicit labels",
  access: "write",
  input: ItemRef.extend({
    source: z.string(),
    offset: z.number().int().optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  output: z.object({ cardsUpdated: z.number() }),
});

export const documentsAssets = defineContract({
  name: "documents.assets",
  summary: "Everything the reader needs for one source: PDF URL, reader HTML, blocks and pages",
  access: "read",
  input: ItemRef.extend({ source: z.string().optional() }),
  output: z.object({
    source: z.string(),
    kind: z.string(),
    /** Path on the core's HTTP server, e.g. /files/<citekey>/sources/<hash>.pdf; needs the session token. */
    pdfUrl: z.string().optional(),
    html: z.string().optional(),
    blocks: z.array(Block).default([]),
    pages: Pages.optional(),
    /**
     * False for a source without printed pages and PDF pages (web, HTML, EPUB). Cards of such a
     * source carry a paragraph locator, and the reader shows no page number check.
     */
    paginated: z.boolean().default(true),
  }),
});

// Cards ---------------------------------------------------------------------------------------------
export const cardsCreate = defineContract({
  name: "cards.create",
  summary:
    "Create a quote card from an anchored selection; the AI paraphrase and kind follow asynchronously",
  access: "write",
  input: z.object({
    citekey: Citekey,
    anchor: CardFrontmatter.shape.anchor,
    quote: z.string().min(1),
    kind: CardKind.optional(),
    ai: z.boolean().default(true),
    language: Language.optional(),
    projects: z.array(ProjectSlug).default([]),
    tags: z.array(z.string()).default([]),
  }),
  output: z.object({ card: Card, job: JobId.optional() }),
  mcp: { tool: "create_card", readOnly: false },
});
export const cardsUpdate = defineContract({
  name: "cards.update",
  summary: "Edit note, paraphrase, kind, tags or locator of a card (never the quote)",
  access: "write",
  input: z.object({
    id: CardFrontmatter.shape.id,
    // Loose, so a "quote" key reaches the handler, which rejects it with CARD_QUOTE_IMMUTABLE.
    patch: CardBody.omit({ quote: true, core: true })
      .partial()
      .extend({
        /** null clears the kind. */
        kind: CardKind.nullable().optional(),
        tags: z.array(z.string()).optional(),
        locator: Locator.partial().optional(),
      })
      .loose(),
  }),
  output: z.object({ card: Card }),
});
export const cardsList = defineContract({
  name: "cards.list",
  summary: "List quote cards by item, project, tag or text",
  access: "read",
  input: Scope.extend({
    citekey: Citekey.optional(),
    query: z.string().optional(),
    kind: CardKind.optional(),
  }).merge(Paged),
  output: z.object({ cards: z.array(Card), next: z.string().optional() }),
  mcp: { tool: "list_cards", readOnly: true },
});
export const cardsRegenerate = defineContract({
  name: "cards.regenerate",
  summary: "Rewrite the AI paraphrase, optionally in another language",
  access: "write",
  input: z.object({ id: CardFrontmatter.shape.id, language: Language.optional() }),
  output: JobHandle,
});
export const cardsExport = defineContract({
  name: "cards.export",
  summary:
    "Render cards as direct citations, indirect citations or citations alone (cite) for the clipboard or a document",
  access: "read",
  input: z.object({
    ids: z.array(CardFrontmatter.shape.id).min(1),
    mode: z.enum(["direct", "indirect", "cite"]).default("direct"),
    format: z.enum(["html", "text", "pandoc", "latex", "typst"]).default("html"),
    project: ProjectSlug.optional(),
    /** Locale of the quote marks, locator terms and style; defaults to the project's, else the library's. */
    locale: z.string().optional(),
  }),
  output: z.object({ html: z.string().optional(), text: z.string() }),
});

// Notes and links -----------------------------------------------------------------------------------
export const notesCreate = defineContract({
  name: "notes.create",
  summary: "Create a note; wiki links in the body are resolved and indexed",
  access: "write",
  input: z.object({
    title: z.string().min(1),
    body: z.string().default(""),
    type: NoteFrontmatter.shape.type,
    projects: z.array(ProjectSlug).default([]),
  }),
  output: Note,
  mcp: { tool: "create_note", readOnly: false },
});
export const notesUpdate = defineContract({
  name: "notes.update",
  summary:
    "Replace a note's body, title, type, tags or projects; a new title renames the file and rewrites the wiki links to it",
  access: "write",
  input: z.object({
    id: NoteFrontmatter.shape.id,
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    // NoteType, not NoteFrontmatter.shape.type: that one carries a default and would reset the type.
    type: NoteType.optional(),
    tags: z.array(z.string()).optional(),
    projects: z.array(ProjectSlug).optional(),
  }),
  output: Note,
});
export const notesTrash = defineContract({
  name: "notes.trash",
  summary:
    "Move a note to the library trash. An agent may only trash notes an agent created; the file stays in the library trash and records who removed it. Wiki links to the note stay in place",
  access: "write",
  input: z.object({ id: NoteFrontmatter.shape.id }),
  output: Ok,
});
export const notesRestore = defineContract({
  name: "notes.restore",
  summary:
    "Put the most recently trashed note with this id back where it was, for example right after notes.trash. Fails when its file name is in use again",
  access: "write",
  input: z.object({ id: NoteFrontmatter.shape.id }),
  output: Note,
});
export const notesGet = defineContract({
  name: "notes.get",
  summary: "Read a note",
  access: "read",
  input: z.object({ id: NoteFrontmatter.shape.id }),
  output: Note,
});
/** One note in the notes list. */
export const NoteSummary = z.object({
  id: NoteFrontmatter.shape.id,
  /** File name without .md; the target of `[[...]]` links, as in an Obsidian vault. */
  slug: z.string(),
  title: z.string(),
  type: NoteFrontmatter.shape.type,
  created: z.string(),
  modified: z.string().optional(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
});
export type NoteSummary = z.infer<typeof NoteSummary>;
export const notesList = defineContract({
  name: "notes.list",
  summary: "List notes, newest change first, optionally filtered by a title substring or project",
  access: "read",
  input: z.object({
    query: z.string().optional(),
    project: z.string().optional(),
    limit: z.number().int().positive().max(500).default(200),
  }),
  output: z.object({ notes: z.array(NoteSummary) }),
});
/** A note, card or item that links to a note. */
export const Backlink = z.object({
  /** What links here. */
  kind: z.enum(["item", "card", "note"]),
  /** Citekey, card id or note id. */
  id: z.string(),
  /** Citekey of the item a card belongs to; the route to a card goes through it. */
  citekey: z.string().optional(),
  title: z.string(),
  /** Type of a typed link from the frontmatter; absent for plain wiki links. */
  rel: z.string().optional(),
  status: z.enum(["proposed", "accepted"]),
  origin: z.enum(["wiki", "frontmatter"]),
});
export type Backlink = z.infer<typeof Backlink>;
export const notesBacklinks = defineContract({
  name: "notes.backlinks",
  summary: "Everything that links to a note: wiki links and typed links from notes, items, cards",
  access: "read",
  input: z.object({ id: NoteFrontmatter.shape.id }),
  output: z.object({ backlinks: z.array(Backlink) }),
});
/** Where a typed link starts: a note, or a quote card (the link is then stored in the item's literature note). */
const LinkOrigin = z.union([NoteFrontmatter.shape.id, CardId]);
export const linksCreate = defineContract({
  name: "links.create",
  summary:
    "Add a typed link from a note or from a quote card to an item, card or note. `from` is a note id (n_...) or a card id (c_...). A link from a card is stored in the literature note of the card's item, with the card as evidence. Relations: supports, opposes (contradicts), qualifies, addresses, extends, uses-method-of, uses-data-from, elaborates, related",
  access: "write",
  input: z.object({ from: LinkOrigin, link: Link.omit({ by: true, from: true }) }),
  output: Note,
  mcp: { tool: "link", readOnly: false },
});
export const linksRemove = defineContract({
  name: "links.remove",
  summary:
    "Remove the typed link from a note or a quote card to a target; without rel every relation to that target goes",
  access: "write",
  input: z.object({ from: LinkOrigin, to: z.string().min(1), rel: Relation.optional() }),
  output: Note,
});
/** A typed link that starts at a card, with where it is stored. */
export const CardLink = z.object({
  /** The card the link starts at. */
  card: CardId,
  /** Note that holds the link (the literature note of the card's item). */
  note: NoteFrontmatter.shape.id,
  /** Position in the frontmatter `links` of that note; `links.decide` takes it. */
  index: z.number().int().nonnegative(),
  to: z.string(),
  kind: z.enum(["item", "card", "note"]),
  /** Title of the item or note, or the start of the card quote. */
  label: z.string(),
  /** Short form such as "Land 2012" for an item. */
  short: z.string(),
  /** Citekey of the target item, or of the item a target card belongs to. */
  citekey: Citekey.optional(),
  rel: Relation.optional(),
  why: z.string().optional(),
  by: z.string(),
  /** "proposed" is a suggestion the user has not decided yet. Rejected links are not listed. */
  status: z.enum(["proposed", "accepted"]),
});
export type CardLink = z.infer<typeof CardLink>;
export const linksForCard = defineContract({
  name: "links.forCard",
  summary:
    "The typed links that start at a quote card, including suggestions that await a decision",
  access: "read",
  input: z.object({ card: CardId }),
  output: z.object({ links: z.array(CardLink) }),
});
export const linksForItem = defineContract({
  name: "links.forItem",
  summary: "The typed links that start at the quote cards of one item",
  access: "read",
  input: z.object({ citekey: Citekey }),
  output: z.object({ links: z.array(CardLink) }),
});
export const linksSuggest = defineContract({
  name: "links.suggest",
  summary:
    "Let the AI suggest up to two typed links from a quote card to sources of the library that its text names. Suggestions are stored as proposed and need the user's decision",
  access: "write",
  input: z.object({ card: CardId }),
  output: JobHandle,
});
export const linksPropose = defineContract({
  name: "links.propose",
  summary: "Let the AI propose typed links for a note",
  access: "write",
  input: z.object({ note: NoteFrontmatter.shape.id }),
  output: JobHandle,
});
export const linksDecide = defineContract({
  name: "links.decide",
  summary: "Accept or reject proposed links",
  access: "write",
  input: z.object({
    note: NoteFrontmatter.shape.id,
    accept: z.array(z.number().int()),
    reject: z.array(z.number().int()),
  }),
  output: Note,
});
export const graphNeighbors = defineContract({
  name: "graph.neighbors",
  summary: "Typed neighbors of an item, card or note up to a depth",
  access: "read",
  input: z.object({
    node: z.string(),
    depth: z.number().int().min(1).max(3).default(1),
    rel: z.array(Relation).optional(),
  }),
  output: z.object({
    nodes: z.array(
      z.object({ id: z.string(), kind: z.enum(["item", "card", "note"]), label: z.string() }),
    ),
    edges: z.array(
      z.object({ from: z.string(), to: z.string(), rel: z.string(), status: z.string() }),
    ),
  }),
});

// Projects ------------------------------------------------------------------------------------------
export const projectsCreate = defineContract({
  name: "projects.create",
  summary: "Create a project with a brief",
  access: "write",
  input: z.object({ slug: ProjectSlug, title: z.string().min(1), brief: z.string().default("") }),
  output: z.object({ frontmatter: ProjectFrontmatter, brief: z.string() }),
  mcp: { tool: "create_project", readOnly: false },
});
export const projectsGet = defineContract({
  name: "projects.get",
  summary: "Project brief, research questions, settings and item count",
  access: "read",
  input: z.object({ slug: ProjectSlug }),
  output: z.object({ frontmatter: ProjectFrontmatter, brief: z.string(), items: z.number() }),
});
export const projectsUpdate = defineContract({
  name: "projects.update",
  summary: "Update a project's brief, questions or settings",
  access: "write",
  input: z.object({
    slug: ProjectSlug,
    patch: z.record(z.string(), z.unknown()),
    brief: z.string().optional(),
  }),
  output: z.object({ frontmatter: ProjectFrontmatter, brief: z.string() }),
});
export const projectsAddItems = defineContract({
  name: "projects.addItems",
  summary:
    "Add library items to a project in one call (the project is written into each item's frontmatter). Items that are in the project already are left alone, so the call can be repeated. Fails before any change when the project or a citekey does not exist",
  access: "write",
  input: z.object({ slug: ProjectSlug, citekeys: z.array(Citekey).min(1).max(500) }),
  output: z.object({ added: z.array(Citekey), unchanged: z.array(Citekey) }),
});
export const projectsRemoveItems = defineContract({
  name: "projects.removeItems",
  summary:
    "Remove items from a project in one call. The items stay in the library. Items that are not in the project are left alone. Fails before any change when the project or a citekey does not exist",
  access: "write",
  input: z.object({ slug: ProjectSlug, citekeys: z.array(Citekey).min(1).max(500) }),
  output: z.object({ removed: z.array(Citekey), unchanged: z.array(Citekey) }),
});
export const projectsList = defineContract({
  name: "projects.list",
  summary: "List projects",
  access: "read",
  input: z.object({}),
  output: z.object({ projects: z.array(ProjectFrontmatter) }),
  mcp: { tool: "list_projects", readOnly: true, idempotent: true },
});

// Search and citations ------------------------------------------------------------------------------
export const searchQuery = defineContract({
  name: "search.query",
  summary:
    "Hybrid full-text and semantic search over items, cards, notes and document text in a scope",
  access: "read",
  input: Scope.extend({
    q: z.string().min(1),
    kinds: z
      .array(z.enum(["item", "card", "note", "block"]))
      .default(["item", "card", "note", "block"]),
    limit: z.number().int().positive().max(100).default(20),
  }),
  output: z.object({
    hits: z.array(
      z.object({
        kind: z.enum(["item", "card", "note", "block"]),
        id: z.string(),
        citekey: Citekey.optional(),
        title: z.string(),
        snippet: z.string(),
        page: z.string().optional(),
        score: z.number(),
      }),
    ),
  }),
  mcp: { tool: "search", readOnly: true },
});
export const citeFormat = defineContract({
  name: "cite.format",
  summary: "Format citations or a bibliography in a CSL style, with locators",
  access: "read",
  input: z.object({
    items: z
      .array(
        z.object({
          citekey: Citekey,
          locator: z.string().optional(),
          label: z.string().optional(),
          prefix: z.string().optional(),
        }),
      )
      .min(1),
    mode: z.enum(["citation", "bibliography"]).default("citation"),
    style: z.string().optional(),
    locale: z.string().optional(),
    project: ProjectSlug.optional(),
    format: z.enum(["text", "html", "pandoc", "bibtex", "csl-json"]).default("text"),
  }),
  output: z.object({ text: z.string(), html: z.string().optional() }),
  mcp: { tool: "cite", readOnly: true },
});

// Jobs and AI -----------------------------------------------------------------------------------------
export const jobsGet = defineContract({
  name: "jobs.get",
  summary: "Status, progress and result of a background job",
  access: "read",
  input: z.object({ job: JobId }),
  output: Job,
  mcp: { tool: "jobs_get", readOnly: true, idempotent: true },
});
export const jobsList = defineContract({
  name: "jobs.list",
  summary: "Recent and running jobs",
  access: "read",
  input: z.object({ status: Job.shape.status.optional() }).merge(Paged),
  output: z.object({ jobs: z.array(Job), next: z.string().optional() }),
});
export const researchStart = defineContract({
  name: "research.start",
  summary: "Start an agent research job; found papers land in the inbox with a reason",
  access: "write",
  input: z.object({
    prompt: z.string().min(1),
    project: ProjectSlug.optional(),
    backend: z.string().optional(),
    maxItems: z.number().int().positive().max(50).default(10),
  }),
  output: JobHandle,
});

// Settings and setup ----------------------------------------------------------------------------------
const BackendStatus = z.object({
  id: z.string(),
  kind: z.enum(["subscription-cli", "api-key", "local"]),
  label: z.string(),
  available: z.boolean(),
  detail: z.string().optional(),
  /** Set while the router skips this backend after a limit, an overload or a login problem. */
  paused: z
    .object({
      kind: z.enum(["limit", "overloaded", "auth"]),
      /** ISO time at which the router tries the backend again. */
      until: z.string(),
    })
    .optional(),
  /** A missing or logged-out CLI: the agent-ready error whose `fix` names the install and login commands. */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      fix: z.string(),
      recovery: z.string(),
    })
    .optional(),
});
/** Port of the Zotero Connector listener unless the user picks another one. */
export const DEFAULT_CONNECTOR_PORT = 23119;
const ConnectorPort = z.number().int().min(1024).max(65535);
/** The embedding models semantic search can use. The first one is the default. */
export const EMBEDDING_MODEL_KEYS = ["embeddinggemma-300m", "qwen3-embedding-0.6b"] as const;
export const EmbeddingModelKey = z.enum(EMBEDDING_MODEL_KEYS);
export type EmbeddingModelKey = z.infer<typeof EmbeddingModelKey>;

/** Limits of a research job. Zero switches a limit off. */
export const DEFAULT_RESEARCH_LIMITS = {
  maxMinutes: 20,
  maxTokens: 2_000_000,
  maxToolCalls: 200,
} as const;
const ResearchLimits = z.object({
  /** Wall-clock time of one job in minutes. */
  maxMinutes: z.number().int().min(0).max(1440).default(DEFAULT_RESEARCH_LIMITS.maxMinutes),
  /** Tokens an agent may add to its context during one job, where the agent reports them. */
  maxTokens: z.number().int().min(0).default(DEFAULT_RESEARCH_LIMITS.maxTokens),
  /** Tool calls of one job. */
  maxToolCalls: z.number().int().min(0).default(DEFAULT_RESEARCH_LIMITS.maxToolCalls),
});

export const Settings = z.object({
  ai: z.object({
    /** Task id or `"*"` to a backend id. The `"*"` entry is the default for every AI task. */
    routing: z.record(z.string(), z.string()),
    /**
     * Backend ids the router tries, in this order, when the routed backend hits its usage limit,
     * is overloaded or is logged out. Unset means the default order: the subscription CLIs, then
     * the API-key backends, never Ollama. An empty list switches the fallback off.
     */
    fallback: z.array(z.string()).optional(),
    apiKeys: z.record(z.string(), z.boolean()).default({}),
  }),
  mailto: z.string().optional(),
  /** Address sent to Unpaywall. Without one, the contact address is used. */
  unpaywallEmail: z.string().optional(),
  /** `tool` parameter of NCBI E-utilities calls. Default "citegeist". The NCBI key is the API key slot "ncbi". */
  ncbiTool: z.string().optional(),
  /** Chosen by the user. Unset until then, and the UI follows the system language. */
  uiLanguage: z.enum(["de", "en"]).optional(),
  /**
   * Semantic search with a local embedding model. Off until the user turns it on. `rerank` adds a
   * local cross-encoder that re-sorts the best hits: slower (about a second per search) and a
   * download of about 570 MB, so it is off by default (numbers in docs/decisions/0026-retrieval-benchmark.md).
   */
  semantic: z
    .object({
      enabled: z.boolean().default(false),
      model: EmbeddingModelKey.optional(),
      rerank: z.boolean().default(false),
    })
    .default({ enabled: false, rerank: false }),
  /** Listener on 127.0.0.1 that lets the Zotero Connector browser extension save into citegeist. */
  connector: z
    .object({
      enabled: z.boolean().default(false),
      port: ConnectorPort.default(DEFAULT_CONNECTOR_PORT),
    })
    .default({ enabled: false, port: DEFAULT_CONNECTOR_PORT }),
  /**
   * Webhooks for external agents. A listener on 127.0.0.1:`port` serves only /hooks/ (the tunnel
   * points there) while at least one connector exists. `publicUrl` is the address of the tunnel;
   * the CITEGEIST_PUBLIC_URL variable overrides it.
   */
  webhooks: z
    .object({
      port: HooksPort.default(DEFAULT_HOOKS_PORT),
      publicUrl: z.string().optional(),
    })
    .default({ port: DEFAULT_HOOKS_PORT }),
  /**
   * Chat agents run in the user's own environment (shell, the user's MCP servers and
   * settings) unless this is on. "Isolierter Agent" restores the sandbox: no shell, no user
   * settings, only the citegeist tools.
   */
  chat: z.object({ isolated: z.boolean().default(false) }).default({ isolated: false }),
  /** Limits of research jobs: time, tokens and tool calls. A loop of identical calls always ends a job. */
  research: ResearchLimits.default({ ...DEFAULT_RESEARCH_LIMITS }),
});
/** Where the embedding model stands. `progress` (0 to 1) is set while the files download. */
export const SemanticStatus = z.object({
  state: z.enum(["off", "downloading", "ready", "error"]),
  model: z.string(),
  progress: z.number().min(0).max(1).optional(),
  detail: z.string().optional(),
  /** Reranker, when `semantic.rerank` is on: "loading" while its files download. */
  rerank: z.enum(["loading", "ready", "error"]).optional(),
  rerankDetail: z.string().optional(),
});
export const ConnectorStatus = z.object({
  state: z.enum(["off", "listening", "error"]),
  port: z.number().optional(),
  detail: z.string().optional(),
});
export const settingsGet = defineContract({
  name: "settings.get",
  summary: "Machine-local settings, available AI backends and worker status",
  access: "read",
  input: z.object({}),
  output: z.object({
    settings: Settings,
    backends: z.array(BackendStatus),
    worker: z.object({
      ready: z.boolean(),
      engines: z.record(z.string(), z.string()),
      detail: z.string().optional(),
    }),
    semantic: SemanticStatus.optional(),
    connector: ConnectorStatus.optional(),
  }),
});
export const settingsUpdate = defineContract({
  name: "settings.update",
  summary:
    "Change routing, contact address, metadata source settings, UI language, semantic search or the connector; API keys (including the NCBI key) go to the Keychain",
  access: "admin",
  input: z.object({
    // Explicit optional fields: Settings.partial() would re-apply defaults and reset uiLanguage.
    patch: z.object({
      ai: z
        .object({
          routing: z.record(z.string(), z.string()).optional(),
          fallback: z.array(z.string()).optional(),
          apiKeys: z.record(z.string(), z.boolean()).optional(),
        })
        .optional(),
      mailto: z.string().optional(),
      unpaywallEmail: z.string().optional(),
      ncbiTool: z.string().optional(),
      uiLanguage: z.enum(["de", "en"]).optional(),
      semantic: z
        .object({
          enabled: z.boolean().optional(),
          model: EmbeddingModelKey.optional(),
          rerank: z.boolean().optional(),
        })
        .optional(),
      connector: z
        .object({ enabled: z.boolean().optional(), port: ConnectorPort.optional() })
        .optional(),
      webhooks: z
        .object({
          port: HooksPort.optional(),
          /** An empty string removes the setting. */
          publicUrl: z.string().optional(),
        })
        .optional(),
      chat: z.object({ isolated: z.boolean().optional() }).optional(),
      research: z
        .object({
          maxMinutes: z.number().int().min(0).max(1440).optional(),
          maxTokens: z.number().int().min(0).optional(),
          maxToolCalls: z.number().int().min(0).optional(),
        })
        .optional(),
    }),
    apiKey: z.object({ provider: z.string(), key: z.string().min(1) }).optional(),
  }),
  output: z.object({ settings: Settings }),
});
export const aiTestBackend = defineContract({
  name: "ai.testBackend",
  summary: "Run one short paraphrase on a backend and report latency or the error",
  access: "admin",
  input: z.object({ backend: z.string() }),
  output: z.object({
    ok: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.object({ code: z.string(), message: z.string(), fix: z.string() }).optional(),
  }),
});
export const workerSetup = defineContract({
  name: "worker.setup",
  summary: "Install or update the Python conversion environment and models",
  access: "admin",
  input: z.object({ force: z.boolean().default(false) }),
  output: JobHandle,
});

export const CONTRACTS: readonly OperationContract[] = [
  libraryStatus,
  libraryReindex,
  itemsAdd,
  itemsAttach,
  itemsGet,
  itemsList,
  itemsUpdate,
  itemsResolve,
  itemsRename,
  itemsTrash,
  itemsRestore,
  inboxAccept,
  inboxReject,
  documentsRead,
  documentsConvert,
  documentsConfirmPages,
  documentsAssets,
  cardsCreate,
  cardsUpdate,
  cardsList,
  cardsRegenerate,
  cardsExport,
  notesCreate,
  notesUpdate,
  notesTrash,
  notesRestore,
  notesGet,
  notesList,
  notesBacklinks,
  linksCreate,
  linksRemove,
  linksForCard,
  linksForItem,
  linksSuggest,
  linksPropose,
  linksDecide,
  graphNeighbors,
  projectsCreate,
  projectsGet,
  projectsUpdate,
  projectsAddItems,
  projectsRemoveItems,
  projectsList,
  searchQuery,
  citeFormat,
  jobsGet,
  jobsList,
  researchStart,
  settingsGet,
  settingsUpdate,
  aiTestBackend,
  workerSetup,
  ...CHAT_CONTRACTS,
  ...CONCEPT_CONTRACTS,
  ...IMPORT_CONTRACTS,
  ...LITSEARCH_CONTRACTS,
  ...MATRIX_CONTRACTS,
  ...PLANNING_CONTRACTS,
  ...SYNC_CONTRACTS,
  ...TEXTS_CONTRACTS,
  ...USAGE_CONTRACTS,
  ...GRAPH_CONTRACTS,
  ...WEBHOOK_CONTRACTS,
  ...ALERT_CONTRACTS,
];

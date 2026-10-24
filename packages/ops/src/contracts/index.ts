import {
  Block,
  CardBody,
  CardFrontmatter,
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
import { CHAT_CONTRACTS } from "./chat.js";
import { PLANNING_CONTRACTS } from "./planning.js";

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
  /** Who added an inbox item and why (D7). */
  inboxBy: z.string().optional(),
  inboxWhy: z.string().optional(),
});

export * from "./chat.js";
export * from "./planning.js";

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
  summary: "Add an item by DOI, arXiv ID, ISBN, PMID, URL, BibTeX snippet or local file path",
  access: "write",
  input: z.object({
    identifier: z.string().min(1),
    projects: z.array(ProjectSlug).default([]),
    tags: z.array(z.string()).default([]),
    /** D7: agents land in the inbox unless they pass "library". Humans always land in the library. */
    target: z.enum(["inbox", "library"]).default("inbox"),
    why: z.string().optional(),
  }),
  output: z.object({ citekey: Citekey, job: JobId, duplicateOf: Citekey.optional() }),
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
  output: z.object({ frontmatter: ItemFrontmatter }),
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
  summary: "Move an item to the trash",
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
  }),
});

// Cards ---------------------------------------------------------------------------------------------
export const cardsCreate = defineContract({
  name: "cards.create",
  summary:
    "Create a quote card from an anchored selection; AI paraphrase and core statement follow asynchronously",
  access: "write",
  input: z.object({
    citekey: Citekey,
    anchor: CardFrontmatter.shape.anchor,
    quote: z.string().min(1),
    kind: CardKind.default("quote"),
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
  summary: "Edit own words, comment, kind, tags or locator of a card (never the quote)",
  access: "write",
  input: z.object({
    id: CardFrontmatter.shape.id,
    // Loose, so a "quote" key reaches the handler, which rejects it with CARD_QUOTE_IMMUTABLE.
    patch: CardBody.omit({ quote: true })
      .partial()
      .extend({
        kind: CardKind.optional(),
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
  summary: "Rewrite the AI paraphrase and core statement, optionally in another language",
  access: "write",
  input: z.object({ id: CardFrontmatter.shape.id, language: Language.optional() }),
  output: JobHandle,
});
export const cardsExport = defineContract({
  name: "cards.export",
  summary: "Render cards as direct or indirect citations for the clipboard or a document",
  access: "read",
  input: z.object({
    ids: z.array(CardFrontmatter.shape.id).min(1),
    mode: z.enum(["direct", "indirect"]).default("direct"),
    format: z.enum(["html", "text", "pandoc", "latex", "typst"]).default("html"),
    project: ProjectSlug.optional(),
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
export const linksCreate = defineContract({
  name: "links.create",
  summary: "Add a typed link from a note to an item, card or note",
  access: "write",
  input: z.object({ from: NoteFrontmatter.shape.id, link: Link.omit({ by: true }) }),
  output: Note,
  mcp: { tool: "link", readOnly: false },
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
});
export const projectsGet = defineContract({
  name: "projects.get",
  summary: "Project brief, research questions, settings and item count",
  access: "read",
  input: z.object({ slug: ProjectSlug }),
  output: z.object({ frontmatter: ProjectFrontmatter, brief: z.string(), items: z.number() }),
  mcp: { tool: "get_project", readOnly: true },
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
export const projectsList = defineContract({
  name: "projects.list",
  summary: "List projects",
  access: "read",
  input: z.object({}),
  output: z.object({ projects: z.array(ProjectFrontmatter) }),
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
});
/** Port of the Zotero Connector listener unless the user picks another one. */
export const DEFAULT_CONNECTOR_PORT = 23119;
const ConnectorPort = z.number().int().min(1024).max(65535);
export const Settings = z.object({
  ai: z.object({
    routing: z.record(z.string(), z.string()),
    apiKeys: z.record(z.string(), z.boolean()).default({}),
  }),
  mailto: z.string().optional(),
  uiLanguage: z.enum(["de", "en"]).default("de"),
  /** Semantic search with a local embedding model. Off until the user turns it on. */
  semantic: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  /** Listener on 127.0.0.1 that lets the Zotero Connector browser extension save into citegeist. */
  connector: z
    .object({
      enabled: z.boolean().default(false),
      port: ConnectorPort.default(DEFAULT_CONNECTOR_PORT),
    })
    .default({ enabled: false, port: DEFAULT_CONNECTOR_PORT }),
});
/** Where the embedding model stands. `progress` (0 to 1) is set while the files download. */
export const SemanticStatus = z.object({
  state: z.enum(["off", "downloading", "ready", "error"]),
  model: z.string(),
  progress: z.number().min(0).max(1).optional(),
  detail: z.string().optional(),
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
    "Change routing, contact address, UI language, semantic search or the connector; API keys go to the Keychain",
  access: "admin",
  input: z.object({
    // Explicit optional fields: Settings.partial() would re-apply defaults and reset uiLanguage.
    patch: z.object({
      ai: z
        .object({
          routing: z.record(z.string(), z.string()),
          apiKeys: z.record(z.string(), z.boolean()).optional(),
        })
        .optional(),
      mailto: z.string().optional(),
      uiLanguage: z.enum(["de", "en"]).optional(),
      semantic: z.object({ enabled: z.boolean() }).optional(),
      connector: z
        .object({ enabled: z.boolean().optional(), port: ConnectorPort.optional() })
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
  itemsRename,
  itemsTrash,
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
  notesGet,
  notesList,
  notesBacklinks,
  linksCreate,
  linksPropose,
  linksDecide,
  graphNeighbors,
  projectsCreate,
  projectsGet,
  projectsUpdate,
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
  ...PLANNING_CONTRACTS,
];

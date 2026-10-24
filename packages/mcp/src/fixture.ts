import {
  CONTRACTS,
  cardsCreate,
  cardsList,
  citeFormat,
  documentsRead,
  graphRelated,
  inboxAccept,
  inboxReject,
  insightsFind,
  itemsAdd,
  itemsGet,
  itemsList,
  itemsTrash,
  jobsGet,
  jobsList,
  libraryStatus,
  linksCreate,
  notesCreate,
  notesGet,
  type OperationContract,
  outlineGet,
  projectsContext,
  projectsGet,
  projectsList,
  Registry,
  searchQuery,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";

export const FIXTURE_CITEKEY = "luhmann1984soziale";
const JOB = "j_01JB8Z3QK7ABCDEFGH";
const CARD = "c_01JB8Z3QK7ABCDEFGH";
const NOTE = "n_01JB8Z3QK7ABCDEFGH";
const STAMP = { at: "2026-10-23T10:00:00Z", by: "human" } as const;

const itemFrontmatter = (citekey: string, title: string, inbox?: { by: string; why?: string }) => ({
  id: "01JB8Z3QK7ABCDEFGH",
  citekey,
  type: "book" as const,
  title,
  author: [{ family: "Luhmann", given: "Niklas" }],
  issued: 1984,
  ids: {},
  tags: [],
  projects: [],
  status: "unread" as const,
  sources: [],
  provenance: {},
  created: STAMP,
  ...(inbox ? { inbox } : {}),
});

const noteOf = (title: string, by: string) => ({
  frontmatter: {
    id: NOTE,
    type: "permanent" as const,
    title,
    links: [],
    tags: [],
    projects: [],
    created: { at: STAMP.at, by },
  },
  body: "",
  path: "notes/fixture-note.md",
});

/**
 * An in-memory registry with believable data, bound to the real contracts. It exists for tests of
 * the MCP server and the CLI until the core (W1.1) provides the real handlers. Operations the
 * fixture does not simulate fail with FIXTURE_NOT_IMPLEMENTED.
 */
export function createFixtureRegistry(): Registry {
  const items = new Map<string, ReturnType<typeof itemFrontmatter>>([
    [FIXTURE_CITEKEY, itemFrontmatter(FIXTURE_CITEKEY, "Soziale Systeme")],
  ]);
  const reg = new Registry();

  const notFound = (citekey: string) =>
    new CitegeistError({
      code: "ITEM_NOT_FOUND",
      message: `No item with citekey ${citekey} exists.`,
      fix: "Find the citekey with the search tool or items.list, then call again.",
      recovery: "fix-and-retry",
      context: { citekey },
    });

  reg.bind(libraryStatus, async () => ({
    path: "/fixture/library",
    items: items.size,
    cards: 1,
    notes: 1,
    problems: [],
  }));

  reg.bind(itemsAdd, async (ctx, input) => {
    if (input.identifier === "invalid") {
      throw new CitegeistError({
        code: "IDENTIFIER_UNRESOLVABLE",
        message: `The identifier "${input.identifier}" is not a DOI, arXiv ID, ISBN, PMID, URL or file path.`,
        fix: 'Pass a DOI such as "10.1000/x" or an arXiv ID such as "2401.01234".',
        recovery: "fix-and-retry",
        context: { identifier: input.identifier },
      });
    }
    const citekey = `fixture${items.size + 1}`;
    const toInbox = input.target === "inbox" && ctx.actor !== "human";
    items.set(
      citekey,
      itemFrontmatter(
        citekey,
        `Fixture item for ${input.identifier}`,
        toInbox ? { by: ctx.actor, ...(input.why ? { why: input.why } : {}) } : undefined,
      ),
    );
    return { citekey, job: JOB };
  });

  reg.bind(itemsGet, async (_ctx, input) => {
    const frontmatter = items.get(input.citekey);
    if (!frontmatter) throw notFound(input.citekey);
    return {
      frontmatter,
      note: "Literature note.",
      cards: 1,
      path: `items/${input.citekey}/${input.citekey}.md`,
    };
  });

  reg.bind(itemsList, async (_ctx, input) => ({
    items: [...items.values()]
      .filter((i) => input.inbox === undefined || Boolean(i.inbox) === input.inbox)
      .slice(0, input.limit)
      .map((i) => ({
        citekey: i.citekey,
        title: i.title,
        year: "1984",
        authors: "Luhmann",
        type: i.type,
        status: i.status,
        inbox: Boolean(i.inbox),
      })),
  }));

  reg.bind(itemsTrash, async (_ctx, input) => {
    if (!items.delete(input.citekey)) throw notFound(input.citekey);
    return { ok: true as const };
  });
  reg.bind(inboxAccept, async () => ({ ok: true as const }));
  reg.bind(inboxReject, async () => ({ ok: true as const }));

  reg.bind(documentsRead, async (_ctx, input) => {
    if (!items.has(input.citekey)) throw notFound(input.citekey);
    return {
      markdown: `# Soziale Systeme\n\nKommunikation ist die Operation sozialer Systeme.${input.pages ? `\n\n(pages ${input.pages})` : ""}`,
      truncated: false,
    };
  });

  reg.bind(cardsCreate, async (ctx, input) => {
    if (!items.has(input.citekey)) throw notFound(input.citekey);
    return {
      card: {
        frontmatter: {
          id: CARD,
          item: input.citekey,
          kind: input.kind,
          anchor: input.anchor,
          quote_sha256: "a".repeat(64),
          tags: input.tags,
          projects: input.projects,
          created: { at: STAMP.at, by: ctx.actor },
        },
        body: { quote: input.quote, extra: [] },
      },
      job: JOB,
    };
  });

  reg.bind(cardsList, async (_ctx, input) => ({
    cards: [
      {
        frontmatter: {
          id: CARD,
          item: input.citekey ?? FIXTURE_CITEKEY,
          kind: "quote" as const,
          anchor: { text: { exact: "Kommunikation", prefix: "", suffix: "" } },
          quote_sha256: "a".repeat(64),
          tags: [],
          projects: [],
          created: STAMP,
        },
        body: { quote: "Kommunikation ist die Operation sozialer Systeme.", extra: [] },
      },
    ],
  }));

  reg.bind(notesCreate, async (ctx, input) => noteOf(input.title, ctx.actor));
  reg.bind(notesGet, async () => noteOf("Fixture note", "human"));
  reg.bind(linksCreate, async (ctx) => noteOf("Fixture note", ctx.actor));

  reg.bind(projectsList, async () => ({
    projects: [
      {
        slug: "systems",
        title: "Systems theory",
        status: "active" as const,
        questions: [],
        style: "apa",
        locale: "de-DE",
        export: { paraphrase: "own-else-ai" as const, labelAi: false },
        created: STAMP,
      },
    ],
  }));

  reg.bind(projectsGet, async (_ctx, input) => {
    if (input.slug !== "systems") {
      throw new CitegeistError({
        code: "PROJECT_NOT_FOUND",
        message: `No project with slug ${input.slug} exists.`,
        fix: "List the projects with projects.list and use one of the slugs.",
        recovery: "fix-and-retry",
        context: { slug: input.slug },
      });
    }
    return {
      frontmatter: {
        slug: "systems",
        title: "Systems theory",
        status: "active" as const,
        questions: [],
        style: "apa",
        locale: "de-DE",
        export: { paraphrase: "own-else-ai" as const, labelAi: false },
        created: STAMP,
      },
      brief: "Brief of the fixture project.",
      items: items.size,
    };
  });

  reg.bind(searchQuery, async (_ctx, input) => ({
    hits: [
      {
        kind: "item" as const,
        id: FIXTURE_CITEKEY,
        citekey: FIXTURE_CITEKEY,
        title: "Soziale Systeme",
        snippet: `match for "${input.q}"`,
        score: 0.9,
      },
    ],
  }));

  reg.bind(citeFormat, async (_ctx, input) => ({
    text: input.items
      .map((i) => `(Luhmann 1984${i.locator ? `, p. ${i.locator}` : ""})`)
      .join("; "),
  }));

  const job = (id: string) => ({
    id,
    kind: "ingest" as const,
    status: "succeeded" as const,
    progress: 1,
    input: {},
    attempts: 1,
    by: "agent:mcp",
    createdAt: STAMP.at,
    updatedAt: STAMP.at,
  });
  reg.bind(jobsGet, async (_ctx, input) => job(input.job));
  reg.bind(jobsList, async () => ({ jobs: [job(JOB)] }));

  reg.bind(graphRelated, async (_ctx, input) => ({
    citekey: input.citekey,
    direction: input.direction,
    total: 1,
    works: [
      {
        doi: "10.1000/related",
        title: "A related work",
        year: 1990,
        status: "new" as const,
        addable: true,
      },
    ],
    counts: { library: 0, inbox: 0, new: 1 },
    errors: [],
  }));
  reg.bind(projectsContext, async (_ctx, input) => {
    const project = await reg.call("projects.get", { actor: "human" }, { slug: input.slug });
    const outline = await reg.call(
      "outline.get",
      { actor: "human" },
      { project: input.slug, plan: input.plan },
    );
    const { nodes, plan, title } = outline as { nodes: never[]; plan: string; title: string };
    return {
      ...(project as { frontmatter: never; brief: string; items: number }),
      plans: [{ plan, title, nodes: nodes.length }],
      outline: { plan, title, nodes },
    };
  });
  reg.bind(outlineGet, async (_ctx, input) => ({
    project: input.project,
    plan: input.plan ?? "proposal",
    title: "Proposal",
    nodes: [
      {
        id: "k_01JC2C9KQ4",
        title: "Luhmanns Kommunikationsbegriff",
        parent: null,
        order: 1,
        status: "draft" as const,
        questions: [],
        number: "1",
        depth: 0,
      },
    ],
  }));
  reg.bind(insightsFind, async () => ({
    hits: [
      {
        path: "projects/systems/insights.md",
        block: "i-01JC5Q2M8T",
        date: "2026-11-12",
        text: "2026-11-12: A und B beschreiben denselben Mechanismus.",
        stage: "links" as const,
        why: "shares 1 link: luhmann1984soziale",
        score: 1,
      },
    ],
  }));

  // Everything else is bound so the registry lists all contracts; calling it reports the gap.
  for (const contract of CONTRACTS) {
    if (reg.get(contract.name)) continue;
    reg.bind(contract as OperationContract, async () => {
      throw new CitegeistError({
        code: "FIXTURE_NOT_IMPLEMENTED",
        message: `The fixture registry does not simulate ${contract.name}.`,
        fix: "Use a registry backed by the core, or call one of the simulated operations.",
        recovery: "ask-human",
      });
    });
  }
  return reg;
}

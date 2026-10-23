import {
  type CardBody,
  CardFrontmatter,
  ItemFrontmatter,
  ProjectFrontmatter,
} from "@citegeist/schema";

/** In-memory library the mock core serves. Shaped like what the real core returns. */
export interface MockData {
  items: Map<string, { frontmatter: ItemFrontmatter; note: string }>;
  cards: Array<{ frontmatter: CardFrontmatter; body: CardBody }>;
  projects: Map<string, { frontmatter: ProjectFrontmatter; brief: string }>;
}

const STAMP = { at: "2026-10-01T09:00:00.000Z", by: "human" } as const;

let counter = 0;
function ulid(): string {
  counter += 1;
  return `01J0000000${String(counter).padStart(6, "0")}`;
}

interface ItemSeed {
  citekey: string;
  type?: string;
  title: string;
  authors: Array<[family: string, given: string]>;
  year: number;
  container?: string;
  publisher?: string;
  doi?: string;
  abstract?: string;
  status?: "unread" | "reading" | "read";
  projects?: string[];
  tags?: string[];
  inboxWhy?: string;
  note?: string;
  pages?: number;
}

const ITEMS: ItemSeed[] = [
  {
    citekey: "luhmann1984soziale",
    type: "book",
    title: "Soziale Systeme: Grundriss einer allgemeinen Theorie",
    authors: [["Luhmann", "Niklas"]],
    year: 1984,
    publisher: "Suhrkamp",
    status: "reading",
    projects: ["phd-proposal"],
    tags: ["systems-theory", "communication"],
    abstract:
      "Luhmann entwirft eine allgemeine Theorie sozialer Systeme, die Kommunikation und nicht Handlung als Grundelement setzt.",
    pages: 674,
    note: "# Soziale Systeme\n\nDas Buch setzt Kommunikation als Elementaroperation sozialer Systeme.\n\n## Kernbegriffe\n\n- Autopoiesis\n- Doppelte Kontingenz\n- Sinn\n\nVerknuepft mit [[habermas1981theorie]]: beide bearbeiten dasselbe Problem, aber mit gegensaetzlichen Mitteln.",
  },
  {
    citekey: "habermas1981theorie",
    type: "book",
    title: "Theorie des kommunikativen Handelns",
    authors: [["Habermas", "Juergen"]],
    year: 1981,
    publisher: "Suhrkamp",
    status: "read",
    projects: ["phd-proposal"],
    tags: ["communication", "critical-theory"],
    abstract:
      "Eine Gesellschaftstheorie, die Verstaendigung als Grundlage sozialer Integration begreift.",
    pages: 1200,
    note: "# Theorie des kommunikativen Handelns\n\nVerstaendigungsorientiertes Handeln gegen strategisches Handeln.",
  },
  {
    citekey: "latour2005reassembling",
    type: "book",
    title: "Reassembling the Social: An Introduction to Actor-Network-Theory",
    authors: [["Latour", "Bruno"]],
    year: 2005,
    publisher: "Oxford University Press",
    status: "unread",
    projects: ["phd-proposal"],
    tags: ["ant"],
    pages: 301,
    note: "",
  },
  {
    citekey: "bowker1999sorting",
    type: "book",
    title: "Sorting Things Out: Classification and Its Consequences",
    authors: [
      ["Bowker", "Geoffrey C."],
      ["Star", "Susan Leigh"],
    ],
    year: 1999,
    publisher: "MIT Press",
    status: "unread",
    tags: ["infrastructure"],
    note: "",
  },
  {
    citekey: "vaswani2017attention",
    type: "paper-conference",
    title: "Attention Is All You Need",
    authors: [
      ["Vaswani", "Ashish"],
      ["Shazeer", "Noam"],
      ["Parmar", "Niki"],
    ],
    year: 2017,
    container: "Advances in Neural Information Processing Systems 30",
    doi: "10.48550/arXiv.1706.03762",
    status: "read",
    projects: ["rag-evaluation"],
    tags: ["transformers"],
    abstract:
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
    pages: 15,
    note: "# Attention Is All You Need\n\nIntroduces the Transformer. Self-attention replaces recurrence.",
  },
  {
    citekey: "lewis2020retrieval",
    type: "paper-conference",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    authors: [
      ["Lewis", "Patrick"],
      ["Perez", "Ethan"],
    ],
    year: 2020,
    container: "Advances in Neural Information Processing Systems 33",
    doi: "10.48550/arXiv.2005.11401",
    status: "reading",
    projects: ["rag-evaluation"],
    tags: ["rag", "retrieval"],
    abstract:
      "Large pre-trained language models store factual knowledge in their parameters. We explore a general-purpose fine-tuning recipe for retrieval-augmented generation.",
    pages: 19,
    note: "# RAG\n\nCombines a parametric generator with a non-parametric memory.\n\n## Open question\n\nHow should retrieval quality be evaluated separately from generation quality?",
  },
  {
    citekey: "es2023ragas",
    type: "article",
    title: "RAGAS: Automated Evaluation of Retrieval Augmented Generation",
    authors: [
      ["Es", "Shahul"],
      ["James", "Jithin"],
    ],
    year: 2023,
    container: "arXiv",
    doi: "10.48550/arXiv.2309.15217",
    status: "unread",
    projects: ["rag-evaluation"],
    tags: ["rag", "evaluation"],
    note: "",
  },
  {
    citekey: "thakur2021beir",
    type: "paper-conference",
    title:
      "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models",
    authors: [["Thakur", "Nandan"]],
    year: 2021,
    container: "NeurIPS Datasets and Benchmarks",
    status: "unread",
    projects: ["rag-evaluation"],
    tags: ["retrieval", "evaluation"],
    note: "",
  },
  {
    citekey: "bush1945think",
    type: "article-magazine",
    title: "As We May Think",
    authors: [["Bush", "Vannevar"]],
    year: 1945,
    container: "The Atlantic Monthly",
    status: "read",
    tags: ["memex"],
    note: "# As We May Think\n\nThe memex as an associative personal archive.",
  },
  {
    citekey: "ahrens2017how",
    type: "book",
    title: "How to Take Smart Notes",
    authors: [["Ahrens", "Soenke"]],
    year: 2017,
    publisher: "CreateSpace",
    status: "read",
    tags: ["zettelkasten"],
    note: "",
  },
  {
    citekey: "kuhn1962structure",
    type: "book",
    title: "The Structure of Scientific Revolutions",
    authors: [["Kuhn", "Thomas S."]],
    year: 1962,
    publisher: "University of Chicago Press",
    status: "read",
    tags: ["philosophy-of-science"],
    note: "",
  },
  {
    citekey: "zuboff2019age",
    type: "book",
    title: "The Age of Surveillance Capitalism",
    authors: [["Zuboff", "Shoshana"]],
    year: 2019,
    publisher: "PublicAffairs",
    status: "unread",
    inboxWhy: "Matches your search for platform critique since 2015.",
    tags: ["platforms"],
    note: "",
  },
  {
    citekey: "gillespie2018custodians",
    type: "book",
    title: "Custodians of the Internet",
    authors: [["Gillespie", "Tarleton"]],
    year: 2018,
    publisher: "Yale University Press",
    status: "unread",
    inboxWhy: "Cited by three papers already in the PhD project.",
    tags: ["platforms", "moderation"],
    note: "",
  },
  {
    citekey: "baecker2007formen",
    type: "book",
    title: "Formen der Organisation: Systemtheorie der Unternehmung",
    authors: [["Baecker", "Dirk"]],
    year: 2007,
    status: "unread",
    inboxWhy: "Systems theory applied to platforms, found via OpenAlex.",
    tags: ["systems-theory"],
    note: "",
  },
];

const CARDS: Array<{
  item: string;
  quote: string;
  page: string;
  kind?: CardFrontmatter["kind"];
  paraphrase?: string;
  core?: string;
  ownWords?: string;
  comment?: string;
  projects?: string[];
}> = [
  {
    item: "luhmann1984soziale",
    quote:
      "Soziale Systeme bestehen aus Kommunikationen und nur aus Kommunikationen. Menschen sind in ihrer Umwelt.",
    page: "31",
    paraphrase:
      "Social systems consist of communications only; people belong to their environment rather than to the system.",
    core: "Communication, not people, is the element of social systems.",
    projects: ["phd-proposal"],
  },
  {
    item: "luhmann1984soziale",
    quote:
      "Es gibt selbstreferentielle Systeme. Der Begriff der Selbstreferenz bezeichnet die Einheit, die ein Element, ein Prozess, ein System fuer sich selbst ist.",
    page: "58",
    kind: "definition",
    paraphrase: "Self-referential systems relate to themselves through their own elements.",
    core: "Definition of self-reference.",
    ownWords: "Compare with Maturana's autopoiesis before using this in chapter 2.",
    projects: ["phd-proposal"],
  },
  {
    item: "luhmann1984soziale",
    quote: "Doppelte Kontingenz ist der Ausgangspunkt der Bildung sozialer Systeme.",
    page: "148",
    comment: "Possible counter-position to Habermas, see note on double contingency.",
    projects: ["phd-proposal"],
  },
  {
    item: "lewis2020retrieval",
    quote:
      "We build RAG models where the parametric memory is a pre-trained seq2seq transformer, and the non-parametric memory is a dense vector index of Wikipedia.",
    page: "2",
    kind: "method",
    paraphrase: "The generator is a seq2seq transformer, the memory a dense index of Wikipedia.",
    core: "Architecture of the original RAG model.",
    projects: ["rag-evaluation"],
  },
  {
    item: "lewis2020retrieval",
    quote:
      "For knowledge-intensive tasks, we find that RAG models generate more specific, diverse and factual language than a state-of-the-art parametric-only seq2seq baseline.",
    page: "8",
    kind: "finding",
    paraphrase: "RAG output is more specific and factual than a parametric-only baseline.",
    core: "Main empirical result.",
    projects: ["rag-evaluation"],
  },
  {
    item: "vaswani2017attention",
    quote: "The Transformer is the first transduction model relying entirely on self-attention.",
    page: "2",
    core: "No recurrence, no convolution.",
    projects: ["rag-evaluation"],
  },
];

const PROJECTS: Array<{
  slug: string;
  title: string;
  brief: string;
  questions: string[];
  status?: "active" | "paused" | "done";
}> = [
  {
    slug: "phd-proposal",
    title: "PhD proposal",
    questions: [
      "Wie laesst sich Luhmanns Kommunikationsbegriff auf Plattformen anwenden?",
      "Wo widersprechen sich Luhmann und Habermas, wo bearbeiten sie dasselbe Problem?",
    ],
    brief:
      "# Brief\n\nDas Proposal untersucht Plattformen als soziale Systeme im Sinne Luhmanns. Die Abgrenzung zur Handlungstheorie bei Habermas steht im Zentrum von Kapitel 2.\n\n## Abgrenzung\n\n- Keine Plattformoekonomie im engeren Sinn\n- Fokus auf Kommunikationsbegriff\n\nAgents lesen diesen Brief vor jeder Projektaufgabe.",
  },
  {
    slug: "rag-evaluation",
    title: "RAG evaluation",
    questions: ["Which metrics separate retrieval quality from generation quality?"],
    brief:
      "# Brief\n\nEvaluate retrieval-augmented generation for the kiimu assistant.\n\nStart from the original RAG paper and the benchmark literature.",
  },
  {
    slug: "reading-group",
    title: "Reading group",
    status: "paused",
    questions: [],
    brief: "",
  },
];

export function createFixtures(): MockData {
  counter = 0;
  const items: MockData["items"] = new Map();
  for (const s of ITEMS) {
    const fm = ItemFrontmatter.parse({
      id: ulid(),
      citekey: s.citekey,
      type: s.type ?? "book",
      title: s.title,
      author: s.authors.map(([family, given]) => ({ family, given })),
      issued: s.year,
      ...(s.container ? { "container-title": s.container } : {}),
      ...(s.publisher ? { publisher: s.publisher } : {}),
      ...(s.doi ? { DOI: s.doi } : {}),
      ...(s.abstract ? { abstract: s.abstract } : {}),
      tags: s.tags ?? [],
      projects: s.projects ?? [],
      status: s.status ?? "unread",
      ...(s.inboxWhy ? { inbox: { by: "agent:claude-code", why: s.inboxWhy } } : {}),
      sources: s.pages
        ? [
            {
              hash: s.citekey
                .replace(/[^0-9a-f]/g, "0")
                .padEnd(12, "0")
                .slice(0, 12),
              kind: "pdf",
              filename: `${s.citekey}.pdf`,
              pages: s.pages,
              added: STAMP,
            },
          ]
        : [],
      created: STAMP,
    });
    items.set(s.citekey, { frontmatter: fm, note: s.note ?? "" });
  }

  const cards = CARDS.map((c) => ({
    frontmatter: CardFrontmatter.parse({
      id: `c_${ulid()}`,
      item: c.item,
      kind: c.kind ?? "quote",
      locator: { label: "page", start: c.page, confirmed: true },
      anchor: { text: { exact: c.quote } },
      quote_sha256: "0".repeat(64),
      ...(c.paraphrase
        ? { paraphrase: { by: "claude-code", at: "2026-10-02T10:00:00.000Z", language: "en" } }
        : {}),
      ...(c.core
        ? { core: { by: "claude-code", at: "2026-10-02T10:00:00.000Z", language: "en" } }
        : {}),
      projects: c.projects ?? [],
      created: STAMP,
    }),
    body: {
      quote: c.quote,
      ...(c.paraphrase ? { paraphrase: c.paraphrase } : {}),
      ...(c.core ? { core: c.core } : {}),
      ...(c.ownWords ? { ownWords: c.ownWords } : {}),
      ...(c.comment ? { comment: c.comment } : {}),
      extra: [],
    },
  }));

  const projects: MockData["projects"] = new Map();
  for (const p of PROJECTS) {
    projects.set(p.slug, {
      frontmatter: ProjectFrontmatter.parse({
        slug: p.slug,
        title: p.title,
        status: p.status ?? "active",
        questions: p.questions.map((text, i) => ({ id: `q${i + 1}`, text })),
        created: STAMP,
      }),
      brief: p.brief,
    });
  }
  return { items, cards, projects };
}

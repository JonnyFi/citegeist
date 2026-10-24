import {
  type GraphWork,
  graphAddCandidates,
  graphCiting,
  graphReferences,
  graphRelated,
  itemsCheckRetractions,
  type MarkedWork,
  type Registry,
} from "@citegeist/ops";
import { ItemFrontmatter } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";
import { markerOf } from "./retraction";

/** A work of the mock citation graph; `key` names the fixture item it is when it is in the library. */
interface MockWork extends GraphWork {
  libraryKey?: string;
}

const GRAPH: Record<string, { references: MockWork[]; citing: MockWork[] }> = {
  luhmann1984soziale: {
    references: [
      {
        doi: "10.9999/mock.parsons1951",
        title: "The Social System",
        authors: "Parsons",
        year: 1951,
        container: "Free Press",
        citedBy: 28400,
      },
      {
        doi: "10.9999/mock.maturana1980",
        title: "Autopoiesis and Cognition: The Realization of the Living",
        authors: "Maturana, Varela",
        year: 1980,
        container: "Reidel",
        citedBy: 11200,
      },
      {
        doi: "10.9999/mock.bateson1972",
        title: "Steps to an Ecology of Mind",
        authors: "Bateson",
        year: 1972,
        container: "Chandler",
        citedBy: 9100,
      },
      {
        title: "Laws of Form",
        authors: "Spencer-Brown",
        year: 1969,
        raw: "Spencer-Brown, G. (1969). Laws of Form. London: Allen and Unwin.",
      },
      {
        title: "Theorie des kommunikativen Handelns",
        authors: "Habermas",
        year: 1981,
        container: "Suhrkamp",
        libraryKey: "habermas1981theorie",
        doi: "10.9999/mock.habermas1981",
        citedBy: 21000,
      },
    ],
    citing: [
      {
        doi: "10.9999/mock.baecker2007",
        title: "Formen der Organisation: Systemtheorie der Unternehmung",
        authors: "Baecker",
        year: 2007,
        libraryKey: "baecker2007formen",
        citedBy: 640,
      },
      {
        doi: "10.9999/mock.latour2005",
        title: "Reassembling the Social: An Introduction to Actor-Network-Theory",
        authors: "Latour",
        year: 2005,
        libraryKey: "latour2005reassembling",
        citedBy: 24800,
      },
      {
        doi: "10.9999/mock.gillespie2018",
        title: "Custodians of the Internet",
        authors: "Gillespie",
        year: 2018,
        libraryKey: "gillespie2018custodians",
        citedBy: 3100,
      },
      {
        doi: "10.9999/mock.esposito2017",
        title: "Artificial Communication? The Production of Contingency by Algorithms",
        authors: "Esposito",
        year: 2017,
        container: "Zeitschrift für Soziologie",
        citedBy: 410,
      },
      {
        doi: "10.9999/mock.fuchs2001",
        title: "Against Essentialism: A Theory of Culture and Society",
        authors: "Fuchs",
        year: 2001,
        container: "Harvard University Press",
        citedBy: 520,
      },
    ],
  },
  vaswani2017attention: {
    references: [
      {
        arxiv: "1409.0473",
        title: "Neural Machine Translation by Jointly Learning to Align and Translate",
        authors: "Bahdanau, Cho, Bengio",
        year: 2014,
        container: "ICLR",
        citedBy: 28000,
      },
      {
        arxiv: "1409.3215",
        title: "Sequence to Sequence Learning with Neural Networks",
        authors: "Sutskever, Vinyals, Le",
        year: 2014,
        container: "NeurIPS",
        citedBy: 24000,
      },
      {
        arxiv: "1512.03385",
        title: "Deep Residual Learning for Image Recognition",
        authors: "He, Zhang, Ren, Sun",
        year: 2016,
        container: "CVPR",
        citedBy: 210000,
      },
    ],
    citing: [
      {
        doi: "10.48550/arXiv.2005.11401",
        title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        authors: "Lewis, Perez, Piktus",
        year: 2020,
        libraryKey: "lewis2020retrieval",
        citedBy: 5200,
      },
      {
        arxiv: "1810.04805",
        title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors: "Devlin, Chang, Lee, Toutanova",
        year: 2018,
        container: "NAACL",
        citedBy: 98000,
      },
      {
        arxiv: "2005.14165",
        title: "Language Models are Few-Shot Learners",
        authors: "Brown, Mann, Ryder",
        year: 2020,
        container: "NeurIPS",
        citedBy: 41000,
      },
      {
        arxiv: "2010.11929",
        title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
        authors: "Dosovitskiy, Beyer, Kolesnikov",
        year: 2020,
        container: "ICLR",
        citedBy: 52000,
      },
    ],
  },
  lewis2020retrieval: {
    references: [
      {
        doi: "10.9999/mock.vaswani2017",
        title: "Attention Is All You Need",
        authors: "Vaswani, Shazeer, Parmar",
        year: 2017,
        libraryKey: "vaswani2017attention",
        citedBy: 120000,
      },
      {
        arxiv: "2004.04906",
        title: "Dense Passage Retrieval for Open-Domain Question Answering",
        authors: "Karpukhin, Oguz, Min",
        year: 2020,
        container: "EMNLP",
        citedBy: 3800,
      },
    ],
    citing: [
      {
        doi: "10.48550/arXiv.2309.15217",
        title: "RAGAS: Automated Evaluation of Retrieval Augmented Generation",
        authors: "Es, James",
        year: 2023,
        libraryKey: "es2023ragas",
        citedBy: 800,
      },
      {
        title:
          "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models",
        authors: "Thakur",
        year: 2021,
        libraryKey: "thakur2021beir",
        doi: "10.9999/mock.thakur2021",
        citedBy: 1500,
      },
    ],
  },
};

/** Two generic references for items the mock graph does not know. */
function fallback(citekey: string): { references: MockWork[]; citing: MockWork[] } {
  return {
    references: [
      {
        doi: `10.9999/mock.${citekey}.a`,
        title: "Eine frühere Arbeit zum selben Thema",
        authors: "Beispiel",
        year: 2001,
        citedBy: 120,
      },
      {
        title: "Ein Werk ohne Kennung",
        authors: "Beispiel",
        year: 1990,
        raw: "Beispiel (1990). Ein Werk ohne Kennung.",
      },
    ],
    citing: [],
  };
}

const ADDED = new WeakMap<MockData, Map<string, string>>();

function addedOf(data: MockData): Map<string, string> {
  let map = ADDED.get(data);
  if (!map) {
    map = new Map();
    ADDED.set(data, map);
  }
  return map;
}

const idOf = (w: GraphWork): string | undefined => w.doi ?? w.arxiv ?? w.openalex;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomId(): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return out;
}

/**
 * graph.related, graph.references, graph.citing, graph.addCandidates and items.checkRetractions
 * for the mock core. The status of a work follows the library: adding one to the inbox changes the
 * answer of the next call.
 */
export function bindRelatedMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
): Registry {
  const added = addedOf(data);

  const mark = (w: MockWork): MarkedWork => {
    const { libraryKey, ...work } = w;
    const id = idOf(w);
    const key = (id ? added.get(id) : undefined) ?? libraryKey;
    const item = key ? data.items.get(key) : undefined;
    return {
      ...work,
      status: item ? (item.frontmatter.inbox ? "inbox" : "library") : "new",
      ...(item ? { citekey: item.frontmatter.citekey } : {}),
      addable: Boolean(w.doi || w.arxiv || w.openalex),
    };
  };

  const list = (citekey: string, direction: "references" | "citing", cursor?: string) => {
    if (!data.items.has(citekey)) {
      throw new Error(`ITEM_NOT_FOUND: no item with citekey '${citekey}'`);
    }
    const graph = GRAPH[citekey] ?? fallback(citekey);
    const all = [...graph[direction]]
      .sort((a, b) => (direction === "citing" ? (b.citedBy ?? 0) - (a.citedBy ?? 0) : 0))
      .map(mark);
    const counts = {
      library: all.filter((w) => w.status === "library").length,
      inbox: all.filter((w) => w.status === "inbox").length,
      new: all.filter((w) => w.status === "new").length,
    };
    return { all, counts, offset: cursor ? Number(cursor) || 0 : 0 };
  };

  const page = (all: MarkedWork[], offset: number, limit: number) => {
    const works = all.slice(offset, offset + limit);
    const end = offset + works.length;
    return { works, next: end < all.length ? String(end) : undefined };
  };

  registry
    .bind(graphRelated, async (_ctx, input) => {
      const { all, counts, offset } = list(input.citekey, input.direction, input.cursor);
      const { works, next } = page(all, offset, input.limit);
      return {
        citekey: input.citekey,
        direction: input.direction,
        ...(input.direction === "references" ? { source: "refs.jsonl" as const } : {}),
        total: all.length,
        works,
        counts,
        errors: [],
        ...(next ? { next } : {}),
      };
    })
    .bind(graphReferences, async (_ctx, input) => {
      const { all, counts } = list(input.citekey, "references");
      return {
        citekey: input.citekey,
        source: "refs.jsonl" as const,
        total: all.length,
        references: all.slice(0, input.limit),
        counts,
        errors: [],
      };
    })
    .bind(graphCiting, async (_ctx, input) => {
      const { all, counts, offset } = list(input.citekey, "citing", input.cursor);
      const { works, next } = page(all, offset, input.limit);
      return {
        citekey: input.citekey,
        total: all.length,
        citing: works,
        counts,
        ...(next ? { next } : {}),
      };
    })
    .bind(graphAddCandidates, async (_ctx, input) => {
      const results = input.candidates.map((candidate) => {
        const identifier = idOf(candidate) ?? "";
        const known = added.get(identifier);
        const existing = known ? data.items.get(known) : undefined;
        const inLibrary = [...data.items.values()].find(
          (i) => candidate.doi && i.frontmatter.DOI?.toLowerCase() === candidate.doi.toLowerCase(),
        );
        const duplicate = existing ?? inLibrary;
        if (duplicate) {
          return {
            identifier,
            status: "duplicate" as const,
            citekey: duplicate.frontmatter.citekey,
          };
        }
        const family = (candidate.authors ?? "work").split(/[ ,]/)[0]?.toLowerCase() ?? "work";
        const word = (candidate.title ?? "").split(/\W+/).find((w) => w.length > 3) ?? "";
        let citekey = `${family}${candidate.year ?? ""}${word.toLowerCase()}`.replace(
          /[^a-z0-9]/g,
          "",
        );
        for (let n = 2; data.items.has(citekey); n++) citekey = `${citekey}${n}`;
        const now = new Date().toISOString();
        const why =
          input.via === "citing"
            ? `Zitiert ${input.from ?? "eine Quelle"}`
            : `Zitiert von ${input.from ?? "einer Quelle"}`;
        data.items.set(citekey, {
          note: "",
          frontmatter: ItemFrontmatter.parse({
            id: randomId(),
            citekey,
            type: "article",
            title: candidate.title ?? identifier,
            ...(candidate.authors
              ? { author: candidate.authors.split(/,\s*/).map((family) => ({ family })) }
              : {}),
            ...(candidate.year ? { issued: candidate.year } : {}),
            ...(candidate.doi ? { DOI: candidate.doi } : {}),
            ...(candidate.container ? { "container-title": candidate.container } : {}),
            tags: input.tags,
            projects: input.projects,
            status: "unread",
            created: { at: now, by: "human" },
            inbox: { by: "human", why },
          }),
        });
        added.set(identifier, citekey);
        emit({ type: "change", path: `items/${citekey}/${citekey}.md`, external: false });
        return { identifier, status: "added" as const, citekey };
      });
      const count = (status: string) => results.filter((r) => r.status === status).length;
      return {
        results,
        added: count("added"),
        duplicates: count("duplicate"),
        failed: count("failed"),
      };
    })
    .bind(itemsCheckRetractions, async (_ctx, input) => {
      const keys = input.citekeys ?? [...data.items.keys()];
      const flagged = keys.flatMap((citekey) => {
        const marker = markerOf(data.items.get(citekey)?.frontmatter.retraction);
        return marker
          ? [{ citekey, status: marker.status, notices: marker.notices, changed: false }]
          : [];
      });
      const withDoi = keys.filter((k) => data.items.get(k)?.frontmatter.DOI).length;
      return {
        checked: withDoi,
        flagged,
        cleared: [],
        skipped: keys.length - withDoi,
        errors: [],
      };
    });
  return registry;
}

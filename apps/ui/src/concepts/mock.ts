import {
  type Concept,
  type ConceptCard,
  type ConceptOp,
  type ConceptProposal,
  type ConceptSummary,
  conceptsCreate,
  conceptsDescribe,
  conceptsGet,
  conceptsList,
  conceptsMerge,
  conceptsPropose,
  conceptsUpdate,
  type Registry,
} from "@citegeist/ops";
import type { ConceptUsage } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";

interface MockJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  progress?: number;
  result?: unknown;
}

interface MockConcept {
  id: string;
  slug: string;
  title: string;
  aliases: string[];
  cards: string[];
  usages: ConceptUsage[];
  note: string;
  created: { at: string; by: "human" };
  modified?: string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomId(prefix: string): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `${prefix}${out}`;
}

/** Same key the core uses to decide that two spellings are one name. */
function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function slugify(title: string): string {
  return (
    normName(title)
      .replace(/ /g, "-")
      .replace(/^-+|-+$/g, "") || "begriff"
  );
}

function dedupe(title: string, aliases: readonly string[]): string[] {
  const seen = new Set([normName(title)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.replace(/\s+/g, " ").trim();
    const key = normName(alias);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

const STORES = new WeakMap<MockData, Map<string, MockConcept>>();

function seed(data: MockData): Map<string, MockConcept> {
  const store = new Map<string, MockConcept>();
  const rag = data.cards.filter(
    (c) => c.frontmatter.item === "lewis2020retrieval" && /\bRAG\b/.test(c.body.quote),
  );
  if (rag.length > 0) {
    const id = "n_00000000000000C1";
    const first = rag[0];
    store.set(id, {
      id,
      slug: "retrieval-augmented-generation",
      title: "Retrieval-augmented generation",
      aliases: ["RAG"],
      cards: rag.map((c) => c.frontmatter.id),
      usages: first
        ? [
            {
              item: "lewis2020retrieval",
              role: "defines",
              text:
                data.lang === "en"
                  ? "Lewis et al. define RAG as a model in which a pretrained generator works together with a dense index of Wikipedia as its non-parametric memory."
                  : "Lewis et al. fassen RAG als Modell, in dem ein vortrainierter Generator mit einem dichten Index von Wikipedia als nicht-parametrischem Speicher zusammenarbeitet.",
              evidence: [
                {
                  card: first.frontmatter.id,
                  quote: first.body.quote.slice(0, 90),
                  page: first.frontmatter.locator?.start ?? null,
                },
              ],
              basis: rag.map((c) => c.frontmatter.id),
              stamp: {
                by: "claude-code:sonnet",
                at: "2026-10-20T09:00:00.000Z",
                language: data.lang,
              },
              promptVersion: 1,
            },
          ]
        : [],
      note: "",
      created: { at: "2026-10-20T08:00:00.000Z", by: "human" },
    });
  }
  return store;
}

function storeOf(data: MockData): Map<string, MockConcept> {
  let store = STORES.get(data);
  if (!store) {
    store = seed(data);
    STORES.set(data, store);
  }
  return store;
}

/** Mock stand-in for the model: the term after "Begriff der", else the first long word. */
function mockTerm(quote: string): string {
  const named = /(?:Begriff (?:der|des|von)|concept of(?: the)?) ([\p{L}-]+)/u.exec(quote);
  if (named?.[1]) return named[1];
  const long = quote.match(/[\p{L}-]{8,}/gu)?.[0];
  return long ?? quote.split(/\s+/)[0] ?? quote;
}

/**
 * The concept operations of the core against fixture data. Entries and proposals come from fixed
 * rules instead of a model, one source at a time, so the screens can show work under way.
 */
export function bindConceptsMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
  jobs: Map<string, MockJob>,
  delayMs: number,
): Registry {
  const store = storeOf(data);
  const step = Math.max(5, Math.round(delayMs / 5));
  const busy = new Set<string>();

  const changed = (c: MockConcept) =>
    emit({ type: "change", path: `notes/concepts/${c.slug}.md`, external: false });
  const find = (id: string): MockConcept => {
    const c = store.get(id);
    if (!c) throw new Error(`CONCEPT_NOT_FOUND: no concept with id '${id}'`);
    return c;
  };
  const cardOf = (id: string) => data.cards.find((c) => c.frontmatter.id === id);
  const pageOf = (id: string): string | null => {
    const loc = cardOf(id)?.frontmatter.locator;
    if (!loc) return null;
    return loc.end && loc.end !== loc.start ? `${loc.start}-${loc.end}` : loc.start;
  };
  const byItem = (c: MockConcept): Map<string, string[]> => {
    const groups = new Map<string, string[]>();
    for (const id of unique(c.cards)) {
      const card = cardOf(id);
      if (!card) continue;
      const list = groups.get(card.frontmatter.item) ?? [];
      list.push(id);
      groups.set(card.frontmatter.item, list);
    }
    return groups;
  };
  const nameIndex = (): Map<string, string> => {
    const index = new Map<string, string>();
    for (const c of store.values()) {
      for (const n of [c.title, ...c.aliases]) {
        const key = normName(n);
        if (key !== "" && !index.has(key)) index.set(key, c.id);
      }
    }
    return index;
  };
  const summary = (c: MockConcept): ConceptSummary => {
    const groups = byItem(c);
    const fresh = unique(
      c.usages
        .filter((u) => {
          const now = groups.get(u.item);
          return now !== undefined && sameSet(u.basis, now);
        })
        .map((u) => u.item),
    );
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      aliases: c.aliases,
      cards: [...groups.values()].flat(),
      sources: groups.size,
      described: fresh.length,
      open: groups.size - fresh.length,
      ...(c.modified ? { modified: c.modified } : {}),
    };
  };
  const view = (c: MockConcept): Concept => {
    const groups = byItem(c);
    const members: ConceptCard[] = [...groups.values()].flat().map((id) => {
      const card = cardOf(id);
      return {
        id,
        item: card?.frontmatter.item ?? "",
        ...(card?.frontmatter.kind ? { kind: card.frontmatter.kind } : {}),
        quote: card?.body.quote ?? "",
        page: pageOf(id),
      };
    });
    return {
      ...summary(c),
      path: `/mock/library/notes/concepts/${c.slug}.md`,
      note: c.note,
      members,
      usages: c.usages
        .filter((u) => groups.has(u.item))
        .map((u) => ({
          ...structuredClone(u),
          stale: !sameSet(u.basis, groups.get(u.item) ?? []),
        })),
      created: c.created,
    };
  };
  const touch = (c: MockConcept) => {
    c.aliases = dedupe(c.title, c.aliases);
    c.cards = unique(c.cards);
    const items = new Set(byItem(c).keys());
    c.usages = c.usages.filter((u) => items.has(u.item));
    c.modified = new Date().toISOString();
    changed(c);
  };
  const checkFree = (names: readonly string[], self: string) => {
    const index = nameIndex();
    for (const name of names) {
      const owner = index.get(normName(name));
      if (owner && owner !== self) {
        throw new Error(`CONCEPT_NAME_TAKEN: '${name}' is already a name of concept ${owner}`);
      }
    }
  };
  const requireCards = (ids: readonly string[]) => {
    for (const id of ids) {
      if (!cardOf(id)) throw new Error(`CARD_NOT_FOUND: no card with id '${id}'`);
    }
  };
  const collect = (names: readonly string[]): string[] =>
    data.cards
      .filter((c) => {
        const text = normName(`${c.body.quote} ${c.body.paraphrase ?? ""} ${c.body.note ?? ""}`);
        return names.some((n) => {
          const key = normName(n);
          return key.length >= 3 && ` ${text} `.includes(` ${key} `);
        });
      })
      .map((c) => c.frontmatter.id);
  const startJob = (): MockJob => {
    const now = new Date().toISOString();
    const job: MockJob = {
      id: randomId("j_"),
      status: "running",
      createdAt: now,
      updatedAt: now,
      progress: 0,
    };
    jobs.set(job.id, job);
    return job;
  };
  const finish = (job: MockJob, result: unknown) => {
    job.status = "succeeded";
    job.progress = 1;
    job.result = result;
    job.updatedAt = new Date().toISOString();
  };

  registry
    .bind(conceptsList, async (_ctx, input) => {
      const q = input.query ? normName(input.query) : "";
      const concepts = [...store.values()]
        .filter((c) => q === "" || [c.title, ...c.aliases].some((n) => normName(n).includes(q)))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, input.limit)
        .map(summary);
      return { concepts };
    })
    .bind(conceptsGet, async (_ctx, input) => ({ concept: view(find(input.id)) }))
    .bind(conceptsCreate, async (_ctx, input) => {
      const term = input.term.replace(/\s+/g, " ").trim();
      const names = dedupe("", [term, ...input.aliases]);
      requireCards(input.cards);
      const index = nameIndex();
      const owners = unique(names.flatMap((n) => index.get(normName(n)) ?? []));
      if (owners.length > 1) {
        throw new Error("CONCEPT_AMBIGUOUS: the names belong to different concepts");
      }
      const cards = unique([...input.cards, ...(input.collect ? collect(names) : [])]);
      const existing = owners[0] ? find(owners[0]) : undefined;
      if (existing) {
        existing.aliases = [...existing.aliases, ...names];
        existing.cards = unique([...existing.cards, ...cards]);
        touch(existing);
        return { concept: view(existing), merged: true };
      }
      let slug = slugify(term);
      const taken = new Set([...store.values()].map((c) => c.slug));
      for (let n = 2; taken.has(slug); n++) slug = `${slugify(term)}-${n}`;
      const concept: MockConcept = {
        id: randomId("n_"),
        slug,
        title: names[0] ?? term,
        aliases: names.slice(1),
        cards,
        usages: [],
        note: "",
        created: { at: new Date().toISOString(), by: "human" },
      };
      store.set(concept.id, concept);
      touch(concept);
      return { concept: view(concept), merged: false };
    })
    .bind(conceptsUpdate, async (_ctx, input) => {
      const c = find(input.id);
      for (const op of input.ops as ConceptOp[]) {
        switch (op.op) {
          case "rename": {
            const title = op.title.replace(/\s+/g, " ").trim();
            checkFree([title], c.id);
            if (normName(title) !== normName(c.title)) c.aliases = [...c.aliases, c.title];
            c.title = title;
            c.slug = slugify(title);
            break;
          }
          case "addAlias":
            checkFree([op.alias], c.id);
            c.aliases = [...c.aliases, op.alias];
            break;
          case "removeAlias":
            c.aliases = c.aliases.filter((a) => normName(a) !== normName(op.alias));
            break;
          case "addCards":
            requireCards(op.cards);
            c.cards = unique([...c.cards, ...op.cards]);
            break;
          case "removeCards":
            c.cards = c.cards.filter((id) => !op.cards.includes(id));
            break;
          case "setNote":
            c.note = op.note;
            break;
        }
      }
      touch(c);
      return { concept: view(c) };
    })
    .bind(conceptsMerge, async (_ctx, input) => {
      const into = find(input.into);
      for (const id of input.from.filter((f) => f !== input.into)) {
        const src = find(id);
        const used = new Set(into.usages.map((u) => u.item));
        into.aliases = [...into.aliases, src.title, ...src.aliases];
        into.cards = unique([...into.cards, ...src.cards]);
        into.usages = [...into.usages, ...src.usages.filter((u) => !used.has(u.item))];
        if (src.note && src.note !== into.note) {
          into.note = [into.note, src.note].filter(Boolean).join("\n\n");
        }
        store.delete(id);
        changed(src);
      }
      touch(into);
      return { concept: view(into) };
    })
    .bind(conceptsDescribe, async (_ctx, input) => {
      const c = find(input.id);
      if (busy.has(c.id)) throw new Error("CONCEPT_BUSY: the concept is being described");
      const current = view(c);
      const stale = new Set(current.usages.filter((u) => u.stale).map((u) => u.item));
      const done = new Set(current.usages.filter((u) => !u.stale).map((u) => u.item));
      const items = unique(current.members.map((m) => m.item)).filter(
        (item) => input.force || stale.has(item) || !done.has(item),
      );
      const job = startJob();
      if (items.length === 0) {
        finish(job, { written: 0, silent: 0, failed: 0 });
        return { job: job.id, sources: 0 };
      }
      busy.add(c.id);
      const groups = byItem(c);
      items.forEach((item, i) => {
        setTimeout(
          () => {
            const ids = groups.get(item) ?? [];
            const first = cardOf(ids[0] ?? "");
            if (first) {
              const kind = ids.map((id) => cardOf(id)?.frontmatter.kind);
              const usage: ConceptUsage = {
                item,
                role: kind.includes("definition") ? "defines" : "uses",
                text: `${
                  data.lang === "en"
                    ? `The source uses \u201c${c.title}\u201d in connection with:`
                    : `Die Quelle verwendet \u201e${c.title}\u201c im Zusammenhang mit:`
                } ${first.body.paraphrase ?? first.body.quote.slice(0, 80)}`,
                evidence: [
                  {
                    card: first.frontmatter.id,
                    quote: first.body.quote.slice(0, 90),
                    page: pageOf(first.frontmatter.id),
                  },
                ],
                basis: ids,
                stamp: { by: "mock:sonnet", at: new Date().toISOString(), language: data.lang },
                promptVersion: 1,
              };
              c.usages = [...c.usages.filter((u) => u.item !== item), usage];
              c.modified = new Date().toISOString();
            }
            job.progress = (i + 1) / items.length;
            job.updatedAt = new Date().toISOString();
            if (i + 1 === items.length) {
              busy.delete(c.id);
              finish(job, { written: items.length, silent: 0, failed: 0 });
            }
            changed(c);
          },
          step * (i + 1),
        );
      });
      return { job: job.id, sources: items.length };
    })
    .bind(conceptsPropose, async (_ctx, input) => {
      const job = startJob();
      const index = nameIndex();
      const members = new Set([...store.values()].flatMap((c) => c.cards));
      const proposals: ConceptProposal[] = [];
      for (const card of data.cards) {
        if (card.frontmatter.kind !== "definition" || members.has(card.frontmatter.id)) continue;
        const term = mockTerm(card.body.quote);
        const existing = index.get(normName(term));
        proposals.push({
          term,
          aliases: [],
          origin: "definition",
          cards: [card.frontmatter.id],
          sources: [card.frontmatter.item],
          ...(existing ? { existing } : {}),
        });
      }
      setTimeout(() => finish(job, { proposals: proposals.slice(0, input.limit) }), step * 2);
      return { job: job.id };
    });
  return registry;
}

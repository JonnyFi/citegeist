import { scanWikiLinks } from "@citegeist/editor";
import {
  aggregateGraph,
  buildSemanticGraph,
  type CardLink,
  type GraphLibrary,
  graphNeighbors,
  graphProject,
  linksCreate,
  linksDecide,
  linksForCard,
  linksForItem,
  linksPropose,
  linksRemove,
  linksSuggest,
  type Registry,
} from "@citegeist/ops";
import { citedKeys, type Link } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";
import { type MockNote, storeFor, toNote } from "../notes/mock";
import { textsStoreFor } from "../texts/mock";
import type { GraphEdge, GraphNode } from "./model";

type MockJobs = Map<
  string,
  {
    id: string;
    status: "running" | "succeeded" | "failed";
    createdAt: string;
    updatedAt: string;
  }
>;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function jobId(): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `j_${out}`;
}

/** Wiki links in the body that are not already a typed link of the note. */
function wikiTargets(note: MockNote): string[] {
  return [...new Set(scanWikiLinks(note.body).map((m) => m.target))];
}

export const typedTarget = (link: Link) =>
  link.to.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? link.to;

/**
 * links.propose, links.decide and graph.neighbors for the mock core. Proposals are made by a
 * fixed rule instead of a model: the first linked source is supported, other targets are related.
 */
export function bindConnectionsMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
  jobs: MockJobs,
  delayMs: number,
): Registry {
  const notes = storeFor(data);
  const changed = (n: MockNote) =>
    emit({ type: "change", path: `notes/${n.slug}.md`, external: false });

  /** Node for a wiki link target, or undefined when nothing in the library has that name. */
  const resolve = (target: string): GraphNode | undefined => {
    const item = data.items.get(target);
    if (item) return { id: target, kind: "item", label: item.frontmatter.title };
    const card = data.cards.find((c) => c.frontmatter.id === target);
    if (card) {
      return { id: target, kind: "card", label: card.body.quote.replace(/\s+/g, " ").slice(0, 80) };
    }
    const note = [...notes.values()].find((n) => n.slug === target || n.frontmatter.id === target);
    if (note) return { id: note.frontmatter.id, kind: "note", label: note.frontmatter.title };
    return undefined;
  };

  const allEdges = (): GraphEdge[] => {
    const edges: GraphEdge[] = [];
    for (const n of notes.values()) {
      const from = n.frontmatter.id;
      for (const link of n.frontmatter.links) {
        if (link.status === "rejected") continue;
        const to = resolve(typedTarget(link));
        if (to) {
          // a connection that starts at a card is the card's edge
          edges.push({
            from: link.from ?? from,
            to: to.id,
            rel: link.rel ?? "related",
            status: link.status,
          });
        }
      }
      for (const target of wikiTargets(n)) {
        const to = resolve(target);
        if (to && to.id !== from) edges.push({ from, to: to.id, rel: "wiki", status: "accepted" });
      }
    }
    for (const card of data.cards) {
      edges.push({
        from: card.frontmatter.id,
        to: card.frontmatter.item,
        rel: "excerpt-of",
        status: "accepted",
      });
    }
    return edges;
  };

  /** The fixtures in the shape the shared graph builder reads, as the core gathers its index. */
  const graphLibrary = (): GraphLibrary => {
    const links: GraphLibrary["links"][number][] = [];
    const wiki = (srcKind: "item" | "card" | "note", src: string, body: string) => {
      for (const target of new Set(scanWikiLinks(body).map((m) => m.target))) {
        const to = resolve(target);
        if (to)
          links.push({
            srcKind,
            src,
            toKind: to.kind,
            to: to.id,
            status: "accepted",
            origin: "wiki",
          });
      }
    };
    for (const n of notes.values()) {
      for (const l of n.frontmatter.links) {
        const to = resolve(typedTarget(l));
        if (!to) continue;
        links.push({
          srcKind: l.from ? "card" : "note",
          src: l.from ?? n.frontmatter.id,
          toKind: to.kind,
          to: to.id,
          rel: l.rel,
          status: l.status,
          why: l.why,
          evidence: l.evidence ? typedTarget({ ...l, to: l.evidence }) : undefined,
          by: l.by,
          origin: "frontmatter",
        });
      }
      wiki("note", n.frontmatter.id, n.body);
    }
    for (const [citekey, item] of data.items) wiki("item", citekey, item.note);
    return {
      items: [...data.items.values()].map((i) => ({
        citekey: i.frontmatter.citekey,
        title: i.frontmatter.title,
        short: shortOf(i.frontmatter.citekey),
        projects: i.frontmatter.projects,
      })),
      cards: data.cards.map((c) => ({
        id: c.frontmatter.id,
        item: c.frontmatter.item,
        kind: c.frontmatter.kind,
        quote: c.body.quote,
        page: c.frontmatter.locator?.start,
      })),
      notes: [...notes.values()].map((n) => ({
        id: n.frontmatter.id,
        slug: n.slug,
        type: n.frontmatter.type,
        title: n.frontmatter.title,
        projects: n.frontmatter.projects,
        body: n.body,
        by: n.frontmatter.created.by,
      })),
      links,
    };
  };

  const cardOf = (id: string) => {
    const card = data.cards.find((c) => c.frontmatter.id === id);
    if (!card) throw new Error(`CARD_NOT_FOUND: no card with id '${id}'`);
    return card;
  };

  /** The literature note of an item: the note with an `Item: [[citekey]]` line, made when missing. */
  const findLiterature = (citekey: string): MockNote | undefined =>
    [...notes.values()].find(
      (n) => n.frontmatter.type === "literature" && n.body.includes(`Item: [[${citekey}]]`),
    );
  const literatureNote = (citekey: string): MockNote => {
    const found = findLiterature(citekey);
    if (found) return found;
    const at = new Date().toISOString();
    const id = `n_9${String(notes.size + 1).padStart(15, "0")}`;
    const note: MockNote = {
      slug: `reading-notes-${citekey}`,
      body: `Item: [[${citekey}]]`,
      frontmatter: {
        id,
        type: "literature",
        title: `Reading notes (${citekey})`,
        links: [],
        tags: [],
        projects: [],
        created: { at, by: "human" },
      },
    };
    notes.set(id, note);
    return note;
  };

  const shortOf = (citekey: string): string => {
    const item = data.items.get(citekey);
    if (!item) return citekey;
    const authors = item.frontmatter.author ?? [];
    const names = authors.map((a) => ("family" in a ? a.family : a.literal));
    const label =
      names.length > 2 ? `${names[0]} et al.` : names.length === 2 ? names.join(" & ") : names[0];
    return [label, item.frontmatter.issued].filter(Boolean).join(" ");
  };

  const cardLinksOf = (citekey: string): CardLink[] => {
    const note = findLiterature(citekey);
    const out: CardLink[] = [];
    if (!note) return out;
    note.frontmatter.links.forEach((l, index) => {
      if (!l.from || l.status === "rejected") return;
      const node = resolve(typedTarget(l));
      if (!node) return;
      const targetCard =
        node.kind === "card" ? data.cards.find((c) => c.frontmatter.id === node.id) : undefined;
      const short =
        node.kind === "item"
          ? shortOf(node.id)
          : targetCard
            ? shortOf(targetCard.frontmatter.item)
            : node.label;
      out.push({
        card: l.from,
        note: note.frontmatter.id,
        index,
        to: node.id,
        kind: node.kind,
        label: node.label,
        short,
        ...(node.kind === "item" ? { citekey: node.id } : {}),
        ...(l.rel ? { rel: l.rel } : {}),
        ...(l.why ? { why: l.why } : {}),
        by: l.by,
        status: l.status as "proposed" | "accepted",
      });
    });
    return out;
  };

  /** Items whose author is named in the card text with a second sign: the given name or the year. */
  const mentions = (cardId: string): string[] => {
    const card = cardOf(cardId);
    const text = `${card.body.quote} ${card.body.paraphrase ?? ""}`;
    const known = new Set(
      cardLinksOf(card.frontmatter.item)
        .filter((l) => l.card === cardId)
        .map((l) => l.to),
    );
    const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "u");
    return [...data.items.values()]
      .filter((it) => it.frontmatter.citekey !== card.frontmatter.item)
      .filter((it) => !known.has(it.frontmatter.citekey))
      .filter((it) =>
        (it.frontmatter.author ?? []).some(
          (a) =>
            "family" in a &&
            a.family.length >= 3 &&
            word(a.family).test(text) &&
            ((a.given && word(a.given.split(" ")[0] ?? "").test(text)) ||
              word(String(it.frontmatter.issued ?? "x")).test(text)),
        ),
      )
      .map((it) => it.frontmatter.citekey);
  };

  const sameLink = (l: Link, card: string, target: string, rel: string | undefined) =>
    l.from === card && typedTarget(l) === target && l.rel === rel;

  const find = (id: string) => {
    const note = notes.get(id);
    if (!note) throw new Error(`NOTE_NOT_FOUND: no note with id '${id}'`);
    return note;
  };

  const propose = (note: MockNote): Link[] => {
    const have = new Set(note.frontmatter.links.map(typedTarget));
    const out: Link[] = [];
    let supported = false;
    for (const target of wikiTargets(note)) {
      const node = resolve(target);
      if (!node || node.id === note.frontmatter.id || have.has(target) || node.kind === "card") {
        continue;
      }
      const rel: Link["rel"] = node.kind === "item" && !supported ? "supports" : "related";
      supported ||= rel === "supports";
      const evidence =
        rel === "supports" ? data.cards.find((c) => c.frontmatter.item === node.id) : undefined;
      out.push({
        to: `[[${target}]]`,
        rel,
        why:
          rel === "supports"
            ? data.lang === "en"
              ? `The note relies on ${node.label}.`
              : `Die Notiz stützt sich auf ${node.label}.`
            : data.lang === "en"
              ? `The note refers to ${node.label} without naming the relationship.`
              : `Die Notiz verweist auf ${node.label}, ohne die Beziehung zu benennen.`,
        ...(evidence ? { evidence: `[[${evidence.frontmatter.id}]]` } : {}),
        by: "agent:mock",
        status: "proposed",
      });
    }
    return out;
  };

  return registry
    .bind(linksCreate, async (ctx, input) => {
      const to = typedTarget(input.link as Link);
      const node = resolve(to);
      if (!node) throw new Error(`LINK_TARGET_NOT_FOUND: nothing in the library is called ${to}`);
      const at = new Date().toISOString();
      if (input.from.startsWith("c_")) {
        const card = cardOf(input.from);
        const note = literatureNote(card.frontmatter.item);
        const rest = note.frontmatter.links.filter(
          (l) =>
            !sameLink(l, input.from, to, input.link.rel) &&
            !(l.from === input.from && typedTarget(l) === to && l.status === "proposed"),
        );
        note.frontmatter = {
          ...note.frontmatter,
          links: [
            ...rest,
            {
              ...input.link,
              from: input.from,
              evidence: input.link.evidence ?? `[[${input.from}]]`,
              by: ctx.actor,
              status: input.link.status ?? "accepted",
            },
          ],
          modified: { at, by: ctx.actor },
        };
        changed(note);
        return toNote(note);
      }
      const note = find(input.from);
      note.frontmatter = {
        ...note.frontmatter,
        links: [...note.frontmatter.links, { ...input.link, by: ctx.actor, status: "accepted" }],
        modified: { at, by: ctx.actor },
      };
      changed(note);
      return toNote(note);
    })
    .bind(linksRemove, async (ctx, input) => {
      const to = typedTarget({ to: input.to } as Link);
      const fromCard = input.from.startsWith("c_");
      const note = fromCard
        ? literatureNote(cardOf(input.from).frontmatter.item)
        : find(input.from);
      const hit = (l: Link) =>
        (fromCard ? l.from === input.from : !l.from) &&
        typedTarget(l) === to &&
        l.status !== "rejected" &&
        (input.rel === undefined || l.rel === input.rel);
      if (!note.frontmatter.links.some(hit)) {
        throw new Error(`LINK_NOT_FOUND: '${input.from}' has no link to '${input.to}'`);
      }
      note.frontmatter = {
        ...note.frontmatter,
        links: note.frontmatter.links.filter((l) => !hit(l)),
        modified: { at: new Date().toISOString(), by: ctx.actor },
      };
      changed(note);
      return toNote(note);
    })
    .bind(linksForCard, async (_ctx, input) => ({
      links: cardLinksOf(cardOf(input.card).frontmatter.item).filter((l) => l.card === input.card),
    }))
    .bind(linksForItem, async (_ctx, input) => ({ links: cardLinksOf(input.citekey) }))
    .bind(linksSuggest, async (_ctx, input) => {
      const card = cardOf(input.card);
      const now = new Date().toISOString();
      const job = { id: jobId(), status: "running" as const, createdAt: now, updatedAt: now };
      jobs.set(job.id, job);
      setTimeout(() => {
        const found = mentions(input.card).slice(0, 2);
        const at = new Date().toISOString();
        if (found.length > 0) {
          const note = literatureNote(card.frontmatter.item);
          note.frontmatter = {
            ...note.frontmatter,
            links: [
              ...note.frontmatter.links,
              ...found.map(
                (to): Link => ({
                  from: input.card,
                  to: `[[${to}]]`,
                  rel: "related",
                  why:
                    data.lang === "en"
                      ? `The card names ${shortOf(to)}.`
                      : `Die Karte nennt ${shortOf(to)}.`,
                  evidence: `[[${input.card}]]`,
                  by: "agent:mock",
                  status: "proposed",
                }),
              ),
            ],
            modified: { at, by: "agent:mock" },
          };
          changed(note);
        }
        jobs.set(job.id, { ...job, status: "succeeded", updatedAt: at });
      }, delayMs);
      return { job: job.id };
    })
    .bind(graphNeighbors, async (_ctx, input) => {
      const edges = allEdges().filter((e) => !input.rel || input.rel.some((r) => r === e.rel));
      const reached = new Set<string>([input.node]);
      let frontier = [input.node];
      for (let d = 0; d < input.depth; d++) {
        const next: string[] = [];
        for (const e of edges) {
          for (const [a, b] of [
            [e.from, e.to],
            [e.to, e.from],
          ] as const) {
            if (frontier.includes(a) && !reached.has(b)) {
              reached.add(b);
              next.push(b);
            }
          }
        }
        frontier = next;
      }
      const nodes = [...reached].flatMap((id) => {
        const node = resolve(id);
        return node ? [node] : [];
      });
      const known = new Set(nodes.map((n) => n.id));
      return {
        nodes,
        edges: edges.filter((e) => known.has(e.from) && known.has(e.to)),
      };
    })
    .bind(graphProject, async (_ctx, input) => {
      if (input.project && !data.projects.has(input.project)) {
        throw new Error(`PROJECT_NOT_FOUND: no project with slug '${input.project}'`);
      }
      let cited: string[] | undefined;
      if (input.text) {
        const text = input.project
          ? textsStoreFor(data).texts.get(input.project)?.get(input.text)
          : undefined;
        if (!text) throw new Error(`TEXT_NOT_FOUND: project has no text '${input.text}'`);
        cited = citedKeys(text.body);
      }
      const graph = buildSemanticGraph(graphLibrary(), {
        project: input.around ? undefined : input.project,
        cited: input.around ? undefined : cited,
        around: input.around,
        depth: input.depth,
        proposed: input.proposed,
      });
      return { ...graph, edges: aggregateGraph(graph, { expanded: input.expand }).edges };
    })
    .bind(linksPropose, async (_ctx, input) => {
      const note = find(input.note);
      const now = new Date().toISOString();
      const job = { id: jobId(), status: "running" as const, createdAt: now, updatedAt: now };
      jobs.set(job.id, job);
      setTimeout(() => {
        const found = propose(note);
        const at = new Date().toISOString();
        if (found.length > 0) {
          note.frontmatter = {
            ...note.frontmatter,
            links: [...note.frontmatter.links, ...found],
            modified: { at, by: "agent:mock" },
          };
          changed(note);
        }
        jobs.set(job.id, { ...job, status: "succeeded", updatedAt: at });
      }, delayMs);
      return { job: job.id };
    })
    .bind(linksDecide, async (_ctx, input) => {
      const note = find(input.note);
      const links = note.frontmatter.links;
      for (const i of [...input.accept, ...input.reject]) {
        if (!links[i]) throw new Error(`LINK_INDEX_INVALID: note has no link at index ${i}`);
        if (links[i].status !== "proposed") {
          throw new Error(`LINK_NOT_PROPOSED: link ${i} is already accepted`);
        }
      }
      const next = links.map((l, i) =>
        input.accept.includes(i)
          ? { ...l, status: "accepted" as const }
          : input.reject.includes(i)
            ? { ...l, status: "rejected" as const }
            : l,
      );
      note.frontmatter = {
        ...note.frontmatter,
        links: next,
        modified: { at: new Date().toISOString(), by: "human" },
      };
      changed(note);
      return toNote(note);
    });
}

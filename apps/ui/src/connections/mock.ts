import { scanWikiLinks } from "@citegeist/editor";
import { graphNeighbors, linksDecide, linksPropose, type Registry } from "@citegeist/ops";
import type { Link } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";
import { type MockNote, storeFor, toNote } from "../notes/mock";
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

const typedTarget = (link: Link) => link.to.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? link.to;

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
          edges.push({ from, to: to.id, rel: link.rel ?? "related", status: link.status });
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
            ? `Die Notiz stützt sich auf ${node.label}.`
            : `Die Notiz verweist auf ${node.label}, ohne die Beziehung zu benennen.`,
        ...(evidence ? { evidence: `[[${evidence.frontmatter.id}]]` } : {}),
        by: "agent:mock",
        status: "proposed",
      });
    }
    return out;
  };

  return registry
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

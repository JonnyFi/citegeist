import {
  cardsList,
  inboxAccept,
  inboxReject,
  itemsGet,
  itemsList,
  itemsUpdate,
  libraryStatus,
  projectsGet,
  projectsList,
  Registry,
  searchQuery,
} from "@citegeist/ops";
import type { ItemFrontmatter } from "@citegeist/schema";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";
import { createFixtures, type MockData } from "./fixtures";

function authorsOf(fm: ItemFrontmatter): string | undefined {
  const names = (fm.author ?? []).map((a) => ("family" in a ? a.family : a.literal));
  return names.length > 0 ? names.join(", ") : undefined;
}

function summary(fm: ItemFrontmatter) {
  const authors = authorsOf(fm);
  return {
    citekey: fm.citekey,
    title: fm.title,
    ...(fm.issued !== undefined ? { year: String(fm.issued).slice(0, 4) } : {}),
    ...(authors ? { authors } : {}),
    type: fm.type,
    status: fm.status,
    inbox: fm.inbox !== undefined,
  };
}

function snippetAround(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, 120);
  const from = Math.max(0, at - 40);
  return `${from > 0 ? "..." : ""}${text.slice(from, at + needle.length + 80)}`;
}

/** Registry over in-memory fixture data. Same contracts as the real core, so the UI cannot tell. */
export function createMockRegistry(data: MockData, emit: (e: CoreEvent) => void): Registry {
  const changed = (path: string) => emit({ type: "change", path, external: false });

  return new Registry()
    .bind(libraryStatus, async () => ({
      path: "/mock/library",
      items: data.items.size,
      cards: data.cards.length,
      notes: 0,
      problems: [],
    }))
    .bind(itemsList, async (_ctx, input) => {
      const all = [...data.items.values()]
        .map((i) => i.frontmatter)
        .filter((fm) => (input.project ? fm.projects.includes(input.project) : true))
        .filter((fm) => (input.status ? fm.status === input.status : true))
        .filter((fm) => (input.tags ? input.tags.every((t) => fm.tags.includes(t)) : true))
        .filter((fm) =>
          input.inbox === undefined ? true : (fm.inbox !== undefined) === input.inbox,
        )
        .sort((a, b) => a.citekey.localeCompare(b.citekey))
        .filter((fm) => (input.cursor ? fm.citekey > input.cursor : true));
      const page = all.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(summary),
        ...(all.length > input.limit && last ? { next: last.citekey } : {}),
      };
    })
    .bind(itemsGet, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      return {
        frontmatter: item.frontmatter,
        note: item.note,
        cards: data.cards.filter((c) => c.frontmatter.item === input.citekey).length,
        path: `/mock/library/items/${input.citekey}/${input.citekey}.md`,
      };
    })
    .bind(itemsUpdate, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      item.frontmatter = { ...item.frontmatter, ...input.patch } as ItemFrontmatter;
      changed(`items/${input.citekey}/${input.citekey}.md`);
      return { frontmatter: item.frontmatter };
    })
    .bind(inboxAccept, async (_ctx, input) => {
      for (const key of input.citekeys) {
        const item = data.items.get(key);
        if (item) {
          const { inbox: _inbox, ...rest } = item.frontmatter;
          item.frontmatter = rest as ItemFrontmatter;
          changed(`items/${key}/${key}.md`);
        }
      }
      return { ok: true as const };
    })
    .bind(inboxReject, async (_ctx, input) => {
      for (const key of input.citekeys) {
        data.items.delete(key);
        changed(`items/${key}/${key}.md`);
      }
      return { ok: true as const };
    })
    .bind(cardsList, async (_ctx, input) => {
      const q = input.query?.toLowerCase();
      const cards = data.cards
        .filter((c) => (input.citekey ? c.frontmatter.item === input.citekey : true))
        .filter((c) => (input.kind ? c.frontmatter.kind === input.kind : true))
        .filter((c) => (input.project ? c.frontmatter.projects.includes(input.project) : true))
        .filter((c) => (q ? JSON.stringify(c.body).toLowerCase().includes(q) : true));
      return { cards: cards.slice(0, input.limit) };
    })
    .bind(projectsList, async () => ({
      projects: [...data.projects.values()].map((p) => p.frontmatter),
    }))
    .bind(projectsGet, async (_ctx, input) => {
      const project = data.projects.get(input.slug);
      if (!project) throw new Error(`PROJECT_NOT_FOUND: no project with slug '${input.slug}'`);
      return {
        ...project,
        items: [...data.items.values()].filter((i) => i.frontmatter.projects.includes(input.slug))
          .length,
      };
    })
    .bind(searchQuery, async (_ctx, input) => {
      const q = input.q.toLowerCase();
      const hits: Array<{
        kind: "item" | "card";
        id: string;
        citekey: string;
        title: string;
        snippet: string;
        page?: string;
        score: number;
      }> = [];
      for (const { frontmatter: fm, note } of data.items.values()) {
        if (input.project && !fm.projects.includes(input.project)) continue;
        if (input.status && fm.status !== input.status) continue;
        const haystack = `${fm.title} ${authorsOf(fm) ?? ""} ${fm.abstract ?? ""} ${note}`;
        if (input.kinds.includes("item") && haystack.toLowerCase().includes(q)) {
          hits.push({
            kind: "item",
            id: fm.id,
            citekey: fm.citekey,
            title: fm.title,
            snippet: snippetAround(haystack, q),
            score: fm.title.toLowerCase().includes(q) ? 2 : 1,
          });
        }
      }
      for (const c of data.cards) {
        const text = `${c.body.quote} ${c.body.paraphrase ?? ""} ${c.body.core ?? ""}`;
        if (!input.kinds.includes("card") || !text.toLowerCase().includes(q)) continue;
        const owner = data.items.get(c.frontmatter.item);
        if (!owner) continue;
        if (input.project && !c.frontmatter.projects.includes(input.project)) continue;
        hits.push({
          kind: "card",
          id: c.frontmatter.id,
          citekey: c.frontmatter.item,
          title: owner.frontmatter.title,
          snippet: snippetAround(text, q),
          ...(c.frontmatter.locator ? { page: c.frontmatter.locator.start } : {}),
          score: 1.5,
        });
      }
      return { hits: hits.sort((a, b) => b.score - a.score).slice(0, input.limit) };
    });
}

/** A Core backed by fixture data, running entirely in the page. Used by `dev:mock` and by tests. */
export function createMockCore(data: MockData = createFixtures()): Core {
  const listeners = new Set<(e: CoreEvent) => void>();
  const registry = createMockRegistry(data, (e) => {
    for (const l of listeners) l(e);
  });
  return coreFromLink(
    {
      async call(path, input) {
        return registry.call(path.join("."), { actor: "human" }, input);
      },
    },
    {
      label: "mock library",
      isMock: true,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  );
}

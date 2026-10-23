import {
  cardsCreate,
  cardsExport,
  cardsList,
  cardsRegenerate,
  cardsUpdate,
  citeFormat,
  documentsAssets,
  documentsConfirmPages,
  inboxAccept,
  inboxReject,
  itemsGet,
  itemsList,
  itemsUpdate,
  jobsGet,
  libraryStatus,
  projectsGet,
  projectsList,
  projectsUpdate,
  Registry,
  searchQuery,
} from "@citegeist/ops";
import { CardFrontmatter, type ItemFrontmatter, ProjectFrontmatter } from "@citegeist/schema";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";
import { bindSettingsMock, createSettingsMockState } from "../routes/settings-mock";
import { createFixtures, type MockData } from "./fixtures";

export interface MockOptions {
  /** How long the mock AI needs for paraphrase and core statement. The real one takes a few seconds. */
  aiDelayMs?: number;
}

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
    ...(fm.inbox ? { inboxBy: fm.inbox.by } : {}),
    ...(fm.inbox?.why ? { inboxWhy: fm.inbox.why } : {}),
  };
}

function snippetAround(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, 120);
  const from = Math.max(0, at - 40);
  return `${from > 0 ? "..." : ""}${text.slice(from, at + needle.length + 80)}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomId(prefix: string): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `${prefix}${out}`;
}

interface MockJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
}

function surname(fm: ItemFrontmatter): string {
  const first = fm.author?.[0];
  if (!first) return fm.title;
  return "family" in first ? first.family : first.literal;
}

function citationLabel(fm: ItemFrontmatter, locator: string | undefined): string {
  const year = fm.issued !== undefined ? ` ${String(fm.issued).slice(0, 4)}` : "";
  return `${surname(fm)}${year}${locator ? `, S. ${locator}` : ""}`;
}

function firstSentence(text: string): string {
  const m = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/** What the mock AI writes: obviously machine text, in the requested language. */
function mockAiText(quote: string, language: string) {
  const lead = firstSentence(quote);
  return {
    paraphrase: language === "de" ? `Sinngemäß: ${lead}` : `In other words (${language}): ${lead}`,
    core: lead.length > 90 ? `${lead.slice(0, 87)}...` : lead,
  };
}

function bibtexOf(fm: ItemFrontmatter): string {
  const authors = (fm.author ?? [])
    .map((a) => ("family" in a ? `${a.family}${a.given ? `, ${a.given}` : ""}` : a.literal))
    .join(" and ");
  const kind =
    fm.type === "book" ? "book" : fm.type === "paper-conference" ? "inproceedings" : "article";
  const fields = [
    ["author", authors],
    ["title", fm.title],
    ["year", fm.issued !== undefined ? String(fm.issued).slice(0, 4) : ""],
    ["publisher", fm.publisher ?? ""],
    ["booktitle", fm["container-title"] ?? ""],
    ["doi", fm.DOI ?? ""],
  ].filter(([, v]) => v);
  return `@${kind}{${fm.citekey},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
}

function cslJsonOf(fm: ItemFrontmatter): Record<string, unknown> {
  return {
    id: fm.citekey,
    type: fm.type,
    title: fm.title,
    ...(fm.author ? { author: fm.author } : {}),
    ...(fm.issued !== undefined
      ? { issued: { "date-parts": [[Number(String(fm.issued).slice(0, 4))]] } }
      : {}),
    ...(fm.publisher ? { publisher: fm.publisher } : {}),
    ...(fm["container-title"] ? { "container-title": fm["container-title"] } : {}),
    ...(fm.DOI ? { DOI: fm.DOI } : {}),
  };
}

/** Registry over in-memory fixture data. Same contracts as the real core, so the UI cannot tell. */
export function createMockRegistry(
  data: MockData,
  emit: (e: CoreEvent) => void,
  options: MockOptions = {},
): Registry {
  const changed = (path: string) => emit({ type: "change", path, external: false });
  const aiDelayMs = options.aiDelayMs ?? 1500;
  const jobs = new Map<string, MockJob>();

  /** Starts a fake AI job that fills paraphrase and core statement after the delay. */
  const scheduleAi = (cardId: string, language: string): string => {
    const now = new Date().toISOString();
    const job: MockJob = { id: randomId("j_"), status: "running", createdAt: now, updatedAt: now };
    jobs.set(job.id, job);
    setTimeout(() => {
      const card = data.cards.find((c) => c.frontmatter.id === cardId);
      const at = new Date().toISOString();
      if (card) {
        card.body = { ...card.body, ...mockAiText(card.body.quote, language) };
        const stamp = { by: "claude-code/haiku", at, language };
        card.frontmatter = {
          ...card.frontmatter,
          paraphrase: stamp,
          core: stamp,
          modified: { at, by: "human" },
        };
        changed(`items/${card.frontmatter.item}/cards/${cardId}.md`);
      }
      job.status = "succeeded";
      job.updatedAt = at;
    }, aiDelayMs);
    return job.id;
  };

  const findCard = (id: string) => {
    const card = data.cards.find((c) => c.frontmatter.id === id);
    if (!card) throw new Error(`CARD_NOT_FOUND: no card with id '${id}'`);
    return card;
  };

  const registry = new Registry()
    .bind(libraryStatus, async () => ({
      path: "/mock/library",
      items: data.items.size,
      cards: data.cards.length,
      notes: 0,
      problems: [],
      defaults: { ai_language: "de", style: "apa", locale: "de-DE" },
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
    .bind(projectsUpdate, async (_ctx, input) => {
      const project = data.projects.get(input.slug);
      if (!project) throw new Error(`PROJECT_NOT_FOUND: no project with slug '${input.slug}'`);
      project.frontmatter = ProjectFrontmatter.parse({ ...project.frontmatter, ...input.patch });
      if (input.brief !== undefined) project.brief = input.brief;
      changed(`projects/${input.slug}/project.md`);
      return { frontmatter: project.frontmatter, brief: project.brief };
    })
    .bind(documentsAssets, async (_ctx, input) => {
      const doc = data.docs.get(input.citekey);
      if (!doc) {
        throw new Error(
          `NO_SOURCE_FILES: '${input.citekey}' has no converted source in the mock library`,
        );
      }
      return {
        source: doc.source,
        kind: doc.pdfUrl ? "pdf" : "web",
        ...(doc.pdfUrl ? { pdfUrl: doc.pdfUrl } : {}),
        html: doc.html,
        blocks: doc.blocks,
        pages: doc.pages,
      };
    })
    .bind(documentsConfirmPages, async (_ctx, input) => {
      const doc = data.docs.get(input.citekey);
      if (!doc || doc.source !== input.source) {
        throw new Error(`SOURCE_NOT_FOUND: '${input.citekey}' has no source '${input.source}'`);
      }
      doc.pages = {
        ...doc.pages,
        confirmed: true,
        pages: doc.pages.pages.map((p) => {
          let label = p.label;
          let labelSource = p.labelSource;
          if (input.offset !== undefined) {
            label = String(p.index + 1 + input.offset);
            labelSource = "user";
          }
          const explicit = input.labels?.[String(p.index)];
          if (explicit !== undefined) {
            label = explicit;
            labelSource = "user";
          }
          return { ...p, label, labelSource };
        }),
      };
      let cardsUpdated = 0;
      for (const card of data.cards) {
        if (card.frontmatter.item !== input.citekey || !card.frontmatter.locator) continue;
        const page = card.frontmatter.anchor.pdf?.page;
        const label = page === undefined ? undefined : doc.pages.pages[page]?.label;
        card.frontmatter = {
          ...card.frontmatter,
          locator: {
            ...card.frontmatter.locator,
            ...(label ? { start: label } : {}),
            confirmed: true,
          },
        };
        cardsUpdated += 1;
      }
      changed(`items/${input.citekey}/derived/${input.source}/pages.json`);
      return { cardsUpdated };
    })
    .bind(cardsCreate, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      const quote = input.quote.trim();
      const doc = data.docs.get(input.citekey);
      const exact = input.anchor.text?.exact ?? quote;
      const block = doc?.blocks.find(
        (b) => b.id === input.anchor.text?.block || b.text.includes(exact),
      );
      const pageIndex = input.anchor.pdf?.page ?? block?.spans[0]?.page;
      const label =
        pageIndex === undefined
          ? undefined
          : (doc?.pages.pages[pageIndex]?.label ?? block?.spans[0]?.label ?? undefined);
      const frontmatter = CardFrontmatter.parse({
        id: randomId("c_"),
        item: input.citekey,
        ...(doc ? { source: doc.source } : {}),
        kind: input.kind,
        ...(label
          ? { locator: { label: "page", start: label, confirmed: doc?.pages.confirmed ?? false } }
          : {}),
        anchor: input.anchor,
        quote_sha256: "0".repeat(64),
        tags: input.tags,
        projects: input.projects,
        created: { at: new Date().toISOString(), by: "human" },
      });
      const card = { frontmatter, body: { quote, extra: [] } };
      data.cards.push(card);
      changed(`items/${input.citekey}/cards/${frontmatter.id}.md`);
      if (!input.ai) return { card };
      const language =
        input.language ??
        item.frontmatter.ai_language ??
        [...input.projects, ...item.frontmatter.projects]
          .map((slug) => data.projects.get(slug)?.frontmatter.ai_language)
          .find((l) => l !== undefined) ??
        "de";
      return { card, job: scheduleAi(frontmatter.id, language) };
    })
    .bind(cardsUpdate, async (_ctx, input) => {
      if ("quote" in input.patch) {
        throw new Error("CARD_QUOTE_IMMUTABLE: the verbatim quote of a card never changes");
      }
      const card = findCard(input.id);
      const { kind, tags, locator, ownWords, comment, paraphrase, core } = input.patch;
      card.frontmatter = {
        ...card.frontmatter,
        ...(kind ? { kind } : {}),
        ...(tags ? { tags } : {}),
        ...(locator && card.frontmatter.locator
          ? {
              locator: {
                ...card.frontmatter.locator,
                ...(Object.fromEntries(
                  Object.entries(locator).filter(([, v]) => v !== undefined),
                ) as Partial<typeof card.frontmatter.locator>),
              },
            }
          : {}),
        modified: { at: new Date().toISOString(), by: "human" },
      };
      card.body = {
        ...card.body,
        ...(ownWords !== undefined ? { ownWords } : {}),
        ...(comment !== undefined ? { comment } : {}),
        ...(paraphrase !== undefined ? { paraphrase } : {}),
        ...(core !== undefined ? { core } : {}),
      };
      changed(`items/${card.frontmatter.item}/cards/${card.frontmatter.id}.md`);
      return { card };
    })
    .bind(cardsRegenerate, async (_ctx, input) => {
      const card = findCard(input.id);
      const item = data.items.get(card.frontmatter.item);
      const language =
        input.language ??
        card.frontmatter.paraphrase?.language ??
        item?.frontmatter.ai_language ??
        "de";
      return { job: scheduleAi(input.id, language) };
    })
    .bind(cardsExport, async (_ctx, input) => {
      const lines: string[] = [];
      const htmls: string[] = [];
      for (const id of input.ids) {
        const card = findCard(id);
        const item = data.items.get(card.frontmatter.item);
        if (!item) continue;
        const loc = card.frontmatter.locator?.start;
        const quote = card.body.quote;
        const own = card.body.ownWords ?? card.body.paraphrase ?? card.body.core ?? quote;
        if (input.format === "pandoc") {
          const at = `@${item.frontmatter.citekey}${loc ? `, S. ${loc}` : ""}`;
          lines.push(input.mode === "direct" ? `"${quote}" [${at}]` : `${own} [vgl. ${at}]`);
          continue;
        }
        const label = citationLabel(item.frontmatter, loc);
        if (input.mode === "direct") {
          lines.push(`„${quote}“ (${label})`);
          htmls.push(`<blockquote>„${quote}“</blockquote><p>(${label})</p>`);
        } else {
          lines.push(`${own} (vgl. ${label})`);
          htmls.push(`<p>${own} (vgl. ${label})</p>`);
        }
      }
      return {
        text: lines.join("\n\n"),
        ...(input.format === "html" ? { html: htmls.join("\n") } : {}),
      };
    })
    .bind(citeFormat, async (_ctx, input) => {
      const items = input.items.flatMap((i) => {
        const found = data.items.get(i.citekey);
        return found ? [{ fm: found.frontmatter, locator: i.locator }] : [];
      });
      if (input.mode === "bibliography" && input.format === "bibtex") {
        return { text: items.map((i) => bibtexOf(i.fm)).join("\n\n") };
      }
      if (input.mode === "bibliography" && input.format === "csl-json") {
        return {
          text: JSON.stringify(
            items.map((i) => cslJsonOf(i.fm)),
            null,
            2,
          ),
        };
      }
      if (input.mode === "bibliography") {
        return {
          text: items
            .map(
              (i) =>
                `${surname(i.fm)} (${String(i.fm.issued ?? "o. J.").slice(0, 4)}). ${i.fm.title}.`,
            )
            .join("\n"),
        };
      }
      return { text: `(${items.map((i) => citationLabel(i.fm, i.locator)).join("; ")})` };
    })
    .bind(jobsGet, async (_ctx, input) => {
      const job = jobs.get(input.job);
      if (!job) throw new Error(`JOB_NOT_FOUND: no job '${input.job}'`);
      return {
        id: job.id,
        kind: "ai-task" as const,
        status: job.status,
        progress: job.status === "running" ? 0.5 : 1,
        input: {},
        attempts: 1,
        by: "human" as const,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
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
  // The browser preview has a working backend and worker, so it never asks for the setup.
  const settings = createSettingsMockState({ worker: { ready: true, engines: { mock: "1.0" } } });
  return bindSettingsMock(registry, settings, emit, false);
}

/** A Core backed by fixture data, running entirely in the page. Used by `dev:mock` and by tests. */
export function createMockCore(data: MockData = createFixtures(), options: MockOptions = {}): Core {
  const listeners = new Set<(e: CoreEvent) => void>();
  const registry = createMockRegistry(
    data,
    (e) => {
      for (const l of listeners) l(e);
    },
    options,
  );
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

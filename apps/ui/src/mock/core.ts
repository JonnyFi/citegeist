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
  itemsAdd,
  itemsAttach,
  itemsGet,
  itemsList,
  itemsRename,
  itemsRestore,
  itemsTrash,
  itemsUpdate,
  jobsGet,
  libraryStatus,
  projectsAddItems,
  projectsCreate,
  projectsGet,
  projectsList,
  projectsRemoveItems,
  projectsUpdate,
  Registry,
  searchQuery,
  summarizeRetraction,
} from "@citegeist/ops";
import {
  CardFrontmatter,
  ItemFrontmatter,
  type Job,
  ProjectFrontmatter,
  paragraphLocator,
  paragraphNumbers,
} from "@citegeist/schema";
import { bindAlertsMock, createAlertsMockState } from "../alerts/mock";
import { bindChatMock } from "../chat/mock";
import { bindConceptsMock } from "../concepts/mock";
import { bindConnectionsMock } from "../connections/mock";
import type { Lang } from "../i18n";
import { bindImportMock, createImportMockState, type ImportMockJobs } from "../import/mock";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";
import { classifyIdentifier } from "../lib/identifier";
import { bindLitsearchMock, createLitsearchMockState } from "../litsearch/mock";
import { bindMatrixMock } from "../matrix/mock";
import { bindNotesMock } from "../notes/mock";
import { bindPlanningMock } from "../planning/mock";
import { bindRelatedMock } from "../related";
import { bindSettingsMock, createSettingsMockState, sampleUsage } from "../routes/settings-mock";
import {
  bindSyncMock,
  bindWebhooksMock,
  createSyncMockState,
  createWebhooksMockState,
  mockConflict,
} from "../settings/mock";
import { bindTextsMock } from "../texts/mock";
import { suggestMockCitekey } from "./citekey";
import { createFixtures, type MockData } from "./fixtures";

export interface MockOptions {
  /** How long the mock AI needs for the paraphrase. The real one takes a few seconds. */
  aiDelayMs?: number;
  /** Seeds the job list with finished and running conversions, so the top bar has something to show. */
  demoJobs?: boolean;
  /**
   * Items added by items.add are recognised as the work of this citekey only after the job ran:
   * the new item disappears and the job result names this one, as after a late PDF merge.
   */
  mergeNewInto?: string;
}

function authorsOf(fm: ItemFrontmatter): string | undefined {
  const names = (fm.author ?? []).map((a) => ("family" in a ? a.family : a.literal));
  return names.length > 0 ? names.join(", ") : undefined;
}

function summary(fm: ItemFrontmatter) {
  const authors = authorsOf(fm);
  const retraction = summarizeRetraction((fm as Record<string, unknown>).retraction);
  return {
    citekey: fm.citekey,
    title: fm.title,
    ...(fm.issued !== undefined ? { year: String(fm.issued).slice(0, 4) } : {}),
    ...(authors ? { authors } : {}),
    type: fm.type,
    status: fm.status,
    inbox: fm.inbox !== undefined,
    ...(fm.projects.length > 0 ? { projects: fm.projects } : {}),
    ...(fm.inbox ? { inboxBy: fm.inbox.by } : {}),
    ...(fm.inbox?.why ? { inboxWhy: fm.inbox.why } : {}),
    ...(fm.incomplete
      ? { incomplete: true, incompleteReason: `${fm.incomplete.code}: ${fm.incomplete.message}` }
      : {}),
    ...(fm.fulltext ? { fulltext: fm.fulltext.status } : {}),
    ...(retraction ? { retraction } : {}),
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
  /** Share of the work done, 0 to 1. Without it a running job reports one half. */
  progress?: number;
  result?: unknown;
}

function surname(fm: ItemFrontmatter): string {
  const first = fm.author?.[0];
  if (!first) return fm.title;
  return "family" in first ? first.family : first.literal;
}

function citationLabel(
  fm: ItemFrontmatter,
  locator: string | undefined,
  lang: Lang = "de",
): string {
  const year = fm.issued !== undefined ? ` ${String(fm.issued).slice(0, 4)}` : "";
  return `${surname(fm)}${year}${locator ? `, ${lang === "en" ? "p." : "S."} ${locator}` : ""}`;
}

const LOCATOR_TERMS = {
  en: { page: "p.", paragraph: "para." },
  de: { page: "S.", paragraph: "Abs." },
} as const;

/** Mirrors the sentence punctuation of the real card export (packages/cite/src/cardexport.ts). */
function sentenceEnd(text: string, kind: "quote" | "paraphrase"): { text: string; tail: string } {
  const trimmed = text.trim();
  if (/(\.{2,}|\u2026)$/.test(trimmed)) return { text: trimmed, tail: "" };
  if (kind === "paraphrase") {
    const mark = /[.!?]+$/.exec(trimmed)?.[0] ?? "";
    return { text: trimmed.slice(0, trimmed.length - mark.length).trimEnd(), tail: mark };
  }
  if (trimmed.endsWith(".")) return { text: trimmed.slice(0, -1).trimEnd(), tail: "." };
  return { text: trimmed, tail: /[!?]$/.test(trimmed) ? "." : "" };
}

/** "p. 31" or "Abs. 4": the locator term of a language (mock of the CSL terms). */
function locatorTerm(label: string | undefined, lang: Lang): string {
  const terms = LOCATOR_TERMS[lang];
  return label === "paragraph" ? terms.paragraph : terms.page;
}

function langOf(locale: string | undefined, fallback: Lang): Lang {
  if (!locale) return fallback;
  return locale.toLowerCase().startsWith("en") ? "en" : "de";
}

/**
 * The in-text citation of the mock in a style: APA and DGPs "(Luhmann, 1984, S. 31)", Chicago
 * "(Luhmann 1984, 31)". Without a style it keeps the plain form "(Luhmann 1984, S. 31)".
 */
function styledCitation(
  fm: ItemFrontmatter,
  ref: { locator?: string | undefined; label?: string | undefined; prefix?: string | undefined },
  style: string | undefined,
  lang: Lang,
): string {
  const year = fm.issued !== undefined ? String(fm.issued).slice(0, 4) : undefined;
  const chicago = style === "chicago-author-date";
  const head = year ? `${surname(fm)}${style && !chicago ? "," : ""} ${year}` : surname(fm);
  const where = ref.locator
    ? chicago
      ? `, ${ref.locator}`
      : `, ${locatorTerm(ref.label, lang)} ${ref.locator}`
    : "";
  const prefix = ref.prefix ? `${ref.prefix} ` : "";
  return `(${prefix}${head}${where})`;
}

function firstSentence(text: string): string {
  const m = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/** What the mock AI writes: obviously machine text, in the requested language, with a kind. */
function mockAiText(quote: string, language: string) {
  const lead = firstSentence(quote);
  return {
    paraphrase: language === "de" ? `Sinngemäß: ${lead}` : `In other words (${language}): ${lead}`,
    kind: "thesis" as const,
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
  let importJobs: ImportMockJobs | undefined;
  /** Items moved to the trash, newest last; items.restore takes the latest of a citekey back. */
  const requireProject = (slug: string) => {
    if (!data.projects.has(slug)) {
      throw new Error(`PROJECT_NOT_FOUND: no project with slug '${slug}'`);
    }
  };
  /** projects.addItems and projects.removeItems: all checks first, then the writes. */
  const changeMembers = (
    mode: "add" | "remove",
    input: { slug: string; citekeys: string[] },
  ): { added: string[]; removed: string[]; unchanged: string[] } => {
    requireProject(input.slug);
    const keys = [...new Set(input.citekeys)];
    for (const key of keys) {
      if (!data.items.has(key)) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${key}'`);
    }
    const out = { added: [] as string[], removed: [] as string[], unchanged: [] as string[] };
    for (const key of keys) {
      const item = data.items.get(key);
      if (!item) continue;
      const has = item.frontmatter.projects.includes(input.slug);
      if (has === (mode === "add")) {
        out.unchanged.push(key);
        continue;
      }
      item.frontmatter = {
        ...item.frontmatter,
        projects:
          mode === "add"
            ? [...item.frontmatter.projects, input.slug]
            : item.frontmatter.projects.filter((p) => p !== input.slug),
      } as ItemFrontmatter;
      (mode === "add" ? out.added : out.removed).push(key);
      changed(`items/${key}/${key}.md`);
    }
    return out;
  };
  const trashed: Array<{
    citekey: string;
    item: NonNullable<ReturnType<MockData["items"]["get"]>>;
  }> = [];

  /** Starts a fake AI job that fills the paraphrase and, if unset, the kind after the delay. */
  const scheduleAi = (cardId: string, language: string): string => {
    const now = new Date().toISOString();
    const job: MockJob = { id: randomId("j_"), status: "running", createdAt: now, updatedAt: now };
    jobs.set(job.id, job);
    setTimeout(() => {
      const card = data.cards.find((c) => c.frontmatter.id === cardId);
      const at = new Date().toISOString();
      if (card) {
        const ai = mockAiText(card.body.quote, language);
        card.body = { ...card.body, paraphrase: ai.paraphrase };
        const stamp = { by: "claude-code/haiku", at, language };
        card.frontmatter = {
          ...card.frontmatter,
          paraphrase: stamp,
          kind: card.frontmatter.kind ?? ai.kind,
          modified: { at, by: "human" },
        };
        changed(`items/${card.frontmatter.item}/cards/${cardId}.md`);
      }
      job.status = "succeeded";
      job.updatedAt = at;
    }, aiDelayMs);
    return job.id;
  };

  /** Jobs of the card AI and, for the browser preview, a few conversions to fill the job slot. */
  const listJobs = (): Job[] => {
    const now = new Date().toISOString();
    const demo: Job[] = options.demoJobs
      ? (["succeeded", "succeeded", "running"] as const).map((status, i) => ({
          id: `j_0DEM00000000000${i}`,
          kind: "convert",
          status,
          progress: status === "running" ? 0.5 : 1,
          input: {},
          attempts: 1,
          by: "system",
          createdAt: now,
          updatedAt: now,
        }))
      : [];
    const own: Job[] = [...jobs.values()].map((job) => ({
      id: job.id,
      kind: "ai-task",
      status: job.status,
      progress: job.progress ?? (job.status === "running" ? 0.5 : 1),
      input: {},
      attempts: 1,
      by: "human",
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
    return [...demo, ...own, ...(importJobs?.list() ?? [])];
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
      defaults: {
        ai_language: data.lang,
        style: "apa",
        locale: data.lang === "en" ? "en-US" : "de-DE",
      },
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
    .bind(itemsAdd, async (_ctx, input) => {
      if (input.identifier === undefined) {
        const existing = input.citekey ? data.items.get(input.citekey) : undefined;
        if (!existing || input.projects.length === 0) {
          throw new Error("IDENTIFIER_MISSING: pass an identifier, or a citekey with projects");
        }
        for (const slug of input.projects) requireProject(slug);
        existing.frontmatter = {
          ...existing.frontmatter,
          projects: [...new Set([...existing.frontmatter.projects, ...input.projects])],
        } as ItemFrontmatter;
        changed(`items/${existing.frontmatter.citekey}/${existing.frontmatter.citekey}.md`);
        const stamp = new Date().toISOString();
        const job: MockJob = {
          id: randomId("j_"),
          status: "succeeded",
          createdAt: stamp,
          updatedAt: stamp,
        };
        jobs.set(job.id, job);
        return { citekey: existing.frontmatter.citekey, job: job.id };
      }
      const { kind, value } = classifyIdentifier(input.identifier);
      if (kind === "unknown") {
        throw new Error(
          `UNRECOGNIZED_IDENTIFIER: '${input.identifier}' is no DOI, arXiv id, ISBN, PMID, URL or file path`,
        );
      }
      const doi = kind === "doi" ? value.replace(/^.*?(10\.)/i, "$1").toLowerCase() : undefined;
      const duplicate = [...data.items.values()].find((i) =>
        doi ? i.frontmatter.DOI?.toLowerCase() === doi : i.frontmatter.URL === value,
      );
      const stamp = new Date().toISOString();
      const job: MockJob = {
        id: randomId("j_"),
        status: "running",
        createdAt: stamp,
        updatedAt: stamp,
      };
      jobs.set(job.id, job);
      let onDone: (() => void) | undefined;
      setTimeout(() => {
        onDone?.();
        job.status = "succeeded";
        job.updatedAt = new Date().toISOString();
      }, aiDelayMs);
      if (duplicate) {
        const key = duplicate.frontmatter.citekey;
        return { citekey: key, job: job.id, duplicateOf: key };
      }
      const stem = value
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.pdf$/i, "")
        .replace(/[^a-z0-9]+/gi, "")
        .toLowerCase();
      let citekey = `${kind}${(doi ?? stem ?? "").replace(/[^a-z0-9]+/g, "").slice(-12)}`;
      for (let n = 2; data.items.has(citekey); n++) citekey = `${citekey}${n}`;
      data.items.set(citekey, {
        note: "",
        frontmatter: ItemFrontmatter.parse({
          id: randomId(""),
          citekey,
          type: kind === "isbn" ? "book" : "article",
          title:
            kind === "path"
              ? (stem ?? value)
              : `${data.lang === "en" ? "Source" : "Quelle"} ${value}`,
          ...(doi ? { DOI: doi } : {}),
          ...(kind === "url" ? { URL: value } : {}),
          tags: input.tags,
          projects: input.projects,
          status: "unread",
          created: { at: stamp, by: "human" },
          ...(input.target === "inbox"
            ? { inbox: { by: "human", ...(input.why ? { why: input.why } : {}) } }
            : {}),
        }),
      });
      changed(`items/${citekey}/${citekey}.md`);
      const into = options.mergeNewInto;
      if (into && data.items.has(into)) {
        onDone = () => {
          data.items.delete(citekey);
          changed(`items/${citekey}/${citekey}.md`);
          job.result = { citekey: into, merged: { from: citekey, into, job: randomId("j_") } };
        };
      }
      return { citekey, job: job.id };
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
      const before = item.frontmatter;
      const next: Record<string, unknown> = { ...before };
      const today = new Date().toISOString().slice(0, 10);
      const provenance = { ...before.provenance };
      for (const [key, value] of Object.entries(input.patch)) {
        if (value === null) delete next[key];
        else next[key] = value;
        provenance[key] = `human@${today}`;
      }
      next.provenance = provenance;
      item.frontmatter = next as ItemFrontmatter;
      changed(`items/${input.citekey}/${input.citekey}.md`);
      const suggestedCitekey = suggestMockCitekey(before, item.frontmatter, data.items);
      return { frontmatter: item.frontmatter, ...(suggestedCitekey ? { suggestedCitekey } : {}) };
    })
    .bind(itemsRename, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      if (data.items.has(input.to)) {
        throw new Error(`CITEKEY_TAKEN: an item with citekey '${input.to}' exists already`);
      }
      data.items.delete(input.citekey);
      data.items.set(input.to, {
        ...item,
        frontmatter: { ...item.frontmatter, citekey: input.to } as ItemFrontmatter,
      });
      changed(`items/${input.citekey}/${input.citekey}.md`);
      changed(`items/${input.to}/${input.to}.md`);
      return { rewritten: 0 };
    })
    .bind(itemsTrash, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      data.items.delete(input.citekey);
      trashed.push({ citekey: input.citekey, item });
      changed(`items/${input.citekey}/${input.citekey}.md`);
      return { ok: true as const };
    })
    .bind(itemsRestore, async (_ctx, input) => {
      if (data.items.has(input.citekey)) {
        throw new Error(`CITEKEY_TAKEN: an item with citekey '${input.citekey}' exists again`);
      }
      const at = trashed.map((t) => t.citekey).lastIndexOf(input.citekey);
      const entry = at >= 0 ? trashed.splice(at, 1)[0] : undefined;
      if (!entry) throw new Error(`NOT_IN_TRASH: no trashed item with citekey '${input.citekey}'`);
      data.items.set(input.citekey, entry.item);
      changed(`items/${input.citekey}/${input.citekey}.md`);
      return { ok: true as const };
    })
    .bind(itemsAttach, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      const filename = input.filename ?? input.path.split(/[\\/]/).pop() ?? input.path;
      if (!/\.(pdf|html?|epub)$/i.test(filename)) {
        throw new Error(
          `FILE_TYPE_UNSUPPORTED: files of this type cannot be attached (${filename})`,
        );
      }
      const hash = Array.from(filename)
        .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
        .toString(16)
        .padStart(12, "0")
        .slice(-12);
      const have = item.frontmatter.sources.some((src) => src.hash === hash);
      if (!have) {
        item.frontmatter = {
          ...item.frontmatter,
          sources: [
            ...item.frontmatter.sources,
            {
              hash,
              kind: /\.pdf$/i.test(filename) ? "pdf" : /\.epub$/i.test(filename) ? "epub" : "html",
              filename,
              role: "main",
              added: { at: new Date().toISOString(), by: "human" },
            },
          ],
        } as ItemFrontmatter;
        changed(`items/${input.citekey}/${input.citekey}.md`);
      }
      const stamp = new Date().toISOString();
      const job: MockJob = {
        id: randomId("j_"),
        status: "running",
        createdAt: stamp,
        updatedAt: stamp,
      };
      jobs.set(job.id, job);
      setTimeout(() => {
        job.status = "succeeded";
        job.updatedAt = new Date().toISOString();
      }, aiDelayMs);
      return {
        citekey: input.citekey,
        source: hash,
        added: !have,
        ...(have ? {} : { job: job.id }),
      };
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
    .bind(projectsCreate, async (_ctx, input) => {
      if (data.projects.has(input.slug)) {
        throw new Error(`PROJECT_EXISTS: project '${input.slug}' already exists`);
      }
      const frontmatter = ProjectFrontmatter.parse({
        slug: input.slug,
        title: input.title,
        created: { at: new Date().toISOString(), by: "human" },
      });
      data.projects.set(input.slug, { frontmatter, brief: input.brief });
      changed(`projects/${input.slug}/project.md`);
      return { frontmatter, brief: input.brief };
    })
    .bind(projectsAddItems, async (_ctx, input) => changeMembers("add", input))
    .bind(projectsRemoveItems, async (_ctx, input) => changeMembers("remove", input))
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
        paginated: doc.paginated ?? true,
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
      // a source without pages cites the paragraph, counted over its text blocks
      const paragraph =
        doc && doc.paginated === false && block
          ? paragraphLocator(paragraphNumbers(doc.blocks), [block.id])
          : undefined;
      const frontmatter = CardFrontmatter.parse({
        id: randomId("c_"),
        item: input.citekey,
        ...(doc ? { source: doc.source } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(paragraph
          ? { locator: paragraph }
          : label
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
        data.lang;
      return { card, job: scheduleAi(frontmatter.id, language) };
    })
    .bind(cardsUpdate, async (_ctx, input) => {
      if ("quote" in input.patch) {
        throw new Error("CARD_QUOTE_IMMUTABLE: the verbatim quote of a card never changes");
      }
      const card = findCard(input.id);
      const { kind, tags, locator, note, paraphrase } = input.patch;
      const { kind: oldKind, ...rest } = card.frontmatter;
      card.frontmatter = {
        ...rest,
        // null clears the kind, undefined keeps it
        ...(kind === undefined ? (oldKind ? { kind: oldKind } : {}) : kind ? { kind } : {}),
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
        ...(note !== undefined ? { note } : {}),
        ...(paraphrase !== undefined ? { paraphrase } : {}),
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
        data.lang;
      return { job: scheduleAi(input.id, language) };
    })
    .bind(cardsExport, async (_ctx, input) => {
      const lines: string[] = [];
      const htmls: string[] = [];
      const lang = langOf(input.locale, data.lang);
      for (const id of input.ids) {
        const card = findCard(id);
        const item = data.items.get(card.frontmatter.item);
        if (!item) continue;
        const locator = card.frontmatter.locator;
        const loc = locator?.start;
        const quote = card.body.quote;
        const en = lang === "en";
        const [open, close] = en ? ["\u201c", "\u201d"] : ["\u201e", "\u201c"];
        const cf = en ? "cf." : "vgl.";
        const quoted = sentenceEnd(quote, "quote");
        const paraphrased = sentenceEnd(
          card.body.note || card.body.paraphrase || quote,
          "paraphrase",
        );
        const term = locatorTerm(locator?.label, lang);
        if (input.format === "pandoc") {
          const at = `@${item.frontmatter.citekey}${loc ? `, ${term} ${loc}` : ""}`;
          lines.push(
            input.mode === "direct"
              ? `${open}${quoted.text}${close} [${at}]${quoted.tail}`
              : input.mode === "indirect"
                ? `${paraphrased.text} [${cf} ${at}]${paraphrased.tail}`
                : `[${at}]`,
          );
          continue;
        }
        const label = citationLabel(item.frontmatter, loc, lang);
        if (input.mode === "cite") {
          lines.push(`(${label})`);
          htmls.push(`<p>(${label})</p>`);
        } else if (input.mode === "direct") {
          lines.push(`${open}${quoted.text}${close} (${label})${quoted.tail}`);
          htmls.push(
            `<blockquote>${open}${quoted.text}${close}</blockquote><p>(${label})${quoted.tail}</p>`,
          );
        } else {
          lines.push(`${paraphrased.text} (${cf} ${label})${paraphrased.tail}`);
          htmls.push(`<p>${paraphrased.text} (${cf} ${label})${paraphrased.tail}</p>`);
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
                `${surname(i.fm)} (${String(i.fm.issued ?? (data.lang === "en" ? "n.d." : "o. J.")).slice(0, 4)}). ${i.fm.title}.`,
            )
            .join("\n"),
        };
      }
      const lang = langOf(input.locale, data.lang);
      const style = input.style;
      if (input.format === "pandoc") {
        const parts = input.items.flatMap((r) => {
          if (!data.items.has(r.citekey)) return [];
          const at = `@${r.citekey}${r.locator ? `, ${locatorTerm(r.label, lang)} ${r.locator}` : ""}`;
          return [`${r.prefix ? `${r.prefix} ` : ""}${at}`];
        });
        return { text: `[${parts.join("; ")}]` };
      }
      const rendered = input.items.flatMap((r) => {
        const found = data.items.get(r.citekey);
        return found ? [styledCitation(found.frontmatter, r, style, lang)] : [];
      });
      // One cluster: "(A, 2013; B, 2014)". The mock joins the parts of the single citations.
      const text =
        rendered.length <= 1
          ? (rendered[0] ?? "")
          : `(${rendered.map((r) => r.slice(1, -1)).join("; ")})`;
      return { text, ...(input.format === "html" ? { html: text } : {}) };
    })
    .bind(jobsGet, async (_ctx, input) => {
      const imported = importJobs?.get(input.job);
      if (imported) return imported;
      const job = jobs.get(input.job);
      if (!job) throw new Error(`JOB_NOT_FOUND: no job '${input.job}'`);
      return {
        id: job.id,
        kind: "ai-task" as const,
        status: job.status,
        progress: job.progress ?? (job.status === "running" ? 0.5 : 1),
        input: {},
        attempts: 1,
        by: "human" as const,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        ...(job.result !== undefined ? { result: job.result } : {}),
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
        const text = `${c.body.quote} ${c.body.paraphrase ?? ""} ${c.body.note ?? ""}`;
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
  const settings = createSettingsMockState({
    worker: { ready: true, engines: { mock: "1.0" } },
    usage: { 7: sampleUsage(7), 30: sampleUsage(30) },
  });
  bindNotesMock(registry, data, emit);
  bindPlanningMock(registry, data, emit);
  bindTextsMock(registry, data, emit, jobs, aiDelayMs);
  bindRelatedMock(registry, data, emit);
  bindMatrixMock(registry, data, emit, jobs, aiDelayMs);
  bindConceptsMock(registry, data, emit, jobs, aiDelayMs);
  bindLitsearchMock(
    registry,
    createLitsearchMockState(data.lang),
    emit,
    Math.max(5, Math.round(aiDelayMs / 10)),
    data,
  );
  bindConnectionsMock(registry, data, emit, jobs, aiDelayMs);
  bindChatMock(registry, data, emit, {
    stepMs: Math.max(5, Math.round(aiDelayMs / 5)),
    extraJobs: () => listJobs(),
  });
  importJobs = bindImportMock(registry, createImportMockState({ lang: data.lang }), emit).jobs;
  bindSyncMock(
    registry,
    createSyncMockState({
      transport: "git",
      versioning: true,
      remote: "git@github.com:alex/library.git",
      uncommitted: 3,
      lastSync: {
        at: "2026-10-24T07:55:00.000Z",
        ok: true,
        message: "Pulled with rebase and pushed.",
      },
      conflicts: [mockConflict("notes/autopoiesis.md", {}, data.lang)],
    }),
    emit,
  );
  bindWebhooksMock(
    registry,
    createWebhooksMockState({
      hooks: [
        {
          name: "grok",
          kind: "both",
          url: "https://grok-bot.example.com/citegeist",
          inboundUrl: "",
          actor: "agent:grok",
          hasSecret: true,
          createdAt: "2026-10-23T12:00:00.000Z",
        },
      ],
    }),
    emit,
    () => settings.webhooks,
  );
  bindAlertsMock(
    registry,
    createAlertsMockState({
      alerts: [
        {
          id: "rag-papers",
          name:
            data.lang === "en"
              ? "RAG papers from computer science"
              : "RAG-Paper aus der Informatik",
          project: "rag-evaluation",
          source: { kind: "arxiv-query", value: "retrieval augmented generation evaluation" },
          intervalHours: 24,
          limit: 5,
          rank: true,
          enabled: true,
          created: "2026-10-20T09:00:00.000Z",
          lastRun: {
            at: "2026-10-24T07:00:00.000Z",
            ok: true,
            fetched: 30,
            found: 9,
            added: 5,
            ranked: true,
          },
        },
        {
          id: "neue-nlp-themen",
          name: data.lang === "en" ? "New work on NLP" : "Neue Arbeiten zu NLP",
          source: { kind: "openalex-topic", value: "T10181" },
          intervalHours: 168,
          limit: 10,
          rank: false,
          enabled: true,
          created: "2026-10-18T09:00:00.000Z",
        },
      ],
    }),
    emit,
    jobs,
  );
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

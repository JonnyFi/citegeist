import { readFileSync, rmSync } from "node:fs";
import {
  type AiRouter,
  ConceptDescribeInput,
  ConceptNameInput,
  resolveLanguage,
  sanitizeUsage,
} from "@citegeist/ai";
import type {
  Concept,
  ConceptCard,
  ConceptOp,
  ConceptProposal,
  ConceptSummary,
  ConceptUsageView,
} from "@citegeist/ops";
import {
  type Actor,
  type CardKind,
  CitegeistError,
  type ConceptUsage,
  type NoteFrontmatter,
} from "@citegeist/schema";
import { MarkdownFile } from "../frontmatter.js";
import { markdownFiles, rewriteWikiLinks } from "../ingest/items.js";
import type { ChangeEvent, Library } from "../library.js";
import { DetachedMatrixJobs, type MatrixJobQueue } from "../matrix/jobs.js";
import { renameNoteFile } from "../notes/rename.js";
import { recurringTerms, type TermText } from "./candidates.js";
import { dedupeAliases, nameMatches, normName } from "./names.js";
import { composeBody, splitBody } from "./render.js";

export interface ConceptDeps {
  /** Routes `concept.describe` and `concept.name` to the configured backend. */
  ai: Pick<AiRouter, "run">;
  /** Core job queue with progress. Without one, jobs run detached in this process. */
  jobs?: MatrixJobQueue | undefined;
  now?: () => Date;
}

/** Most cards one source contributes to an entry, and the longest passage in characters. */
const MAX_PASSAGES = 8;
const MAX_PASSAGE_CHARS = 1500;
/** Definition cards the proposal job names with the model, at most. */
const MAX_NAMED = 40;

interface Row {
  id: string;
  path: string;
  slug: string;
  fm: NoteFrontmatter;
}

interface CardRow {
  id: string;
  item: string;
  kind: CardKind | undefined;
  quote: string;
  paraphrase: string | undefined;
  note: string | undefined;
  page: string | null;
}

/** What a change function sees and returns: the parts of a concept file that people edit. */
interface State {
  title: string;
  aliases: string[];
  cards: string[];
  usages: ConceptUsage[];
  note: string;
}

function conceptError(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
  recovery: "fix-and-retry" | "do-first" | "ask-human" = "fix-and-retry",
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, context });
}

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

function pageOf(locator: { start: string; end?: string | undefined } | undefined): string | null {
  if (!locator) return null;
  return locator.end && locator.end !== locator.start
    ? `${locator.start}-${locator.end}`
    : locator.start;
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const at = text.lastIndexOf(" ", max);
  return text.slice(0, at > max / 2 ? at : max);
}

/** Concepts: notes of type "concept" with aliases, member cards and one entry per source. */
export class ConceptService {
  readonly jobs: MatrixJobQueue;
  /** Set when no queue was injected: lets callers and tests wait for detached jobs. */
  readonly detached: DetachedMatrixJobs | undefined;
  private readonly now: () => Date;
  /** Concepts a describe job is working on right now. */
  private readonly describing = new Set<string>();

  constructor(
    private readonly lib: Library,
    private readonly deps: ConceptDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    if (deps.jobs) {
      this.jobs = deps.jobs;
      this.detached = undefined;
    } else {
      this.detached = new DetachedMatrixJobs();
      this.jobs = this.detached;
    }
  }

  private get language(): string {
    return resolveLanguage({ library: this.lib.manifest.defaults.ai_language });
  }

  // Reading --------------------------------------------------------------------------------------

  private rows(): Row[] {
    return this.lib.index
      .all<{ id: string; path: string; slug: string; frontmatter_json: string }>(
        "SELECT id, path, slug, frontmatter_json FROM notes WHERE type = 'concept' ORDER BY title COLLATE NOCASE, id",
      )
      .map((r) => ({
        id: r.id,
        path: r.path,
        slug: r.slug,
        fm: JSON.parse(r.frontmatter_json) as NoteFrontmatter,
      }));
  }

  private require(id: string): Row {
    const row = this.rows().find((r) => r.id === id);
    if (!row) {
      throw conceptError(
        "CONCEPT_NOT_FOUND",
        `no concept with id '${id}'`,
        "Call concepts.list to see the concepts of the library, or concepts.create to make one.",
        { id },
      );
    }
    return row;
  }

  /** Normalized title and aliases of every concept, mapped to the concept's id. */
  private nameIndex(rows: readonly Row[] = this.rows()): Map<string, string> {
    const index = new Map<string, string>();
    for (const r of rows) {
      for (const name of [r.fm.title, ...(r.fm.aliases ?? [])]) {
        const key = normName(name);
        if (key !== "" && !index.has(key)) index.set(key, r.id);
      }
    }
    return index;
  }

  private cardRows(ids: readonly string[]): Map<string, CardRow> {
    const out = new Map<string, CardRow>();
    const all = unique(ids);
    for (let i = 0; i < all.length; i += 400) {
      const chunk = all.slice(i, i + 400);
      const rows = this.lib.index.all<{
        id: string;
        citekey: string;
        kind: string | null;
        quote: string;
        paraphrase: string | null;
        note: string | null;
        frontmatter_json: string;
      }>(
        `SELECT id, citekey, kind, quote, paraphrase, note, frontmatter_json FROM cards
         WHERE id IN (${chunk.map(() => "?").join(",")})`,
        ...chunk,
      );
      for (const r of rows) {
        const fm = JSON.parse(r.frontmatter_json) as {
          locator?: { label?: string; start: string; end?: string };
        };
        out.set(r.id, {
          id: r.id,
          item: r.citekey,
          kind: (r.kind ?? undefined) as CardKind | undefined,
          quote: r.quote,
          paraphrase: r.paraphrase ?? undefined,
          note: r.note ?? undefined,
          page: fm.locator?.label === "page" ? pageOf(fm.locator) : null,
        });
      }
    }
    return out;
  }

  /** Member cards that still exist, grouped by source. */
  private byItem(
    fm: Pick<NoteFrontmatter, "cards">,
    cards: Map<string, CardRow>,
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const id of unique(fm.cards ?? [])) {
      const card = cards.get(id);
      if (!card) continue;
      const list = groups.get(card.item) ?? [];
      list.push(id);
      groups.set(card.item, list);
    }
    return groups;
  }

  private summary(row: Row, cards: Map<string, CardRow>): ConceptSummary {
    const groups = this.byItem(row.fm, cards);
    const fresh = (row.fm.usages ?? []).filter((u) => {
      const now = groups.get(u.item);
      return now !== undefined && sameSet(u.basis, now);
    });
    const described = unique(fresh.map((u) => u.item)).length;
    return {
      id: row.id,
      slug: row.slug,
      title: row.fm.title,
      aliases: row.fm.aliases ?? [],
      cards: [...groups.values()].flat(),
      sources: groups.size,
      described,
      open: groups.size - described,
      ...(row.fm.modified ? { modified: row.fm.modified.at } : {}),
    };
  }

  list(input: { query?: string | undefined; limit: number }): { concepts: ConceptSummary[] } {
    const rows = this.rows();
    const cards = this.cardRows(rows.flatMap((r) => r.fm.cards ?? []));
    const query = input.query ? normName(input.query) : "";
    const concepts = rows
      .filter(
        (r) =>
          query === "" ||
          [r.fm.title, ...(r.fm.aliases ?? [])].some((n) => normName(n).includes(query)),
      )
      .slice(0, input.limit)
      .map((r) => this.summary(r, cards));
    return { concepts };
  }

  get(id: string): { concept: Concept } {
    const row = this.require(id);
    const note = this.lib.getNote(id);
    const cards = this.cardRows(row.fm.cards ?? []);
    const groups = this.byItem(row.fm, cards);
    const members: ConceptCard[] = [...groups.values()].flat().map((cid) => {
      const c = cards.get(cid) as CardRow;
      return {
        id: c.id,
        item: c.item,
        ...(c.kind ? { kind: c.kind } : {}),
        quote: c.quote,
        page: c.page,
      };
    });
    const usages: ConceptUsageView[] = (row.fm.usages ?? [])
      .filter((u) => groups.has(u.item))
      .map((u) => ({ ...u, stale: !sameSet(u.basis, groups.get(u.item) ?? []) }));
    return {
      concept: {
        ...this.summary(row, cards),
        path: note.path,
        note: splitBody(note.body).note,
        members,
        usages,
        created: row.fm.created,
      },
    };
  }

  // Writing --------------------------------------------------------------------------------------

  /**
   * Reads the concept file, lets `change` edit the parts people edit, drops entries of sources
   * without member cards, and writes the frontmatter and the rendered body in one step. Returns
   * the written state and the root-relative path.
   */
  private save(
    actor: Actor,
    id: string,
    change: (state: State) => State,
  ): { state: State; rel: string } {
    const row = this.require(id);
    const abs = this.lib.paths.abs(row.path);
    const file = MarkdownFile.parse(readFileSync(abs, "utf8"));
    const start: State = {
      title: row.fm.title,
      aliases: row.fm.aliases ?? [],
      cards: row.fm.cards ?? [],
      usages: row.fm.usages ?? [],
      note: splitBody(file.body).note,
    };
    const next = change(structuredClone(start));
    const cards = unique(next.cards);
    const known = this.cardRows(cards);
    const items = new Set([...known.values()].map((c) => c.item));
    const usages = next.usages.filter((u) => items.has(u.item));
    const aliases = dedupeAliases(next.title, next.aliases);
    file.patch({
      title: next.title,
      aliases,
      cards,
      usages,
      modified: this.lib.stamp(actor),
    });
    file.setBody(composeBody(next.note, usages, this.language));
    this.lib.writeFile(row.path, file.toString());
    return { state: { ...next, aliases, cards, usages }, rel: row.path };
  }

  /** Fails when a name belongs to a concept other than `self`. */
  private checkFree(names: readonly string[], self: string): void {
    const index = this.nameIndex();
    for (const name of names) {
      const owner = index.get(normName(name));
      if (owner && owner !== self) {
        throw conceptError(
          "CONCEPT_NAME_TAKEN",
          `'${name}' is already a name of concept ${owner}`,
          "Merge the two concepts with concepts.merge, or choose another name.",
          { name, concept: owner },
          "ask-human",
        );
      }
    }
  }

  private requireCards(ids: readonly string[]): void {
    const found = this.cardRows(ids);
    const missing = unique(ids).filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw conceptError(
        "CARD_NOT_FOUND",
        `no card with id '${missing[0]}'`,
        "Use card ids from cards.list.",
        { cards: missing },
      );
    }
  }

  /** Cards whose quote, paraphrase or note contains one of the names. */
  private collectCards(names: readonly string[]): string[] {
    const rows = this.lib.index.all<{
      id: string;
      quote: string;
      paraphrase: string | null;
      note: string | null;
    }>("SELECT id, quote, paraphrase, note FROM cards ORDER BY id");
    return rows
      .filter((r) => {
        const text = [r.quote, r.paraphrase, r.note].filter(Boolean).join("\n");
        return names.some((n) => nameMatches(text, n));
      })
      .map((r) => r.id);
  }

  create(
    actor: Actor,
    input: { term: string; aliases: string[]; cards: string[]; collect: boolean },
  ): { concept: Concept; merged: boolean } {
    const term = input.term.replace(/\s+/g, " ").trim();
    const names = dedupeAliases("", [term, ...input.aliases]);
    if (names.length === 0) {
      throw conceptError("CONCEPT_NAME_EMPTY", "a concept needs a term", "Pass a non-empty term.");
    }
    this.requireCards(input.cards);
    const index = this.nameIndex();
    const owners = unique(names.flatMap((n) => index.get(normName(n)) ?? []));
    if (owners.length > 1) {
      throw conceptError(
        "CONCEPT_AMBIGUOUS",
        `the names ${names.map((n) => `'${n}'`).join(", ")} belong to ${owners.length} different concepts`,
        "Merge those concepts with concepts.merge first, or create the concept with fewer names.",
        { concepts: owners },
        "ask-human",
      );
    }
    const cards = unique([...input.cards, ...(input.collect ? this.collectCards(names) : [])]);
    const existing = owners[0];
    if (existing) {
      this.save(actor, existing, (s) => ({
        ...s,
        aliases: [...s.aliases, ...names],
        cards: unique([...s.cards, ...cards]),
      }));
      return { concept: this.get(existing).concept, merged: true };
    }
    const note = this.lib.createNote(actor, {
      title: names[0] as string,
      body: "",
      type: "concept",
      projects: [],
    });
    const id = note.frontmatter.id;
    this.save(actor, id, (s) => ({ ...s, aliases: names.slice(1), cards }));
    return { concept: this.get(id).concept, merged: false };
  }

  update(actor: Actor, input: { id: string; ops: ConceptOp[] }): { concept: Concept } {
    this.require(input.id);
    let renamed: string | undefined;
    this.save(actor, input.id, (s) => {
      let state = s;
      for (const op of input.ops) {
        switch (op.op) {
          case "rename": {
            const title = op.title.replace(/\s+/g, " ").trim();
            this.checkFree([title], input.id);
            if (normName(title) !== normName(state.title)) {
              state = { ...state, aliases: [...state.aliases, state.title], title };
            } else {
              state = { ...state, title };
            }
            renamed = title;
            break;
          }
          case "addAlias":
            this.checkFree([op.alias], input.id);
            state = { ...state, aliases: [...state.aliases, op.alias] };
            break;
          case "removeAlias": {
            const key = normName(op.alias);
            state = { ...state, aliases: state.aliases.filter((a) => normName(a) !== key) };
            break;
          }
          case "addCards":
            this.requireCards(op.cards);
            state = { ...state, cards: unique([...state.cards, ...op.cards]) };
            break;
          case "removeCards": {
            const drop = new Set(op.cards);
            state = { ...state, cards: state.cards.filter((c) => !drop.has(c)) };
            break;
          }
          case "setNote":
            state = { ...state, note: op.note };
            break;
        }
      }
      return state;
    });
    if (renamed !== undefined) {
      const row = this.require(input.id);
      renameNoteFile(this.lib, row.path, renamed);
    }
    return { concept: this.get(input.id).concept };
  }

  merge(actor: Actor, input: { into: string; from: string[] }): { concept: Concept } {
    const from = unique(input.from).filter((id) => id !== input.into);
    const rows = this.rows();
    const into = this.require(input.into);
    const sources = from.map((id) => {
      const r = rows.find((x) => x.id === id);
      if (!r) {
        throw conceptError(
          "CONCEPT_NOT_FOUND",
          `no concept with id '${id}'`,
          "Call concepts.list to see the concepts of the library.",
          { id },
        );
      }
      return r;
    });
    if (sources.length === 0) {
      throw conceptError(
        "CONCEPT_MERGE_EMPTY",
        "there is nothing to merge: 'from' holds only the target",
        "Pass at least one other concept in 'from'.",
        { into: input.into },
      );
    }
    this.save(actor, into.id, (s) => {
      let state = s;
      for (const src of sources) {
        const usedItems = new Set(state.usages.map((u) => u.item));
        const text = splitBody(this.lib.getNote(src.id).body).note;
        state = {
          ...state,
          aliases: [...state.aliases, src.fm.title, ...(src.fm.aliases ?? [])],
          cards: unique([...state.cards, ...(src.fm.cards ?? [])]),
          usages: [...state.usages, ...(src.fm.usages ?? []).filter((u) => !usedItems.has(u.item))],
          note: text === state.note ? state.note : [state.note, text].filter(Boolean).join("\n\n"),
        };
      }
      return state;
    });
    // links to the merged concepts, by file name and by id, now point at the target
    for (const src of sources) {
      for (const file of markdownFiles(this.lib)) {
        if (file === src.path) continue;
        const raw = readFileSync(this.lib.paths.abs(file), "utf8");
        const bySlug = rewriteWikiLinks(raw, src.slug, into.slug);
        const byId = rewriteWikiLinks(bySlug.text, src.id, into.id);
        if (bySlug.count + byId.count > 0) this.lib.writeFile(file, byId.text);
      }
      rmSync(this.lib.paths.abs(src.path), { force: true });
      const removed = this.lib.indexer.removePath(src.path);
      this.lib.emit("change", { ...removed, external: false } satisfies ChangeEvent);
    }
    return { concept: this.get(into.id).concept };
  }

  // Entries --------------------------------------------------------------------------------------

  private itemInfo(citekey: string) {
    const row = this.lib.index.get<{ title: string; year: string | null; authors: string | null }>(
      "SELECT title, year, authors FROM items WHERE citekey = ?",
      citekey,
    );
    return {
      citekey,
      title: row?.title ?? citekey,
      ...(row?.authors ? { authors: row.authors } : {}),
      ...(row?.year ? { year: String(row.year) } : {}),
    };
  }

  /** Writes the entry of one source. Returns false when the model found nothing to say. */
  private async describeItem(
    actor: Actor,
    id: string,
    item: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const row = this.require(id);
    const cards = this.cardRows(row.fm.cards ?? []);
    const ids = (this.byItem(row.fm, cards).get(item) ?? []).slice(0, MAX_PASSAGES);
    const all = this.byItem(row.fm, cards).get(item) ?? [];
    if (ids.length === 0) return false;
    const input = ConceptDescribeInput.parse({
      concept: { term: row.fm.title, aliases: row.fm.aliases ?? [] },
      item: this.itemInfo(item),
      passages: ids.map((cid) => {
        const c = cards.get(cid) as CardRow;
        return {
          ref: c.id,
          ...(c.kind ? { kind: c.kind } : {}),
          page: c.page,
          text: cut(c.quote, MAX_PASSAGE_CHARS),
        };
      }),
    });
    const language = this.language;
    const res = await this.deps.ai.run("concept.describe", input, { language });
    if (signal.aborted) throw new Error("cancelled");
    const clean = sanitizeUsage(res.output, input);
    if (!clean.found) return false;
    const usage: ConceptUsage = {
      item,
      role: clean.role,
      text: clean.text,
      evidence: clean.evidence.map((e) => ({
        card: e.ref,
        quote: e.quote,
        page: cards.get(e.ref)?.page ?? null,
      })),
      basis: all,
      stamp: { by: res.stamp.by, at: res.stamp.at, language },
      promptVersion: res.promptVersion,
    };
    let stored = false;
    this.save(actor, id, (s) => {
      // the reader may have changed the cards of this source while the model worked
      const nowCards = this.byItem({ cards: s.cards }, this.cardRows(s.cards)).get(item) ?? [];
      if (!sameSet(nowCards, all)) return s;
      stored = true;
      return { ...s, usages: [...s.usages.filter((u) => u.item !== item), usage] };
    });
    return stored;
  }

  describe(actor: Actor, input: { id: string; force: boolean }): { job: string; sources: number } {
    const row = this.require(input.id);
    if (this.describing.has(input.id)) {
      throw conceptError(
        "CONCEPT_BUSY",
        `concept '${row.fm.title}' is being described`,
        "Wait for the running job; poll it with jobs.get.",
        { id: input.id },
      );
    }
    const view = this.get(input.id).concept;
    const stale = new Set(view.usages.filter((u) => u.stale).map((u) => u.item));
    const done = new Set(view.usages.filter((u) => !u.stale).map((u) => u.item));
    const items = unique(view.members.map((m) => m.item)).filter(
      (item) => input.force || stale.has(item) || !done.has(item),
    );
    const summary = { written: 0, silent: 0, failed: 0 };
    if (items.length === 0) {
      return {
        job: this.jobs.enqueue({
          kind: "ai-task",
          label: `concepts.describe ${input.id}`,
          by: actor,
          input: { concept: input.id, sources: 0 },
          run: async (ctx) => {
            ctx.progress(1, "nothing to describe");
            return summary;
          },
        }),
        sources: 0,
      };
    }
    this.describing.add(input.id);
    try {
      const job = this.jobs.enqueue({
        kind: "ai-task",
        label: `concepts.describe ${input.id}`,
        by: actor,
        input: { concept: input.id, sources: items.length },
        run: async (ctx) => {
          try {
            for (const [i, item] of items.entries()) {
              if (ctx.signal.aborted) break;
              ctx.progress(i / items.length, `${item} (${i + 1} of ${items.length})`);
              try {
                if (await this.describeItem(actor, input.id, item, ctx.signal)) summary.written++;
                else summary.silent++;
              } catch {
                summary.failed++;
              }
            }
            ctx.progress(
              1,
              `${summary.written} written, ${summary.silent} without entry, ${summary.failed} failed`,
            );
            return summary;
          } finally {
            this.describing.delete(input.id);
          }
        },
      });
      return { job, sources: items.length };
    } catch (err) {
      this.describing.delete(input.id);
      throw err;
    }
  }

  // Proposals ------------------------------------------------------------------------------------

  propose(actor: Actor, input: { limit: number }): { job: string } {
    return {
      job: this.jobs.enqueue({
        kind: "ai-task",
        label: "concepts.propose",
        by: actor,
        input: { limit: input.limit },
        run: async (ctx) => ({ proposals: await this.proposals(input.limit, ctx) }),
      }),
    };
  }

  /** Terms defined by definition cards, then terms several sources repeat. Writes nothing. */
  private async proposals(
    limit: number,
    ctx: { progress(value: number, message?: string): void; signal: AbortSignal },
  ): Promise<ConceptProposal[]> {
    const rows = this.rows();
    const index = this.nameIndex(rows);
    const members = new Set(rows.flatMap((r) => r.fm.cards ?? []));
    const language = this.language;

    const defs = this.lib.index
      .all<{ id: string }>("SELECT id FROM cards WHERE kind = 'definition' ORDER BY id")
      .map((r) => r.id)
      .filter((id) => !members.has(id))
      .slice(0, MAX_NAMED);
    const defCards = this.cardRows(defs);
    const byTerm = new Map<string, ConceptProposal>();
    for (const [i, id] of defs.entries()) {
      if (ctx.signal.aborted) break;
      ctx.progress(i / Math.max(1, defs.length), `${i + 1} of ${defs.length}`);
      const card = defCards.get(id);
      if (!card) continue;
      let named: { term: string; aliases: string[] };
      try {
        const res = await this.deps.ai.run(
          "concept.name",
          ConceptNameInput.parse({
            passage: cut(card.quote, MAX_PASSAGE_CHARS),
            ...(card.paraphrase ? { paraphrase: card.paraphrase } : {}),
          }),
          { language },
        );
        named = res.output;
      } catch {
        continue;
      }
      const term = named.term.replace(/\s+/g, " ").trim();
      // the model names a term the passage or its summary really contains, or nothing
      if (term === "" || ![card.quote, card.paraphrase ?? ""].some((t) => nameMatches(t, term))) {
        continue;
      }
      const aliases = dedupeAliases(
        term,
        named.aliases.filter((a) => nameMatches(card.quote, a)),
      );
      const names = [term, ...aliases];
      const key = names.map(normName).find((k) => byTerm.has(k));
      const hit = key ? byTerm.get(key) : undefined;
      if (hit) {
        hit.cards = unique([...hit.cards, id]);
        hit.sources = unique([...hit.sources, card.item]);
        hit.aliases = dedupeAliases(hit.term, [...hit.aliases, ...names]);
        continue;
      }
      const existing = names.map((n) => index.get(normName(n))).find(Boolean);
      const proposal: ConceptProposal = {
        term,
        aliases,
        origin: "definition",
        cards: [id],
        sources: [card.item],
        ...(existing ? { existing } : {}),
      };
      for (const n of names) byTerm.set(normName(n), proposal);
    }
    const proposals = unique([...byTerm.values()]);

    const known = new Set([...index.keys(), ...byTerm.keys()]);
    const texts: TermText[] = this.lib.index
      .all<{
        id: string;
        citekey: string;
        quote: string;
        paraphrase: string | null;
        note: string | null;
      }>("SELECT id, citekey, quote, paraphrase, note FROM cards ORDER BY id")
      .map((r) => ({
        ref: r.id,
        item: r.citekey,
        text: [r.quote, r.paraphrase, r.note].filter(Boolean).join("\n"),
      }));
    for (const n of this.lib.index.all<{ path: string }>(
      "SELECT path FROM notes WHERE type <> 'concept'",
    )) {
      try {
        texts.push({
          ref: n.path,
          text: MarkdownFile.parse(readFileSync(this.lib.paths.abs(n.path), "utf8")).body,
        });
      } catch {
        // a note that cannot be read adds nothing to the count
      }
    }
    const recurring = recurringTerms(texts, { known, limit }).map(
      (c): ConceptProposal => ({
        term: c.term,
        aliases: [],
        origin: "recurring",
        cards: c.cards,
        sources: c.items,
      }),
    );
    ctx.progress(1, `${proposals.length + recurring.length} proposals`);
    return [...proposals, ...recurring].slice(0, limit);
  }
}

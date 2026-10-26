import { readFileSync } from "node:fs";
import type { AiRouter, CardSuggestLinksInput, NoteProposeLinksInput } from "@citegeist/ai";
import { MAX_SUGGESTIONS, sanitizeProposals, sanitizeSuggestions } from "@citegeist/ai";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { CardJobQueue } from "../cards/jobs.js";
import { DetachedJobs } from "../cards/jobs.js";
import { MarkdownFile } from "../frontmatter.js";
import type { Library } from "../library.js";
import { extractWikiLinks, wikiTarget } from "../wikilinks.js";
import { cardLinkTargets, ensureLiteratureNote, type RawLink } from "./card-links.js";
import { linkErrors } from "./errors.js";
import { findMentions, type Mention } from "./mentions.js";

export interface LinkDeps {
  /** Routes `note.proposeLinks` to the configured backend. */
  ai: Pick<AiRouter, "run">;
  /** Core job queue. Without one, the AI work runs detached in this process. */
  jobs?: CardJobQueue;
}

/** Cards of one linked item offered to the model as supporting evidence. */
const CARDS_PER_ITEM = 6;
const TEXT_MAX = 600;
const QUOTE_MAX = 1500;
/** Sources the string match hands to the model for one card. */
const MAX_CANDIDATES = 4;

function clip(text: string, max = TEXT_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function cardLinkNotFound(id: string): CitegeistError {
  return new CitegeistError({
    code: "CARD_NOT_FOUND",
    message: `no card with id '${id}'`,
    fix: "Call cards.list to find the right card id.",
    recovery: "fix-and-retry",
    sideEffects: "none",
    context: { id },
  });
}

/** `agent:` actor for a model stamp such as `claude-code:sonnet`. */
function agentActor(stampBy: string): Actor {
  const name =
    (stampBy.split(":")[0] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/, "")
      .slice(0, 64) || "ai";
  return `agent:${name}`;
}

/** Link proposals for notes: the `links.propose` job and the `links.decide` handler. */
export class LinkService {
  readonly jobs: CardJobQueue;
  /** Set when no queue was injected: lets callers and tests wait for detached AI work. */
  readonly detached: DetachedJobs | undefined;

  constructor(
    private readonly lib: Library,
    private readonly deps: LinkDeps,
  ) {
    if (deps.jobs) {
      this.jobs = deps.jobs;
      this.detached = undefined;
    } else {
      this.detached = new DetachedJobs();
      this.jobs = this.detached;
    }
  }

  /** Queues the proposal run and returns its job id. The note is checked first. */
  propose(actor: Actor, input: { note: string }): { job: string } {
    this.lib.getNote(input.note);
    const job = this.jobs.enqueue({
      kind: "ai-task",
      label: `note.proposeLinks ${input.note}`,
      by: actor,
      input: { note: input.note },
      run: () => this.generate(input.note),
    });
    return { job };
  }

  /** Items, cards and notes the body links to, plus quote cards of the linked items. */
  buildInput(noteId: string): NoteProposeLinksInput | undefined {
    const { frontmatter, body } = this.lib.getNote(noteId);
    const index = this.lib.index;
    const targets: NoteProposeLinksInput["targets"] = [];
    const cards: NoteProposeLinksInput["cards"] = [];
    const seen = new Set<string>();
    for (const ref of extractWikiLinks(body)) {
      const key = ref.target.toLowerCase();
      if (seen.has(key)) continue;
      const wiki = `[[${ref.target}]]`;
      const item = index.get<{ citekey: string; title: string; abstract: string | null }>(
        "SELECT citekey, title, abstract FROM items WHERE citekey = ?",
        ref.target,
      );
      if (item) {
        seen.add(key);
        const summary = item.abstract ? clip(item.abstract) : undefined;
        targets.push({
          ref: wiki,
          kind: "item",
          title: item.title,
          ...(summary ? { summary } : {}),
        });
        const rows = index.all<{ id: string; quote: string; paraphrase: string | null }>(
          "SELECT id, quote, paraphrase FROM cards WHERE citekey = ? ORDER BY id LIMIT ?",
          item.citekey,
          CARDS_PER_ITEM,
        );
        for (const c of rows) {
          cards.push({ ref: `[[${c.id}]]`, item: wiki, text: clip(c.paraphrase || c.quote) });
        }
        continue;
      }
      const card = index.get<{ id: string; quote: string; paraphrase: string | null }>(
        "SELECT id, quote, paraphrase FROM cards WHERE id = ?",
        ref.target,
      );
      if (card) {
        seen.add(key);
        targets.push({
          ref: wiki,
          kind: "card",
          title: clip(card.quote, 80),
          summary: clip(card.paraphrase || card.quote),
        });
        continue;
      }
      const note = index.get<{ id: string; title: string }>(
        "SELECT id, title FROM notes WHERE slug = ? OR id = ?",
        ref.target,
        ref.target,
      );
      if (note && note.id !== noteId) {
        seen.add(key);
        const summary = clip(this.lib.getNote(note.id).body, 400);
        targets.push({
          ref: wiki,
          kind: "note",
          title: note.title,
          ...(summary ? { summary } : {}),
        });
      }
    }
    if (targets.length === 0) return undefined;
    return {
      note: { title: frontmatter.title, type: frontmatter.type, body },
      targets,
      cards,
      existing: frontmatter.links.map((l) => ({ to: l.to, ...(l.rel ? { rel: l.rel } : {}) })),
    };
  }

  private languageFor(noteId: string): string {
    const { frontmatter } = this.lib.getNote(noteId);
    for (const slug of frontmatter.projects) {
      try {
        const lang = this.lib.getProject(slug).frontmatter.ai_language;
        if (lang) return lang;
      } catch {
        // the project file is gone: try the next one
      }
    }
    return this.lib.manifest.defaults.ai_language;
  }

  /** Runs `note.proposeLinks` and appends the answers to the note as links with status proposed. */
  private async generate(noteId: string): Promise<{ proposed: number }> {
    const input = this.buildInput(noteId);
    if (!input) return { proposed: 0 };
    const language = this.languageFor(noteId);
    const res = await this.deps.ai.run("note.proposeLinks", input, { language });
    const proposals = sanitizeProposals(res.output, input);
    if (proposals.length === 0) return { proposed: 0 };
    const by = agentActor(res.stamp.by);

    // Read after the await, so edits made while the model ran are kept.
    const row = this.lib.getNote(noteId);
    const rel = this.lib.paths.rel(row.path);
    const file = MarkdownFile.parse(readFileSync(row.path, "utf8"));
    const links = ((file.data?.links as RawLink[] | undefined) ?? []).slice();
    const taken = new Set(links.map((l) => `${String(l.to).toLowerCase()}|${String(l.rel ?? "")}`));
    let added = 0;
    for (const p of proposals) {
      if (taken.has(`${p.to.toLowerCase()}|${p.rel}`)) continue;
      links.push({
        to: p.to,
        rel: p.rel,
        why: p.why,
        ...(p.evidence ? { evidence: p.evidence } : {}),
        by,
        status: "proposed",
      });
      added++;
    }
    if (added === 0) return { proposed: 0 };
    file.patch({ links, modified: this.lib.stamp(by) });
    this.lib.writeFile(rel, file.toString());
    return { proposed: added };
  }

  // Suggestions for cards ---------------------------------------------------------------------

  /** Queues `card.suggestLinks` for one card and returns its job id. The card is checked first. */
  suggest(actor: Actor, input: { card: string }): { job: string } {
    this.cardRow(input.card);
    const job = this.jobs.enqueue({
      kind: "ai-task",
      label: `card.suggestLinks ${input.card}`,
      by: actor,
      input: { card: input.card },
      run: () => this.generateSuggestions(input.card),
    });
    return { job };
  }

  /**
   * Called when a card is created or its paraphrase arrives. The cheap string match runs here; a
   * job is queued only when it found a source, so a library without matches never asks a model.
   */
  autoSuggest(cardId: string): void {
    try {
      if (this.suggestionInput(cardId)) {
        this.jobs.enqueue({
          kind: "ai-task",
          label: `card.suggestLinks ${cardId}`,
          by: "system",
          input: { card: cardId },
          run: () => this.generateSuggestions(cardId),
        });
      }
    } catch {
      // the card is gone or unreadable: there is nothing to suggest
    }
  }

  private cardRow(id: string) {
    const row = this.lib.index.get<{
      citekey: string;
      quote: string;
      paraphrase: string | null;
      note: string | null;
    }>("SELECT citekey, quote, paraphrase, note FROM cards WHERE id = ?", id);
    if (!row) throw cardLinkNotFound(id);
    return row;
  }

  /** Candidates for a card: sources its text names that it is not linked to yet, best first. */
  private candidates(
    cardId: string,
  ): { input: CardSuggestLinksInput; mentions: Mention[] } | undefined {
    const card = this.cardRow(cardId);
    const pending = this.lib.index.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE src_kind = 'card' AND src_ref = ? AND origin = 'frontmatter' AND status = 'proposed'",
      cardId,
    )?.n;
    if ((pending ?? 0) >= MAX_SUGGESTIONS) return undefined;
    const known = cardLinkTargets(this.lib, cardId);
    const text = [card.quote, card.paraphrase, card.note].filter(Boolean).join("\n");
    const mentions = findMentions(this.lib, card.citekey, text)
      .filter((m) => !known.has(m.citekey))
      .slice(0, MAX_CANDIDATES);
    if (mentions.length === 0) return undefined;
    const source = this.lib.index.get<{
      title: string;
      authors: string | null;
      year: string | null;
    }>("SELECT title, authors, year FROM items WHERE citekey = ?", card.citekey);
    return {
      mentions,
      input: {
        card: {
          quote: clip(card.quote, QUOTE_MAX),
          ...(card.paraphrase ? { paraphrase: clip(card.paraphrase, TEXT_MAX) } : {}),
          ...(card.note ? { note: clip(card.note, TEXT_MAX) } : {}),
          source: {
            title: source?.title ?? card.citekey,
            ...(source?.authors ? { authors: source.authors } : {}),
            ...(source?.year ? { year: source.year } : {}),
          },
        },
        candidates: mentions.map((m) => ({
          ref: `[[${m.citekey}]]`,
          title: m.title,
          ...(m.authors ? { authors: m.authors } : {}),
          ...(m.year ? { year: m.year } : {}),
          ...(m.abstract ? { summary: clip(m.abstract) } : {}),
          matched: m.matched,
        })),
      },
    };
  }

  private suggestionInput(cardId: string): CardSuggestLinksInput | undefined {
    return this.candidates(cardId)?.input;
  }

  private cardLanguage(cardId: string, citekey: string): string {
    const item = this.lib.getItem(citekey).frontmatter;
    if (item.ai_language) return item.ai_language;
    const card = this.lib.index.get<{ frontmatter_json: string }>(
      "SELECT frontmatter_json FROM cards WHERE id = ?",
      cardId,
    );
    const projects = card
      ? (JSON.parse(card.frontmatter_json) as { projects?: string[] }).projects
      : [];
    for (const slug of projects?.length ? projects : item.projects) {
      try {
        const lang = this.lib.getProject(slug).frontmatter.ai_language;
        if (lang) return lang;
      } catch {
        // the project file is gone: try the next one
      }
    }
    return this.lib.manifest.defaults.ai_language;
  }

  /** Runs `card.suggestLinks` and stores the answers as proposed links that start at the card. */
  private async generateSuggestions(cardId: string): Promise<{ proposed: number }> {
    const found = this.candidates(cardId);
    if (!found) return { proposed: 0 };
    const { citekey } = this.cardRow(cardId);
    const language = this.cardLanguage(cardId, citekey);
    const res = await this.deps.ai.run("card.suggestLinks", found.input, { language });
    const suggestions = sanitizeSuggestions(res.output, found.input);
    if (suggestions.length === 0) return { proposed: 0 };
    const by = agentActor(res.stamp.by);

    // Read again after the await: the user may have decided or edited while the model ran.
    let room = MAX_SUGGESTIONS;
    let added = 0;
    let note: ReturnType<Library["getNote"]> | undefined;
    for (const s of suggestions) {
      try {
        this.cardRow(cardId);
      } catch {
        return { proposed: added }; // the card was removed while the model ran
      }
      note = ensureLiteratureNote(this.lib, by, citekey);
      const file = MarkdownFile.parse(readFileSync(note.path, "utf8"));
      const links = ((file.data?.links as RawLink[] | undefined) ?? []).slice();
      const mine = links.filter((l) => l.from === cardId);
      room = MAX_SUGGESTIONS - mine.filter((l) => l.status === "proposed").length;
      const target = s.to.slice(2, -2);
      if (room <= 0) break;
      if (mine.some((l) => wikiTarget(String(l.to)) === target)) continue;
      links.push({
        from: cardId,
        to: s.to,
        rel: s.rel,
        why: s.why,
        evidence: `[[${cardId}]]`,
        by,
        status: "proposed",
      });
      file.patch({ links, modified: this.lib.stamp(by) });
      this.lib.writeFile(this.lib.paths.rel(note.path), file.toString());
      added++;
    }
    return { proposed: added };
  }

  /** Accepts proposed links (status becomes accepted) and rejects others (status becomes rejected). */
  decide(
    actor: Actor,
    input: { note: string; accept: number[]; reject: number[] },
  ): ReturnType<Library["getNote"]> {
    const row = this.lib.getNote(input.note);
    const rel = this.lib.paths.rel(row.path);
    const file = MarkdownFile.parse(readFileSync(row.path, "utf8"));
    const links = ((file.data?.links as RawLink[] | undefined) ?? []).slice();
    const accept = new Set(input.accept);
    const reject = new Set(input.reject);
    for (const i of [...accept, ...reject]) {
      const link = links[i];
      if (!Number.isInteger(i) || !link) throw linkErrors.badIndex(input.note, i, links.length);
      if (accept.has(i) && reject.has(i)) throw linkErrors.conflict(input.note, i);
      if (link.status !== "proposed") throw linkErrors.notProposed(input.note, i);
    }
    if (accept.size === 0 && reject.size === 0) return row;
    const next = links.map((l, i) =>
      accept.has(i)
        ? { ...l, status: "accepted" }
        : reject.has(i)
          ? { ...l, status: "rejected" }
          : l,
    );
    file.patch({ links: next, modified: this.lib.stamp(actor) });
    this.lib.writeFile(rel, file.toString());
    return this.lib.getNote(input.note);
  }
}

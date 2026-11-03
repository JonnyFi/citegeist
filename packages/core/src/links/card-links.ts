import { readFileSync } from "node:fs";
import type { CardLink, OpContext } from "@citegeist/ops";
import { CardId, CitegeistError, type Link } from "@citegeist/schema";
import { MarkdownFile } from "../frontmatter.js";
import type { Library } from "../library.js";
import { wikiTarget } from "../wikilinks.js";
import { escapeRegex } from "./mentions.js";

/** A link as it stands in the frontmatter of a note, before the schema fills in defaults. */
export interface RawLink {
  from?: unknown;
  to?: unknown;
  rel?: unknown;
  why?: unknown;
  evidence?: unknown;
  by?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

export function isCardId(id: string): boolean {
  return CardId.safeParse(id).success;
}

const cardLinkErrors = {
  cardNotFound: (id: string) =>
    new CitegeistError({
      code: "CARD_NOT_FOUND",
      message: `no card with id '${id}'`,
      fix: "Call cards.list to find the right card id.",
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { id },
    }),
  targetNotFound: (from: string, to: string, target: string) =>
    new CitegeistError({
      code: "LINK_TARGET_NOT_FOUND",
      message: `Nothing in the library is called ${target}, so the link from ${from} was not written.`,
      fix: 'Find the citekey, card id or note id with the search tool, then call link again with "[[<id>]]".',
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { from, to },
    }),
  self: (card: string) =>
    new CitegeistError({
      code: "LINK_TO_SELF",
      message: `card '${card}' cannot be linked to itself`,
      fix: "Pick another item, card or note as the target.",
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { card },
    }),
  noLink: (from: string, to: string) =>
    new CitegeistError({
      code: "LINK_NOT_FOUND",
      message: `'${from}' has no link to '${to}'`,
      fix: "Call links.forCard (cards) or notes.get (notes) to see the links that exist.",
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { from, to },
    }),
};

/** The target of a link as the id it names, or an error when nothing in the library has that id. */
export function resolveTarget(lib: Library, from: string, to: string): string {
  const target = wikiTarget(to);
  const known =
    lib.index.get("SELECT 1 AS found FROM items WHERE citekey = ?", target) ??
    lib.index.get("SELECT 1 AS found FROM cards WHERE id = ?", target) ??
    lib.index.get("SELECT 1 AS found FROM notes WHERE id = ? OR slug = ?", target, target);
  if (!known) throw cardLinkErrors.targetNotFound(from, to, target);
  return target;
}

function cardRow(lib: Library, id: string): { citekey: string } {
  const row = lib.index.get<{ citekey: string }>("SELECT citekey FROM cards WHERE id = ?", id);
  if (!row) throw cardLinkErrors.cardNotFound(id);
  return row;
}

/**
 * The literature note of an item: the note of type `literature` whose body names the item on an
 * `Item: [[citekey]]` line (the shape the Zotero import writes). The oldest one wins.
 */
export function findLiteratureNote(lib: Library, citekey: string): string | undefined {
  const rows = lib.index.all<{ id: string }>(
    `SELECT n.id FROM notes n
     WHERE n.type = 'literature'
       AND EXISTS (SELECT 1 FROM links l WHERE l.path = n.path AND l.origin = 'wiki' AND l.dst = ?)
     ORDER BY n.created, n.id`,
    citekey,
  );
  const line = new RegExp(
    String.raw`^Item:\s*\[\[` + escapeRegex(citekey) + String.raw`[\]|#]`,
    "m",
  );
  return rows.find((r) => line.test(lib.getNote(r.id).body))?.id;
}

/** The literature note of an item, created with the usual `Item:` line when it does not exist. */
export function ensureLiteratureNote(lib: Library, actor: OpContext["actor"], citekey: string) {
  const id = findLiteratureNote(lib, citekey);
  if (id) return lib.getNote(id);
  const item = lib.getItem(citekey).frontmatter;
  return lib.createNote(actor, {
    title: `Reading notes (${citekey})`,
    body: `Item: [[${citekey}]]\n`,
    type: "literature",
    projects: item.projects,
  });
}

export function readLinks(path: string): { file: MarkdownFile; links: RawLink[] } {
  const file = MarkdownFile.parse(readFileSync(path, "utf8"));
  return { file, links: ((file.data?.links as RawLink[] | undefined) ?? []).slice() };
}

export function saveLinks(
  lib: Library,
  path: string,
  file: MarkdownFile,
  links: RawLink[],
  actor: OpContext["actor"],
): void {
  file.patch({ links, modified: lib.stamp(actor) });
  lib.writeFile(lib.paths.rel(path), file.toString());
}

const isFromCard = (l: RawLink, card: string) => l.from === card;
const sameTarget = (l: RawLink, target: string) => wikiTarget(String(l.to)) === target;

/**
 * links.create with a card as `from`: the connection is stored in the literature note of the
 * card's item (created when missing) as a link with `from` and `evidence` set to the card. A
 * link that is already there (same target and relation) is returned unchanged; the same card and
 * target with another relation as a pending suggestion makes way for the link that was written.
 */
export function createCardLink(
  lib: Library,
  ctx: Pick<OpContext, "actor">,
  input: { card: string; link: Omit<Link, "by" | "from"> },
) {
  const { citekey } = cardRow(lib, input.card);
  const target = resolveTarget(lib, input.card, input.link.to);
  if (target === input.card) throw cardLinkErrors.self(input.card);
  const note = ensureLiteratureNote(lib, ctx.actor, citekey);
  const { file, links } = readLinks(note.path);
  const rel = input.link.rel;
  const same = (l: RawLink) => isFromCard(l, input.card) && sameTarget(l, target) && l.rel === rel;
  if (links.some((l) => same(l) && l.status !== "rejected")) return note;
  const status = input.link.status ?? "accepted";
  const kept = links.filter(
    (l) =>
      !same(l) &&
      // the person has decided on this target, so an open suggestion for it is settled
      !(
        status === "accepted" &&
        isFromCard(l, input.card) &&
        sameTarget(l, target) &&
        l.status === "proposed"
      ),
  );
  kept.push({
    ...input.link,
    from: input.card,
    evidence: input.link.evidence ?? `[[${input.card}]]`,
    by: ctx.actor,
    status,
  });
  saveLinks(lib, note.path, file, kept, ctx.actor);
  return lib.getNote(note.frontmatter.id);
}

/**
 * links.remove: deletes the typed links from a note or a card to a target (all relations when
 * `rel` is not given). Rejected suggestions stay: they are the memory that keeps them away.
 */
export function removeLink(
  lib: Library,
  ctx: Pick<OpContext, "actor">,
  input: { from: string; to: string; rel?: string | undefined },
) {
  const target = wikiTarget(input.to);
  const fromCard = isCardId(input.from);
  const note = fromCard
    ? (() => {
        const id = findLiteratureNote(lib, cardRow(lib, input.from).citekey);
        if (!id) throw cardLinkErrors.noLink(input.from, input.to);
        return lib.getNote(id);
      })()
    : lib.getNote(input.from);
  const { file, links } = readLinks(note.path);
  const hit = (l: RawLink) =>
    (fromCard ? isFromCard(l, input.from) : !l.from) &&
    sameTarget(l, target) &&
    l.status !== "rejected" &&
    (input.rel === undefined || l.rel === input.rel);
  if (!links.some(hit)) throw cardLinkErrors.noLink(input.from, input.to);
  saveLinks(
    lib,
    note.path,
    file,
    links.filter((l) => !hit(l)),
    ctx.actor,
  );
  return lib.getNote(note.frontmatter.id);
}

/** "Land 2012": authors and year of an item as the card shows them. */
export function shortCitation(lib: Library, citekey: string): string {
  const row = lib.index.get<{ authors: string | null; year: string | null; title: string }>(
    "SELECT authors, year, title FROM items WHERE citekey = ?",
    citekey,
  );
  if (!row) return citekey;
  return [row.authors, row.year].filter(Boolean).join(" ") || row.title;
}

function describeTarget(
  lib: Library,
  target: string,
): Pick<CardLink, "kind" | "label" | "short" | "citekey"> | undefined {
  const item = lib.index.get<{ title: string }>(
    "SELECT title FROM items WHERE citekey = ?",
    target,
  );
  if (item) {
    return {
      kind: "item",
      label: item.title,
      short: shortCitation(lib, target),
      citekey: target,
    };
  }
  const card = lib.index.get<{ quote: string; citekey: string }>(
    "SELECT quote, citekey FROM cards WHERE id = ?",
    target,
  );
  if (card) {
    const label = card.quote.replace(/\s+/g, " ").slice(0, 80);
    return { kind: "card", label, short: shortCitation(lib, card.citekey), citekey: card.citekey };
  }
  const note = lib.index.get<{ title: string }>(
    "SELECT title FROM notes WHERE id = ? OR slug = ?",
    target,
    target,
  );
  return note ? { kind: "note", label: note.title, short: note.title } : undefined;
}

/** links.forCard: the links that start at a card, accepted ones and suggestions, oldest first. */
export function cardLinks(lib: Library, cardId: string): CardLink[] {
  const { citekey } = cardRow(lib, cardId);
  return itemCardLinks(lib, citekey).filter((l) => l.card === cardId);
}

/** links.forItem: the links that start at any card of an item. */
export function itemCardLinks(lib: Library, citekey: string): CardLink[] {
  const noteId = findLiteratureNote(lib, citekey);
  if (!noteId) return [];
  const note = lib.getNote(noteId);
  const out: CardLink[] = [];
  note.frontmatter.links.forEach((l, index) => {
    if (!l.from || l.status === "rejected") return;
    const to = wikiTarget(l.to);
    const described = describeTarget(lib, to);
    if (!described) return;
    out.push({
      card: l.from,
      note: noteId,
      index,
      to,
      ...described,
      ...(l.rel ? { rel: l.rel } : {}),
      ...(l.why ? { why: l.why } : {}),
      by: l.by,
      status: l.status,
    });
  });
  return out;
}

/** Every target a card has a link to in any state, rejected ones included. */
export function cardLinkTargets(lib: Library, cardId: string): Set<string> {
  const { citekey } = cardRow(lib, cardId);
  const noteId = findLiteratureNote(lib, citekey);
  if (!noteId) return new Set();
  return new Set(
    lib
      .getNote(noteId)
      .frontmatter.links.filter((l) => l.from === cardId)
      .map((l) => wikiTarget(l.to)),
  );
}

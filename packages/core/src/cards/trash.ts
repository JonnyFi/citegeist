import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { ChangeEvent, Library } from "../library.js";
import { type RawLink, readLinks, saveLinks } from "../links/card-links.js";
import { wikiTarget } from "../wikilinks.js";

/** A typed link that cards.delete removed with a card, as it stood in the frontmatter of a note. */
interface RemovedLink {
  /** Id of the note whose frontmatter held the link. */
  note: string;
  /** Position in the `links` list of that note, so that a restore puts it back in place. */
  index: number;
  link: RawLink;
}

/**
 * A link that stays but loses its `evidence` because the evidence was the trashed card. `link` is
 * the entry as it stood, evidence included, so that a restore writes back exactly that.
 */
interface ClearedEvidence {
  /** Id of the note whose frontmatter held the link. */
  note: string;
  /** Position in the `links` list of that note (the list does not change in length by this). */
  index: number;
  link: RawLink;
}

/** What `trashed.json` next to a trashed card says. */
interface TrashedCard {
  id?: string;
  /** Root-relative path the card had, where cards.restore puts it back. */
  path?: string;
  /** Typed links that went with the card and come back with it. */
  removedLinks?: RemovedLink[];
  /** Links that kept their place but lost the evidence field; a restore sets it again. */
  clearedEvidence?: ClearedEvidence[];
}

function readMarker(dir: string): TrashedCard | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "trashed.json"), "utf8")) as TrashedCard;
  } catch {
    return undefined;
  }
}

/** Who refers to a card, and what a delete takes with it. */
interface Reach {
  /** One text per referring note or card, for the error message. */
  references: string[];
  /** Notes tied to the card by a typed link or a mention in their text. */
  notes: number;
  /** Other cards tied to the card the same way. */
  cards: number;
  /** Typed links that point at the card or start at it; a delete removes them. */
  links: RemovedLink[];
  /**
   * Links that cite the card as their evidence and are otherwise about other things; a delete drops
   * the evidence field and keeps the link. Rejected suggestions are in here too, but they are only
   * a memory in the file and not counted.
   */
  evidence: ClearedEvidence[];
  /** Notes and cards that mention the card in their text; the text stays as written. */
  mentions: number;
}

/** The id a wiki link value (`[[id]]`, `[[id|alias]]`) names, or undefined for anything else. */
const targetOf = (value: unknown): string | undefined =>
  typeof value === "string" ? wikiTarget(value) : undefined;

/**
 * Who refers to a card: typed links and wiki links to it, the links that start at it and the links
 * that cite it as evidence. The typed links are read from the note files so that a delete can
 * remove them (or their evidence) and a restore can put the very same entries back. Wiki links in
 * note text are only counted.
 */
function reachOf(lib: Library, id: string, cardPath: string): Reach {
  const rows = lib.index.all<{
    path: string;
    src_kind: string;
    src_ref: string;
    dst: string;
    evidence: string | null;
    origin: string;
  }>(
    `SELECT DISTINCT path, src_kind, src_ref, dst, evidence, origin FROM links
     WHERE path <> ?
       AND (dst = ? OR evidence = ? OR (src_kind = 'card' AND src_ref = ? AND origin = 'frontmatter'))`,
    cardPath,
    id,
    id,
    id,
  );
  type Row = (typeof rows)[number];
  const typed = (r: Row) =>
    r.origin === "frontmatter" &&
    (r.dst === id || r.evidence === id || (r.src_kind === "card" && r.src_ref === id));
  const label = (kind: string, ref: string): string => {
    if (kind === "card") return `card ${ref}`;
    const title = lib.index.get<{ title: string }>(
      "SELECT title FROM notes WHERE id = ?",
      ref,
    )?.title;
    return title ? `note '${title}' (${ref})` : `note ${ref}`;
  };
  const references = [
    ...new Set(
      rows.map((r) =>
        r.src_ref === id
          ? `its own link to ${r.dst} in the literature note`
          : label(r.src_kind, r.src_ref),
      ),
    ),
  ];

  const links: RemovedLink[] = [];
  const evidence: ClearedEvidence[] = [];
  // a rejected suggestion is not in the index, so the notes that hold the card id are looked at too
  const paths = new Set([
    ...rows.filter(typed).map((r) => r.path),
    ...lib.index
      .all<{ path: string }>("SELECT path FROM notes WHERE instr(frontmatter_json, ?) > 0", id)
      .map((r) => r.path),
  ]);
  for (const path of paths) {
    const note = lib.index.get<{ id: string }>("SELECT id FROM notes WHERE path = ?", path);
    if (!note) continue;
    readLinks(lib.paths.abs(path)).links.forEach((link, index) => {
      const cites = targetOf(link.evidence) === id;
      // a rejected suggestion is kept in the file as a memory, the index does not know it
      if (link.status === "rejected") {
        if (cites) evidence.push({ note: note.id, index, link });
      } else if (link.from === id || targetOf(link.to) === id) {
        links.push({ note: note.id, index, link });
      } else if (cites) {
        evidence.push({ note: note.id, index, link });
      }
    });
  }

  const others = rows.filter((r) => r.src_ref !== id);
  const owners = (kind: string) =>
    new Set(others.filter((r) => r.src_kind === kind).map((r) => r.src_ref));
  const mentioning = new Set(
    others.filter((r) => !typed(r)).map((r) => `${r.src_kind}:${r.src_ref}`),
  );
  return {
    references,
    notes: owners("note").size,
    cards: owners("card").size,
    links,
    evidence,
    mentions: mentioning.size,
  };
}

/**
 * Moves a card file into <library>/.trash/card-<id>-<stamp>/ with a trashed.json that says who
 * trashed it, when, and where it was. Only a person may delete a card. While a link or a note
 * refers to it the call is refused, and the error names the references and counts them. With
 * `force` the card goes anyway: the typed links that point at it or start at it are removed, and
 * a link that only cites it as evidence loses its `evidence` field and stays (the schema does not
 * require evidence). Both are kept in trashed.json, so that cards.restore puts them back. Wiki
 * links in note text stay as they are.
 */
export function trashCard(
  lib: Library,
  id: string,
  actor: Actor = "human",
  options: { force?: boolean } = {},
): { trashedTo: string } {
  const row = lib.index.get<{ path: string }>("SELECT path FROM cards WHERE id = ?", id);
  if (!row) {
    throw new CitegeistError({
      code: "CARD_NOT_FOUND",
      message: `no card with id '${id}'`,
      fix: "Call cards.list to find the right card id.",
      recovery: "fix-and-retry",
      context: { id },
    });
  }
  if (actor !== "human" && actor !== "system") {
    throw new CitegeistError({
      code: "TRASH_NOT_ALLOWED",
      message: `${actor} may not delete the card '${id}': only a person deletes cards`,
      fix: "Ask the user to delete it in the app.",
      recovery: "ask-human",
      context: { id },
    });
  }
  const reach = reachOf(lib, id, row.path);
  if (reach.references.length > 0 && !options.force) {
    throw new CitegeistError({
      code: "CARD_REFERENCED",
      message: `the card '${id}' is referenced: ${reach.references.join("; ")} refer to it`,
      fix: "Ask the user to confirm, then call cards.delete again with force: true. The typed links of the card are removed with it, links that cite it as evidence lose that evidence, and cards.restore brings both back.",
      recovery: "ask-human",
      context: {
        id,
        references: reach.references,
        notes: reach.notes,
        cards: reach.cards,
        links: linkCount(reach),
        mentions: reach.mentions,
      },
    });
  }
  const trash = join(lib.root, ".trash");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let dest = join(trash, `card-${id}-${stamp}`);
  for (let n = 2; existsSync(dest); n++) dest = join(trash, `card-${id}-${stamp}-${n}`);
  mkdirSync(dest, { recursive: true });
  renameSync(lib.paths.abs(row.path), join(dest, basename(row.path)));
  writeFileSync(
    join(dest, "trashed.json"),
    `${JSON.stringify(
      {
        id,
        path: row.path,
        ...(reach.links.length > 0 ? { removedLinks: reach.links } : {}),
        ...(reach.evidence.length > 0 ? { clearedEvidence: reach.evidence } : {}),
        ...lib.stamp(actor),
      },
      null,
      2,
    )}\n`,
  );
  const result = lib.indexer.removePath(row.path);
  if (result.status === "removed") {
    lib.emit("change", { rel: row.path, status: "removed", external: false } satisfies ChangeEvent);
  }
  // dropping the evidence keeps every position, so it goes first and the removal can use them
  clearEvidence(lib, reach.evidence, actor);
  removeLinks(lib, reach.links, actor);
  return { trashedTo: dest };
}

/** Links a delete touches and the person can see: removed ones and ones that lose their evidence. */
function linkCount(reach: Reach): number {
  return reach.links.length + reach.evidence.filter((e) => e.link.status !== "rejected").length;
}

/** Drops the `evidence` field of the links that cited the trashed card; the links stay in place. */
function clearEvidence(lib: Library, cleared: ClearedEvidence[], actor: Actor): void {
  for (const noteId of new Set(cleared.map((c) => c.note))) {
    const path = lib.index.get<{ path: string }>(
      "SELECT path FROM notes WHERE id = ?",
      noteId,
    )?.path;
    if (!path) continue;
    const { file, links } = readLinks(lib.paths.abs(path));
    let changed = false;
    for (const c of cleared.filter((x) => x.note === noteId)) {
      if (!isDeepStrictEqual(links[c.index], c.link)) continue;
      const { evidence: _gone, ...rest } = c.link;
      links[c.index] = rest;
      changed = true;
    }
    if (changed) saveLinks(lib, lib.paths.abs(path), file, links, actor);
  }
}

/** Gives the links back the evidence that cards.delete dropped, writing the entry as it was. */
function restoreEvidence(lib: Library, cleared: ClearedEvidence[], actor: Actor): void {
  for (const noteId of new Set(cleared.map((c) => c.note))) {
    const path = lib.index.get<{ path: string }>(
      "SELECT path FROM notes WHERE id = ?",
      noteId,
    )?.path;
    if (!path) continue;
    const { file, links } = readLinks(lib.paths.abs(path));
    let changed = false;
    for (const c of cleared.filter((x) => x.note === noteId)) {
      const { evidence: _gone, ...rest } = c.link;
      const bare = (i: number) => isDeepStrictEqual(links[i], rest);
      const at = bare(c.index) ? c.index : links.findIndex((_, i) => bare(i));
      // the link was changed or deleted since: its evidence is not brought back by guessing
      if (at < 0) continue;
      links[at] = c.link;
      changed = true;
    }
    if (changed) saveLinks(lib, lib.paths.abs(path), file, links, actor);
  }
}

/** Takes the entries out of the `links` list of their notes (trashed.json has them by then). */
function removeLinks(lib: Library, removed: RemovedLink[], actor: Actor): void {
  for (const noteId of new Set(removed.map((r) => r.note))) {
    const path = lib.index.get<{ path: string }>(
      "SELECT path FROM notes WHERE id = ?",
      noteId,
    )?.path;
    if (!path) continue;
    const gone = removed.filter((r) => r.note === noteId).map((r) => r.index);
    const { file, links } = readLinks(lib.paths.abs(path));
    saveLinks(
      lib,
      lib.paths.abs(path),
      file,
      links.filter((_, i) => !gone.includes(i)),
      actor,
    );
  }
}

/** Puts removed links back into their notes at their old places; a link that is there again stays single. */
function readdLinks(lib: Library, removed: RemovedLink[], actor: Actor): void {
  for (const noteId of new Set(removed.map((r) => r.note))) {
    const path = lib.index.get<{ path: string }>(
      "SELECT path FROM notes WHERE id = ?",
      noteId,
    )?.path;
    // the note is gone since, and so is the place for its links
    if (!path) continue;
    const { file, links } = readLinks(lib.paths.abs(path));
    let changed = false;
    for (const r of removed.filter((x) => x.note === noteId).sort((a, b) => a.index - b.index)) {
      if (links.some((l) => isDeepStrictEqual(l, r.link))) continue;
      links.splice(Math.min(r.index, links.length), 0, r.link);
      changed = true;
    }
    if (changed) saveLinks(lib, lib.paths.abs(path), file, links, actor);
  }
}

/**
 * cards.restore: moves the newest trashed copy of a card back to its old path and indexes it, and
 * puts back the typed links that cards.delete removed with it and the evidence it dropped.
 */
export function restoreCard(lib: Library, id: string, actor: Actor = "human"): void {
  const fail = (code: string, message: string, fix: string) =>
    new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context: { id } });
  if (lib.index.get("SELECT id FROM cards WHERE id = ?", id)) {
    throw fail("CARD_EXISTS", `the card '${id}' is in the library`, "Nothing to restore.");
  }
  const trash = join(lib.root, ".trash");
  const newest = existsSync(trash)
    ? readdirSync(trash)
        .filter(
          (name) => name.startsWith(`card-${id}-`) && readMarker(join(trash, name))?.id === id,
        )
        .sort()
        .at(-1)
    : undefined;
  const marker = newest ? readMarker(join(trash, newest)) : undefined;
  const rel = marker?.path;
  if (!newest || !rel) {
    throw fail(
      "NOT_IN_TRASH",
      `no trashed card with id '${id}'`,
      "Check the card id, or look in the .trash folder of the library.",
    );
  }
  const target = lib.paths.abs(rel);
  if (existsSync(target)) {
    throw fail(
      "CARD_PATH_TAKEN",
      `cannot restore the card: ${rel} exists again`,
      "Rename the file that is there, then restore.",
    );
  }
  const from = join(trash, newest);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(from, basename(rel)), target);
  rmSync(from, { recursive: true, force: true });
  const result = lib.indexer.indexFile(rel);
  lib.emit("change", { ...result, external: false } satisfies ChangeEvent);
  readdLinks(lib, marker?.removedLinks ?? [], actor);
  restoreEvidence(lib, marker?.clearedEvidence ?? [], actor);
}

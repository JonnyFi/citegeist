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

/** What `trashed.json` next to a trashed card says. */
interface TrashedCard {
  id?: string;
  /** Root-relative path the card had, where cards.restore puts it back. */
  path?: string;
  /** Typed links that went with the card and come back with it. */
  removedLinks?: RemovedLink[];
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
  /** Notes and cards that mention the card in their text; the text stays as written. */
  mentions: number;
}

/**
 * Who refers to a card: typed links and wiki links to it, and the links that start at it. The typed
 * links are read from the note files so that a delete can remove them and a restore can put the
 * very same entries back. Wiki links in note text are only counted.
 */
function reachOf(lib: Library, id: string, cardPath: string): Reach {
  const rows = lib.index.all<{
    path: string;
    src_kind: string;
    src_ref: string;
    dst: string;
    origin: string;
  }>(
    `SELECT DISTINCT path, src_kind, src_ref, dst, origin FROM links
     WHERE path <> ?
       AND (dst = ? OR evidence = ? OR (src_kind = 'card' AND src_ref = ? AND origin = 'frontmatter'))`,
    cardPath,
    id,
    id,
    id,
  );
  type Row = (typeof rows)[number];
  const typed = (r: Row) =>
    r.origin === "frontmatter" && (r.dst === id || (r.src_kind === "card" && r.src_ref === id));
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
  for (const path of new Set(rows.filter(typed).map((r) => r.path))) {
    const note = lib.index.get<{ id: string }>("SELECT id FROM notes WHERE path = ?", path);
    if (!note) continue;
    readLinks(lib.paths.abs(path)).links.forEach((link, index) => {
      // a rejected suggestion is kept in the file as a memory, the index does not know it
      if (link.status === "rejected") return;
      if (link.from === id || wikiTarget(String(link.to)) === id) {
        links.push({ note: note.id, index, link });
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
    mentions: mentioning.size,
  };
}

/**
 * Moves a card file into <library>/.trash/card-<id>-<stamp>/ with a trashed.json that says who
 * trashed it, when, and where it was. Only a person may delete a card. While a link or a note
 * refers to it the call is refused, and the error names the references and counts them. With
 * `force` the card goes anyway: the typed links that point at it or start at it are removed and
 * kept in trashed.json, so that cards.restore puts them back. Wiki links in note text stay as
 * they are.
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
      fix: "Ask the user to confirm, then call cards.delete again with force: true. The typed links of the card are removed with it, and cards.restore brings them back.",
      recovery: "ask-human",
      context: {
        id,
        references: reach.references,
        notes: reach.notes,
        cards: reach.cards,
        links: reach.links.length,
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
  removeLinks(lib, reach.links, actor);
  return { trashedTo: dest };
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
 * puts back the typed links that cards.delete removed with it.
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
}

import { cleanNote, moveEntry, nextToRead, orderReading } from "@citegeist/ops";
import { CitegeistError, type ReadingEntry } from "@citegeist/schema";
import type { Library } from "./library.js";

type ItemSummary = ReturnType<Library["listItems"]>["items"][number];

export interface ReadingList {
  entries: { item: ItemSummary; note?: string }[];
  total: number;
  read: number;
  next?: string;
}

/** The accepted items of a project. Items in the inbox are not part of the reading list yet. */
function projectItems(lib: Library, slug: string): ItemSummary[] {
  const out: ItemSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = lib.listItems({ project: slug, inbox: false, limit: 500, cursor });
    out.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return out;
}

/**
 * The reading list of a project: the order stored in `reading` of project.md applied to the
 * accepted items of the project (docs/decisions/0035-ordered-reading-list.md).
 */
export function readingList(lib: Library, slug: string): ReadingList {
  const { frontmatter } = lib.getProject(slug);
  const ordered = orderReading(frontmatter.reading, projectItems(lib, slug));
  const entries = ordered.map(({ member, note }) => ({ item: member, ...(note ? { note } : {}) }));
  const next = nextToRead(entries.map((e) => ({ ...e, status: e.item.status })));
  return {
    entries,
    total: entries.length,
    read: entries.filter((e) => e.item.status === "read").length,
    ...(next ? { next: next.item.citekey } : {}),
  };
}

/** Writes the whole order into project.md, so that the file shows what the list looks like. */
function store(lib: Library, slug: string, order: readonly ReadingEntry[]): void {
  lib.updateProject({ slug, patch: { reading: order.length > 0 ? order : null } });
}

const orderOf = (list: ReadingList): ReadingEntry[] =>
  list.entries.map((e) => ({ item: e.item.citekey, ...(e.note ? { note: e.note } : {}) }));

function requireEntry(list: ReadingList, slug: string, citekey: string): void {
  if (list.entries.some((e) => e.item.citekey === citekey)) return;
  throw new CitegeistError({
    code: "NOT_IN_READING_LIST",
    message: `item '${citekey}' is not on the reading list of project '${slug}'`,
    fix: "Add the item to the project with projects.addItems (an item in the inbox has to be accepted first), or read the list with projects.reading.",
    recovery: "fix-and-retry",
    context: { slug, citekey },
  });
}

/** Moves an item to a position of the reading list (0 is first). */
export function moveReading(
  lib: Library,
  slug: string,
  citekey: string,
  position: number,
): ReadingList {
  const list = readingList(lib, slug);
  requireEntry(list, slug, citekey);
  store(lib, slug, moveEntry(orderOf(list), citekey, position));
  return readingList(lib, slug);
}

/** Sets or, with an empty note, clears the note on an entry of the reading list. */
export function setReadingNote(
  lib: Library,
  slug: string,
  citekey: string,
  note: string,
): ReadingList {
  const list = readingList(lib, slug);
  requireEntry(list, slug, citekey);
  const text = cleanNote(note);
  store(
    lib,
    slug,
    orderOf(list).map((e) => {
      if (e.item !== citekey) return e;
      return text ? { item: e.item, note: text } : { item: e.item };
    }),
  );
  return readingList(lib, slug);
}

/**
 * Puts items that just joined the project at `position` of the reading list. Items that are not
 * on the list (the ones still in the inbox) are left out; they join the end when they are accepted.
 */
export function placeReading(
  lib: Library,
  slug: string,
  citekeys: readonly string[],
  position: number,
): void {
  const order = orderOf(readingList(lib, slug));
  const placed = citekeys.flatMap((k) => order.filter((e) => e.item === k));
  if (placed.length === 0) return;
  const rest = order.filter((e) => !citekeys.includes(e.item));
  rest.splice(Math.min(position, rest.length), 0, ...placed);
  store(lib, slug, rest);
}

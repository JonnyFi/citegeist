import { existsSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname } from "node:path";
import { slugify } from "../ids.js";
import { markdownFiles, rewriteWikiLinks } from "../ingest/items.js";
import type { ChangeEvent, Library } from "../library.js";

/** Whether a note or a concept already has this file name. Wiki links address both by slug. */
export function noteSlugTaken(lib: Library, slug: string): boolean {
  return existsSync(lib.paths.noteFile(slug)) || existsSync(lib.paths.conceptFile(slug));
}

/**
 * The slug a note with this title gets, or the first free `<slug>-2`, `-3` when it is taken. A
 * note keeps its own name when that name already fits the title, `beobachtung-2` included.
 */
export function freeNoteSlug(lib: Library, title: string, own: string): string {
  const base = slugify(title);
  if (own === base || (own.startsWith(`${base}-`) && /^\d+$/.test(own.slice(base.length + 1)))) {
    return own;
  }
  let slug = base;
  for (let n = 2; noteSlugTaken(lib, slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Gives a note the file name its new title asks for and rewrites every `[[old-slug]]` in items,
 * cards, notes and projects. Links by note id stay as they are. Returns the new slug and how many
 * other files changed. A note whose slug already fits the title is left alone.
 */
export function renameNoteFile(
  lib: Library,
  rel: string,
  title: string,
): { rel: string; slug: string; rewritten: number } {
  const oldSlug = basename(rel, ".md");
  const slug = freeNoteSlug(lib, title, oldSlug);
  if (slug === oldSlug) return { rel, slug, rewritten: 0 };

  const folder = dirname(rel);
  const next = `${folder}/${slug}.md`;
  renameSync(lib.paths.abs(rel), lib.paths.abs(next));
  const removed = lib.indexer.removePath(rel);
  lib.emit("change", { ...removed, external: false } satisfies ChangeEvent);
  const added = lib.indexer.indexFile(next);
  lib.emit("change", { ...added, external: false } satisfies ChangeEvent);

  let rewritten = 0;
  for (const file of markdownFiles(lib)) {
    const raw = readFileSync(lib.paths.abs(file), "utf8");
    const { text, count } = rewriteWikiLinks(raw, oldSlug, slug);
    if (count === 0) continue;
    lib.writeFile(file, text);
    if (file !== next) rewritten++;
  }
  return { rel: next, slug, rewritten };
}

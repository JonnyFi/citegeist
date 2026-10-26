import { generateCitekey } from "@citegeist/cite";
import type { ItemFrontmatter } from "@citegeist/schema";
import type { Library } from "../library.js";

type Fm = ItemFrontmatter & Record<string, unknown>;

export function hasCreators(fm: Fm): boolean {
  return (fm.author?.length ?? 0) > 0 || (fm.editor?.length ?? 0) > 0;
}

/** What the citekey formula reads from an item. */
export function keySource(fm: Record<string, unknown>) {
  return {
    title: String(fm.title),
    ...(fm.author ? { author: fm.author as never } : {}),
    ...(fm.editor ? { editor: fm.editor as never } : {}),
    ...(fm.issued !== undefined ? { issued: fm.issued as never } : {}),
  };
}

/** True when the item names no author or editor, or no year: what the library list marks. */
export function hasThinMetadata(fm: Fm): boolean {
  return !hasCreators(fm) || fm.issued === undefined;
}

/**
 * A citekey that was made from missing data: it was generated when the item had no author or no
 * year (anon, nd). It counts as a placeholder also after the item got the missing part, as long
 * as the key still looks like the one the formula gave for the thinner item.
 */
export function isPlaceholderKey(fm: Fm, formula: string): boolean {
  const base = (f: Record<string, unknown>): string =>
    generateCitekey(keySource(f), new Set(), formula);
  const thin = hasThinMetadata(fm);
  if (thin && fm.citekey.startsWith(base(fm))) return true;
  const full = base(fm);
  const reduced = [
    base({ ...fm, author: undefined, editor: undefined, issued: undefined }),
    base({ ...fm, author: undefined, editor: undefined }),
    base({ ...fm, issued: undefined }),
  ];
  return (
    reduced.some((r) => r !== full && fm.citekey.startsWith(r)) && !fm.citekey.startsWith(full)
  );
}

/**
 * The citekey an item should have now, when its old one was a placeholder and the metadata has
 * since got an author and a year. Undefined when the old key was a real one, when the metadata is
 * still thin, or when the formula gives the same key. Nothing is renamed: the caller offers it.
 */
export function suggestCitekey(lib: Library, before: Fm, after: Fm): string | undefined {
  const formula = lib.manifest.defaults.citekey;
  if (!isPlaceholderKey(before, formula) || hasThinMetadata(after)) return undefined;
  const existing = new Set(
    lib.index.all<{ citekey: string }>("SELECT citekey FROM items").map((r) => r.citekey),
  );
  existing.delete(after.citekey);
  const next = generateCitekey(keySource(after), existing, formula);
  return next !== after.citekey ? next : undefined;
}

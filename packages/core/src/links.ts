import { readFileSync } from "node:fs";
import type { OpContext } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { MarkdownFile } from "./frontmatter.js";
import type { Library } from "./library.js";
import { createCardLink, isCardId } from "./links/card-links.js";
import { wikiTarget } from "./wikilinks.js";

/**
 * links.create: adds one typed link to the frontmatter of a note (or, for a card id in `from`,
 * to the literature note of the card's item) and stamps the caller. The
 * target must exist as item, card or note, so a typo never becomes a dangling link. A link that
 * is already there (same target and relation) is returned unchanged.
 */
export function createLink(
  lib: Library,
  ctx: OpContext,
  input: { from: string; link: { to: string; rel?: string | undefined } & Record<string, unknown> },
) {
  if (isCardId(input.from)) {
    return createCardLink(lib, ctx, {
      card: input.from,
      link: input.link as Parameters<typeof createCardLink>[2]["link"],
    });
  }
  const note = lib.getNote(input.from);
  const target = wikiTarget(input.link.to);
  const known =
    lib.index.get("SELECT 1 AS found FROM items WHERE citekey = ?", target) ??
    lib.index.get("SELECT 1 AS found FROM cards WHERE id = ?", target) ??
    lib.index.get("SELECT 1 AS found FROM notes WHERE id = ? OR slug = ?", target, target);
  if (!known) {
    throw new CitegeistError({
      code: "LINK_TARGET_NOT_FOUND",
      message: `Nothing in the library is called ${target}, so the link from ${input.from} was not written.`,
      fix: 'Find the citekey, card id or note id with the search tool, then call link again with "[[<id>]]".',
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { from: input.from, to: input.link.to },
    });
  }
  const same = (l: { to: string; rel?: string | undefined; from?: string | undefined }) =>
    !l.from && wikiTarget(l.to) === target && l.rel === input.link.rel;
  const exists = note.frontmatter.links.some((l) => same(l) && l.status !== "rejected");
  if (exists) return note;
  const file = MarkdownFile.parse(readFileSync(note.path, "utf8"));
  file.patch({
    // A person who creates a link again overrules an earlier rejection.
    links: [...note.frontmatter.links.filter((l) => !same(l)), { ...input.link, by: ctx.actor }],
    modified: lib.stamp(ctx.actor),
  });
  lib.writeFile(lib.paths.rel(note.path), file.toString());
  return lib.getNote(input.from);
}

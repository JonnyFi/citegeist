import { readFileSync } from "node:fs";
import { type Library, MarkdownFile, wikiTarget } from "@citegeist/core";
import { linksCreate, type Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";

/**
 * Binds links.create to a registry that has no handler for it yet: the `link` MCP tool and
 * `cg links create` need it, and the core does not ship it. It adds one typed link to the
 * frontmatter of a note and stamps the caller. A registry that already binds the operation is
 * left alone, so this becomes a no-op as soon as the core provides it.
 */
export function bindLinkOperations(registry: Registry, lib: Library): Registry {
  if (registry.get(linksCreate.name)) return registry;
  return registry.bind(linksCreate, async (ctx, input) => {
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
    const exists = note.frontmatter.links.some(
      (l) => wikiTarget(l.to) === target && l.rel === input.link.rel,
    );
    if (exists) return note;
    const file = MarkdownFile.parse(readFileSync(note.path, "utf8"));
    file.patch({
      links: [...note.frontmatter.links, { ...input.link, by: ctx.actor }],
      modified: lib.stamp(ctx.actor),
    });
    lib.writeFile(lib.paths.rel(note.path), file.toString());
    return lib.getNote(input.from);
  });
}

import { type CiteRef, formatCite } from "@citegeist/cite";
import { CitegeistError, type ItemFrontmatter } from "@citegeist/schema";
import type { Library } from "./library.js";

/**
 * cite.format: formats citations or a bibliography with @citegeist/cite. Style and locale come
 * from the request, then the project, then the library defaults.
 */
export function formatCitations(
  lib: Library,
  input: {
    items: CiteRef[];
    mode: "citation" | "bibliography";
    style?: string | undefined;
    locale?: string | undefined;
    project?: string | undefined;
    format: "text" | "html" | "pandoc" | "bibtex" | "csl-json";
  },
) {
  const project = input.project ? lib.getProject(input.project).frontmatter : undefined;
  const defaults = lib.manifest.defaults;
  // Unknown citekeys stay out of the map, so the formatter raises CITE_UNKNOWN_ITEM for them.
  const known = new Map<string, ItemFrontmatter>();
  for (const { citekey } of input.items) {
    if (known.has(citekey)) continue;
    try {
      known.set(citekey, lib.getItem(citekey).frontmatter);
    } catch (err) {
      if (!(err instanceof CitegeistError && err.detail.code === "ITEM_NOT_FOUND")) throw err;
    }
  }
  return formatCite(
    known,
    {
      items: input.items,
      mode: input.mode,
      style: input.style,
      locale: input.locale,
      format: input.format,
    },
    {
      style: project?.style ?? defaults.style,
      locale: project?.locale ?? defaults.locale,
    },
  );
}

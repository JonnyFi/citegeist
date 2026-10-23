import type { ItemFrontmatter } from "@citegeist/schema";
import { toBibtex } from "./bibtex.js";
import { type CslItem, itemToCsl } from "./csl.js";
import {
  type CiteRef,
  DEFAULT_LOCALE,
  DEFAULT_STYLE,
  type Library,
  renderBibliography,
  renderCitation,
} from "./render.js";
import { localeTerms } from "./styles.js";

export type CiteFormatKind = "text" | "html" | "pandoc" | "bibtex" | "csl-json";

export interface CiteFormatRequest {
  items: readonly CiteRef[];
  mode?: "citation" | "bibliography" | undefined;
  style?: string | undefined;
  locale?: string | undefined;
  format?: CiteFormatKind | undefined;
}

export interface CiteFormatResult {
  text: string;
  html?: string;
}

function pickItems(library: Library, citekeys: readonly string[]): ItemFrontmatter[] {
  const all = Array.isArray(library)
    ? (library as readonly ItemFrontmatter[])
    : [...(library as ReadonlyMap<string, ItemFrontmatter>).values()];
  const unique = [...new Set(citekeys)];
  return unique.flatMap((k) => all.filter((i) => i.citekey === k));
}

/** A Pandoc citation cluster: `[vgl. @luhmann1984soziale, S. 31; @foo2020bar]`. */
export function pandocCluster(refs: readonly CiteRef[], locale: string | undefined): string {
  const terms = localeTerms(locale);
  const parts = refs.map((r) => {
    let loc = "";
    if (r.locator) {
      const label = r.label ?? "page";
      const term = terms.short.get(label) ?? terms.long.get(label);
      const plural = /[-–,&]/.test(r.locator);
      loc = `, ${term ? `${plural ? term.multiple : term.single} ` : ""}${r.locator}`;
    }
    const suffix = r.suffix ? ` ${r.suffix.trim()}` : "";
    return `${r.prefix ? `${r.prefix.trim()} ` : ""}@${r.citekey}${loc}${suffix}`;
  });
  return `[${parts.join("; ")}]`;
}

/**
 * Handler for the cite.format operation. Throws CITE_UNKNOWN_ITEM (a CitegeistError) when a
 * citekey is not in the library and CITE_UNKNOWN_STYLE for a style that is not available.
 */
export function formatCite(
  library: Library,
  req: CiteFormatRequest,
  defaults: { style?: string | undefined; locale?: string | undefined } = {},
): CiteFormatResult {
  const style = req.style ?? defaults.style ?? DEFAULT_STYLE;
  const locale = req.locale ?? defaults.locale ?? DEFAULT_LOCALE;
  const mode = req.mode ?? "citation";
  const format = req.format ?? "text";
  const keys = req.items.map((i) => i.citekey);

  switch (format) {
    case "bibtex":
      return { text: toBibtex(requireAll(library, keys)) };
    case "csl-json":
      return { text: exportCslJson(requireAll(library, keys)) };
    case "pandoc":
      if (mode === "citation") {
        requireAll(library, keys);
        return { text: pandocCluster(req.items, locale) };
      }
      return { text: renderBibliography(library, keys, { style, locale, format: "text" }) };
    case "html": {
      const run = (f: "text" | "html") =>
        mode === "citation"
          ? renderCitation(library, req.items, { style, locale, format: f })
          : renderBibliography(library, keys, { style, locale, format: f });
      return { text: run("text"), html: run("html") };
    }
    default:
      return {
        text:
          mode === "citation"
            ? renderCitation(library, req.items, { style, locale, format: "text" })
            : renderBibliography(library, keys, { style, locale, format: "text" }),
      };
  }
}

function requireAll(library: Library, citekeys: readonly string[]): ItemFrontmatter[] {
  const found = pickItems(library, citekeys);
  if (found.length < new Set(citekeys).size) {
    // Reuse the error of the renderer for the first missing key.
    renderCitation(
      library,
      citekeys.map((citekey) => ({ citekey })),
    );
  }
  return found;
}

// Project export --------------------------------------------------------------------------------------

/** All items as a CSL-JSON array whose ids are the citekeys, pretty printed. */
export function exportCslJson(items: readonly ItemFrontmatter[]): string {
  const csl: CslItem[] = items.map(itemToCsl);
  return `${JSON.stringify(csl, null, 2)}\n`;
}

/** Project export as a `.bib` file (BibLaTeX by default). */
export function exportProjectBib(
  items: readonly ItemFrontmatter[],
  opts: { flavor?: "biblatex" | "bibtex" } = {},
): string {
  return toBibtex(items, opts);
}

/** Project export as a CSL-JSON file. */
export function exportProjectCslJson(items: readonly ItemFrontmatter[]): string {
  return exportCslJson(items);
}

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { CitegeistError, type ItemFrontmatter } from "@citegeist/schema";
import { itemToCsl } from "./csl.js";
import { assertStyle, ensureRegistered, resolveLocale } from "./styles.js";

export const DEFAULT_STYLE = "apa";
export const DEFAULT_LOCALE = "de-DE";

/** One cited work with the parts of a CSL citation item that citegeist uses. */
export interface CiteRef {
  citekey: string;
  /** Locator text such as "31" or "31-33". */
  locator?: string | undefined;
  /** CSL locator label such as "page" (default when a locator is given), "chapter", "section". */
  label?: string | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
}

export interface RenderOptions {
  style?: string | undefined;
  locale?: string | undefined;
  format?: "text" | "html" | undefined;
}

export type Library = readonly ItemFrontmatter[] | ReadonlyMap<string, ItemFrontmatter>;

function lookup(library: Library, citekey: string): ItemFrontmatter {
  const item = Array.isArray(library)
    ? (library as readonly ItemFrontmatter[]).find((i) => i.citekey === citekey)
    : (library as ReadonlyMap<string, ItemFrontmatter>).get(citekey);
  if (!item) {
    throw new CitegeistError({
      code: "CITE_UNKNOWN_ITEM",
      message: `No item with citekey "${citekey}" in the library`,
      fix: "Check the citekey, for example with the search operation",
      recovery: "fix-and-retry",
      context: { citekey },
    });
  }
  return item;
}

function citeItem(ref: CiteRef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: ref.citekey };
  if (ref.locator) {
    out.locator = ref.locator;
    out.label = ref.label ?? "page";
  }
  if (ref.prefix) out.prefix = ref.prefix;
  if (ref.suffix) out.suffix = ref.suffix;
  return out;
}

function prepare(library: Library, citekeys: readonly string[], opts: RenderOptions) {
  ensureRegistered();
  const style = opts.style ?? DEFAULT_STYLE;
  assertStyle(style);
  const unique = [...new Set(citekeys)];
  const csl = unique.map((k) => itemToCsl(lookup(library, k)));
  return {
    cite: new Cite(csl),
    style,
    lang: resolveLocale(opts.locale ?? DEFAULT_LOCALE),
    format: opts.format ?? "text",
  };
}

/** Renders one citation cluster, for example "(vgl. Luhmann, 1984, S. 31)". */
export function renderCitation(
  library: Library,
  refs: readonly CiteRef[],
  opts: RenderOptions = {},
): string {
  const { cite, style, lang, format } = prepare(
    library,
    refs.map((r) => r.citekey),
    opts,
  );
  return cite.format("citation", {
    style,
    lang,
    format,
    // citation-js types only the CSL label union; unknown labels are validated by citeproc.
    entry: refs.map(citeItem) as unknown as string[],
    citationsPre: [],
    citationsPost: [],
  }) as string;
}

/** Renders the bibliography of the given citekeys, one entry per line in text format. */
export function renderBibliography(
  library: Library,
  citekeys: readonly string[],
  opts: RenderOptions = {},
): string {
  const { cite, style, lang, format } = prepare(library, citekeys, opts);
  const out = cite.format("bibliography", { style, lang, format }) as string;
  return format === "text" ? out.replace(/\n+$/, "") : out;
}

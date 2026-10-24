export const name = "@citegeist/cite";

export {
  type BibtexParseResult,
  type BibtexWriteOptions,
  parseBibtex,
  toBibtex,
} from "./bibtex.js";
export {
  type CardExportEntry,
  type CardExportFormat,
  type CardExportMode,
  type CardExportOptions,
  type CardExportResult,
  exportCard,
  exportCards,
  type ParaphraseSource,
} from "./cardexport.js";
export {
  asciiFold,
  baseCitekey,
  type CitekeySource,
  DEFAULT_CITEKEY_FORMULA,
  disambiguateCitekey,
  generateCitekey,
  resolveImportedCitekey,
  sanitizeCitekey,
} from "./citekey.js";
export {
  type CslItem,
  cslToDraft,
  type FinalizeOptions,
  finalizeDraft,
  fullTitle,
  type ItemDraft,
  itemToCsl,
} from "./csl.js";
export {
  type CiteFormatKind,
  type CiteFormatRequest,
  type CiteFormatResult,
  exportCslJson,
  exportProjectBib,
  exportProjectCslJson,
  formatCite,
  pandocCluster,
} from "./format.js";
export {
  type CiteRef,
  DEFAULT_LOCALE,
  DEFAULT_STYLE,
  type Library,
  type RenderOptions,
  renderBibliography,
  renderCitation,
} from "./render.js";
export { parseRis, type RisParseResult, toRis } from "./ris.js";
export {
  BUNDLED_LOCALES,
  BUNDLED_STYLES,
  type BundledLocale,
  type BundledStyle,
  hasStyle,
  localeTerms,
  registerStyle,
  resolveLocale,
  styleXml,
} from "./styles.js";

import { type CslItem, cslToDraft, type ItemDraft } from "./csl.js";

/** Reads CSL-JSON (an array of items or a single item) into item drafts. */
export function parseCslJson(input: string): ItemDraft[] {
  const data: unknown = JSON.parse(input);
  const list = Array.isArray(data) ? data : [data];
  return list
    .filter((x): x is CslItem => typeof x === "object" && x !== null)
    .map((x) => cslToDraft(x as Record<string, unknown>));
}

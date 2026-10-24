import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { CitegeistError } from "@citegeist/schema";

/** CSL style ids shipped with citegeist. The file name in `vendor/` is `<id>.csl`. */
export const BUNDLED_STYLES = [
  "apa",
  "chicago-author-date",
  "deutsche-gesellschaft-fur-psychologie",
] as const;
export type BundledStyle = (typeof BUNDLED_STYLES)[number];

/** CSL locales shipped with citegeist. The file name in `vendor/` is `locales-<id>.xml`. */
export const BUNDLED_LOCALES = ["de-DE", "en-US"] as const;
export type BundledLocale = (typeof BUNDLED_LOCALES)[number];

interface CslConfig {
  styles: {
    add(name: string, xml: string): void;
    has(name: string): boolean;
  };
  locales: {
    add(name: string, xml: string): void;
    has(name: string): boolean;
  };
}

function config(): CslConfig {
  return plugins.config.get("@csl") as unknown as CslConfig;
}

function readVendor(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./vendor/${file}`, import.meta.url)), "utf8");
}

const localeXml = new Map<string, string>();
let registered = false;
const customStyles = new Set<string>();
const customXml = new Map<string, string>();

/** Registers the vendored styles and locales with citation-js. Idempotent. */
export function ensureRegistered(): void {
  if (registered) return;
  const cfg = config();
  for (const id of BUNDLED_STYLES) cfg.styles.add(id, readVendor(`${id}.csl`));
  for (const id of BUNDLED_LOCALES) {
    const xml = readVendor(`locales-${id}.xml`);
    localeXml.set(id, xml);
    cfg.locales.add(id, xml);
  }
  registered = true;
}

/** Adds a user supplied CSL style (a `.csl` file's XML) under the given id. */
export function registerStyle(id: string, xml: string): void {
  ensureRegistered();
  config().styles.add(id, xml);
  customStyles.add(id);
  customXml.set(id, xml);
}

/** The XML of a bundled or registered CSL style, for tools such as Pandoc that read the file. */
export function styleXml(id: string): string | undefined {
  ensureRegistered();
  if ((BUNDLED_STYLES as readonly string[]).includes(id)) return readVendor(`${id}.csl`);
  return customXml.get(id);
}

export function hasStyle(id: string): boolean {
  ensureRegistered();
  return (BUNDLED_STYLES as readonly string[]).includes(id) || customStyles.has(id);
}

/**
 * Picks the locale to render with: an exact bundled match, else the bundled locale of the same
 * language (de-AT gives de-DE), else en-US.
 */
export function resolveLocale(locale: string | undefined): BundledLocale {
  const wanted = (locale ?? "de-DE").replace("_", "-");
  const exact = BUNDLED_LOCALES.find((l) => l.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const lang = wanted.split("-")[0]?.toLowerCase();
  return BUNDLED_LOCALES.find((l) => l.split("-")[0] === lang) ?? "en-US";
}

export function assertStyle(id: string): void {
  if (hasStyle(id)) return;
  throw new CitegeistError({
    code: "CITE_UNKNOWN_STYLE",
    message: `CSL style "${id}" is not available`,
    fix: `Use one of: ${[...BUNDLED_STYLES, ...customStyles].join(", ")}`,
    recovery: "fix-and-retry",
    context: { style: id },
  });
}

export interface LocaleTerms {
  openQuote: string;
  closeQuote: string;
  openInnerQuote: string;
  closeInnerQuote: string;
  /** Short and long forms by CSL term name, e.g. page: { single: "S.", multiple: "S." }. */
  short: Map<string, { single: string; multiple: string }>;
  long: Map<string, { single: string; multiple: string }>;
}

const termCache = new Map<BundledLocale, LocaleTerms>();

function decode(s: string): string {
  return s
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Reads quotation marks and locator terms from the vendored locale file. */
export function localeTerms(locale: string | undefined): LocaleTerms {
  ensureRegistered();
  const id = resolveLocale(locale);
  const cached = termCache.get(id);
  if (cached) return cached;
  const xml = localeXml.get(id) ?? "";
  const terms: LocaleTerms = {
    openQuote: "“",
    closeQuote: "”",
    openInnerQuote: "‘",
    closeInnerQuote: "’",
    short: new Map(),
    long: new Map(),
  };
  const re = /<term\s+name="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/term>)/g;
  for (const m of xml.matchAll(re)) {
    const name = m[1] ?? "";
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    const form = /form="([^"]+)"/.exec(attrs)?.[1] ?? "long";
    const single = /<single>([\s\S]*?)<\/single>/.exec(inner)?.[1];
    const multiple = /<multiple>([\s\S]*?)<\/multiple>/.exec(inner)?.[1];
    const plain = decode(inner);
    if (form === "long" || form === "short") {
      const entry = {
        single: single !== undefined ? decode(single) : plain,
        multiple: multiple !== undefined ? decode(multiple) : plain,
      };
      (form === "short" ? terms.short : terms.long).set(name, entry);
    }
    if (form === "long" && single === undefined) {
      if (name === "open-quote") terms.openQuote = plain;
      if (name === "close-quote") terms.closeQuote = plain;
      if (name === "open-inner-quote") terms.openInnerQuote = plain;
      if (name === "close-inner-quote") terms.closeInnerQuote = plain;
    }
  }
  termCache.set(id, terms);
  return terms;
}

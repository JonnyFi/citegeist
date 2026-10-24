import {
  type CardBody,
  type CardFrontmatter,
  ExportPolicy,
  type ItemFrontmatter,
} from "@citegeist/schema";
import { DEFAULT_LOCALE, DEFAULT_STYLE, renderCitation } from "./render.js";
import { type LocaleTerms, localeTerms, resolveLocale } from "./styles.js";

export type CardExportFormat = "html" | "text" | "pandoc" | "latex" | "typst";
export type ParaphraseSource = "ai" | "own" | "own-else-ai" | "none";
type ResolvedPolicy = ReturnType<typeof ExportPolicy.parse>;
export type CardExportMode = "direct" | "indirect";

export interface CardExportEntry {
  card: Pick<CardFrontmatter, "locator">;
  body: Pick<CardBody, "quote" | "paraphrase" | "note">;
  item: ItemFrontmatter;
  /** The secondary source for "zit. n." citations (CardFrontmatter.via), resolved by the caller. */
  via?: ItemFrontmatter | undefined;
}

export interface CardExportOptions {
  mode?: CardExportMode | undefined;
  format?: CardExportFormat | undefined;
  style?: string | undefined;
  locale?: string | undefined;
  /** The project's ExportPolicy. Defaults to the note, else the AI paraphrase, without label. */
  policy?: { paraphrase?: ParaphraseSource; labelAi?: boolean } | undefined;
}

export interface CardExportResult {
  text: string;
  html?: string;
}

// Escaping -------------------------------------------------------------------------------------------

const escapers: Record<CardExportFormat, (s: string) => string> = {
  text: (s) => s,
  html: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  pandoc: (s) => s.replace(/[\\*_[\]@<>$^~|`]/g, (c) => `\\${c}`),
  latex: (s) =>
    s
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/[{}&%$#_]/g, (c) => `\\${c}`)
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}"),
  typst: (s) => s.replace(/[\\#$@*_`<>~[\]/]/g, (c) => `\\${c}`),
};

// Inner quotation marks: „…“, “…”, »…«, «…» and straight pairs become nested quotes.
const INNER_QUOTE = /„([^“”]*)[“”]|“([^“”]*)”|»([^«»]*)«|«([^«»]*)»|"([^"]*)"/g;

function renderQuote(
  quote: string,
  terms: LocaleTerms,
  format: CardExportFormat,
  esc: (s: string) => string,
): string {
  const flat = quote.trim().replace(/\s*\n\s*/g, " ");
  let out = "";
  let last = 0;
  for (const m of flat.matchAll(INNER_QUOTE)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
    out += esc(flat.slice(last, m.index));
    out +=
      format === "latex"
        ? `\\enquote{${esc(inner)}}`
        : `${esc(terms.openInnerQuote)}${esc(inner)}${esc(terms.closeInnerQuote)}`;
    last = (m.index ?? 0) + m[0].length;
  }
  out += esc(flat.slice(last));
  return format === "latex"
    ? `\\enquote{${out}}`
    : `${esc(terms.openQuote)}${out}${esc(terms.closeQuote)}`;
}

// Locators and prefixes -------------------------------------------------------------------------------

function isGerman(locale: string | undefined): boolean {
  return resolveLocale(locale).startsWith("de");
}

interface Loc {
  /** "31" or "31-33" */
  text: string;
  label: string;
  plural: boolean;
}

function locatorOf(entry: CardExportEntry): Loc | undefined {
  const l = entry.card.locator;
  if (!l) return undefined;
  const text = l.end ? `${l.start}-${l.end}` : l.start;
  return { text, label: l.label || "page", plural: !!l.end || /[,&]/.test(l.start) };
}

/** "S. 31", "Kap. 3", "p. 31", "pp. 31-33", using the short term of the locale. */
function locatorWithTerm(loc: Loc, terms: LocaleTerms): string {
  const term = terms.short.get(loc.label) ?? terms.long.get(loc.label);
  if (!term) return loc.text;
  return `${loc.plural ? term.multiple : term.single} ${loc.text}`;
}

function dashed(text: string, dash: string): string {
  return text.replace(/(?<=\w)\s*[-–]+\s*(?=\w)/g, dash);
}

function prefixOf(mode: CardExportMode, locale: string | undefined): string | undefined {
  return mode === "indirect" && isGerman(locale) ? "vgl." : undefined;
}

function viaPrefix(locale: string | undefined, format: CardExportFormat): string {
  if (!isGerman(locale)) return "quoted in";
  return format === "latex" ? "zit. nach" : "zit. n.";
}

// Citation markup per format --------------------------------------------------------------------------

function pandocCitation(entry: CardExportEntry, prefix: string | undefined, o: Resolved): string {
  const loc = locatorOf(entry);
  const main = `${prefix ? `${prefix} ` : ""}@${entry.item.citekey}${
    loc ? `, ${locatorWithTerm({ ...loc, text: dashed(loc.text, "-") }, o.terms)}` : ""
  }`;
  const via = entry.via ? `; ${viaPrefix(o.locale, "pandoc")} @${entry.via.citekey}` : "";
  return `[${main}${via}]`;
}

const NUMERIC_LOCATOR = /^[0-9ivxlcdmIVXLCDM]+([-–][0-9ivxlcdmIVXLCDM]+)?$/;

function latexCitation(entry: CardExportEntry, prefix: string | undefined, o: Resolved): string {
  const loc = locatorOf(entry);
  let post = "";
  if (loc) {
    post =
      loc.label === "page" && NUMERIC_LOCATOR.test(loc.text)
        ? dashed(loc.text, "--")
        : dashed(locatorWithTerm(loc, o.terms), "--");
  }
  const args = (pre: string | undefined, p: string): string => {
    if (pre) return `[${pre}][${p}]`;
    return p ? `[${p}]` : "";
  };
  const first = args(prefix, post);
  if (!entry.via) return `\\parencite${first}{${entry.item.citekey}}`;
  const viaPre = viaPrefix(o.locale, "latex");
  return `\\parencites${first}{${entry.item.citekey}}[${viaPre}][]{${entry.via.citekey}}`;
}

function typstCitation(entry: CardExportEntry, prefix: string | undefined, o: Resolved): string {
  const loc = locatorOf(entry);
  const supplement = loc
    ? `[${escapers.typst(locatorWithTerm({ ...loc, text: dashed(loc.text, "–") }, o.terms))}]`
    : "";
  const main = `${prefix ? `${prefix} ` : ""}@${entry.item.citekey}${supplement}`;
  return entry.via ? `${main} (${viaPrefix(o.locale, "typst")} @${entry.via.citekey})` : main;
}

function csl(
  entry: CardExportEntry,
  prefix: string | undefined,
  o: Resolved,
  format: "text" | "html",
): string {
  const loc = locatorOf(entry);
  const opts = { style: o.style, locale: o.locale, format };
  const main = renderCitation(
    [entry.item],
    [{ citekey: entry.item.citekey, locator: loc?.text, label: loc?.label, prefix }],
    opts,
  );
  if (!entry.via) return main;
  // citeproc sorts the items of one cluster, which would put the secondary source first. The two
  // citations are rendered separately and merged: "(Müsse, 1995, S. 24; zit. n. Pürer & Raabe, 2007)".
  const via = renderCitation([entry.via], [{ citekey: entry.via.citekey }], opts);
  const label = viaPrefix(o.locale, "text");
  if (main.endsWith(")") && via.startsWith("(") && via.endsWith(")")) {
    return `${main.slice(0, -1)}; ${label} ${via.slice(1)}`;
  }
  return `${main} (${label} ${via})`;
}

// Entry point -----------------------------------------------------------------------------------------

interface Resolved {
  style: string;
  locale: string;
  terms: LocaleTerms;
}

function paraphraseText(
  body: CardExportEntry["body"],
  policy: ResolvedPolicy,
): { text: string; ai: boolean } | undefined {
  const own = body.note?.trim() || undefined;
  const ai = body.paraphrase?.trim() || undefined;
  switch (policy.paraphrase) {
    case "none":
      return undefined;
    case "own":
      return own ? { text: own, ai: false } : undefined;
    case "ai":
      return ai ? { text: ai, ai: true } : undefined;
    case "own-else-ai":
      if (own) return { text: own, ai: false };
      return ai ? { text: ai, ai: true } : undefined;
  }
}

/**
 * Renders one card as a direct quote ("„Wortlaut“ (Luhmann 1984, S. 31)") or as an indirect
 * citation (paraphrase plus citation, with "vgl." when the locale is German). The project's
 * ExportPolicy decides which paraphrase is used and whether an AI paraphrase is labeled.
 * When the policy yields no paraphrase, an indirect export contains the citation only.
 */
export function exportCard(entry: CardExportEntry, opts: CardExportOptions = {}): CardExportResult {
  const mode = opts.mode ?? "direct";
  const format = opts.format ?? "html";
  const locale = resolveLocale(opts.locale ?? DEFAULT_LOCALE);
  const resolved: Resolved = {
    style: opts.style ?? DEFAULT_STYLE,
    locale,
    terms: localeTerms(locale),
  };
  const policy = ExportPolicy.parse(opts.policy ?? {});
  const prefix = prefixOf(mode, locale);

  const build = (fmt: CardExportFormat): string => {
    const esc = escapers[fmt];
    const pieces: string[] = [];
    if (mode === "direct") {
      pieces.push(renderQuote(entry.body.quote, resolved.terms, fmt, esc));
    } else {
      const para = paraphraseText(entry.body, policy);
      if (para) {
        pieces.push(esc(para.text.replace(/\s*\n\s*/g, " ")));
        if (para.ai && policy.labelAi) {
          pieces.push(
            esc(isGerman(locale) ? "[KI-generierte Paraphrase]" : "[AI-generated paraphrase]"),
          );
        }
      }
    }
    switch (fmt) {
      case "pandoc":
        pieces.push(pandocCitation(entry, prefix, resolved));
        break;
      case "latex":
        pieces.push(latexCitation(entry, prefix, resolved));
        break;
      case "typst":
        pieces.push(typstCitation(entry, prefix, resolved));
        break;
      case "html":
        pieces.push(csl(entry, prefix, resolved, "html"));
        break;
      case "text":
        pieces.push(csl(entry, prefix, resolved, "text"));
        break;
    }
    return pieces.join(" ");
  };

  if (format === "html") return { text: build("text"), html: `<p>${build("html")}</p>` };
  return { text: build(format) };
}

/** Renders several cards, separated by a blank line (html: one paragraph per card). */
export function exportCards(
  entries: readonly CardExportEntry[],
  opts: CardExportOptions = {},
): CardExportResult {
  const results = entries.map((e) => exportCard(e, opts));
  const text = results.map((r) => r.text).join("\n\n");
  const html = results.map((r) => r.html).filter((h): h is string => h !== undefined);
  return html.length > 0 ? { text, html: html.join("\n") } : { text };
}

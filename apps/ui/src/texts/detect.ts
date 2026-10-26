/**
 * Finds plain formatted citations in a text, such as the ones the quick insert pasted before it
 * wrote Pandoc syntax: `„…“ (Williams & Srnicek, 2013, S. 1)` or `(vgl. Luhmann, 1984, S. 31)`.
 * A citation counts only when its authors and year name exactly one item of the library. The
 * conversion turns it into `[@key, S. 1]` so that it follows the citation style of the text.
 */

export interface DetectSource {
  citekey: string;
  /** Family names as the library lists them, such as "Williams, Srnicek" or "Luhmann". */
  authors?: string | undefined;
  year?: string | undefined;
}

export interface PlainCitation {
  /** The `(…)` in the text, brackets included. */
  from: number;
  to: number;
  /** The text as it stands now. */
  text: string;
  /** The Pandoc cluster that replaces it. */
  replacement: string;
  keys: string[];
}

const PREFIX = /^(vgl\.?|cf\.?|see|siehe)\s+/i;
const YEAR = /^(.*?),?\s+((?:1[5-9]|20)\d\d)([a-z]?)(?:,\s*(.+))?$/s;
const LOCATOR =
  /^(?:(S|p|pp|Abs|para|paras|Kap|chap|Bd|vol|Nr|no)\.?\s*)?(\d+(?:\s*[-–]\s*\d+)?|[ivxlcdm]+)$/i;
const ET_AL = /\s+(?:et al\.?|u\.\s?a\.|und andere|and others)$/i;

const fold = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function splitNames(authors: string): string[] {
  return authors
    .split(/\s*(?:&|;|,|\band\b|\bund\b)\s*/i)
    .map(fold)
    .filter(Boolean);
}

/** Authors of an in-text citation: `["williams", "srnicek"]` plus whether it ended in "et al.". */
function textAuthors(raw: string): { names: string[]; more: boolean } {
  const more = ET_AL.test(raw);
  return { names: splitNames(raw.replace(ET_AL, "")), more };
}

const TERMS = {
  de: {
    page: ["S.", "S."],
    paragraph: ["Abs.", "Abs."],
    chapter: ["Kap.", "Kap."],
    volume: ["Bd.", "Bd."],
  },
  en: {
    page: ["p.", "pp."],
    paragraph: ["para.", "paras."],
    chapter: ["chap.", "chaps."],
    volume: ["vol.", "vols."],
  },
} as const;

const LABELS: Record<string, keyof (typeof TERMS)["de"]> = {
  s: "page",
  p: "page",
  pp: "page",
  abs: "paragraph",
  para: "paragraph",
  paras: "paragraph",
  kap: "chapter",
  chap: "chapter",
  bd: "volume",
  vol: "volume",
};

/** Locator of the Pandoc cluster in the terms of the text's language. */
function pandocLocator(label: string | undefined, number: string, lang: string): string {
  const num = number.replace(/\s+/g, "").replace(/–/g, "-");
  const key = LABELS[(label ?? "").toLowerCase()] ?? (label ? undefined : "page");
  if (!key) return "";
  const terms = TERMS[lang.toLowerCase().startsWith("en") ? "en" : "de"][key];
  return `${terms[/[-,]/.test(num) ? 1 : 0]} ${num}`;
}

function parsePart(
  part: string,
  find: (names: string[], more: boolean, year: string, suffix: string) => string | undefined,
  lang: string,
): { key: string; cluster: string } | undefined {
  let rest = part.trim();
  const prefix = PREFIX.exec(rest)?.[1];
  if (prefix) rest = rest.replace(PREFIX, "");
  const m = YEAR.exec(rest);
  if (!m) return undefined;
  const [, authors = "", year = "", suffix = "", locator] = m;
  if (!authors.trim() || /[0-9()[\]]/.test(authors)) return undefined;
  const { names, more } = textAuthors(authors);
  if (names.length === 0 || names.length > 3) return undefined;
  const key = find(names, more, year, suffix);
  if (!key) return undefined;
  let where = "";
  if (locator) {
    const loc = LOCATOR.exec(locator.trim());
    if (!loc) return undefined;
    where = pandocLocator(loc[1], loc[2] ?? "", lang);
    if (!where) return undefined;
  }
  const lead = prefix ? `${prefix.replace(/\.?$/, ".")} ` : "";
  return { key, cluster: `${lead}@${key}${where ? `, ${where}` : ""}` };
}

/** Plain citations in `body` that name one library item each. Code, links and Pandoc syntax are skipped. */
export function detectPlainCitations(
  body: string,
  sources: Iterable<DetectSource>,
  lang = "de-DE",
): PlainCitation[] {
  const library = [...sources].map((s) => ({
    citekey: s.citekey,
    names: splitNames(s.authors ?? ""),
    year: s.year ?? "",
  }));
  const find = (names: string[], more: boolean, year: string, suffix: string) => {
    if (suffix) return undefined; // 2013a and 2013b need the item to carry the suffix
    const hits = library.filter((s) => {
      if (s.year !== year) return false;
      if (more) return s.names.length > 2 && s.names[0] === names[0];
      return s.names.length === names.length && names.every((n, i) => s.names[i] === n);
    });
    return hits.length === 1 ? hits[0]?.citekey : undefined;
  };

  const out: PlainCitation[] = [];
  let offset = 0;
  let fence = false;
  for (const line of body.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (/^ {0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || /^---\s*$/.test(line)) continue;
    for (const m of line.matchAll(/\(([^()]{4,240})\)/g)) {
      const at = m.index ?? 0;
      if (line[at - 1] === "]") continue; // the target of a Markdown link
      if ((line.slice(0, at).match(/`/g)?.length ?? 0) % 2 === 1) continue; // inside inline code
      const parts = (m[1] ?? "").split(";").map((p) => parsePart(p, find, lang));
      if (parts.length === 0 || parts.some((p) => !p)) continue;
      const ok = parts as Array<{ key: string; cluster: string }>;
      out.push({
        from: start + at,
        to: start + at + m[0].length,
        text: m[0],
        replacement: `[${ok.map((p) => p.cluster).join("; ")}]`,
        keys: ok.map((p) => p.key),
      });
    }
  }
  return out;
}

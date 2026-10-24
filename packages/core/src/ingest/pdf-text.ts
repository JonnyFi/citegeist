import { readFile } from "node:fs/promises";
import { extractFromXmp, extractIdentifiers, type Identifier } from "@citegeist/metadata";

export interface PdfText {
  /** Text of the first page, one line per visual line. */
  firstPage: string;
  /** Text of the first pages (up to `maxPages`) for identifier extraction. */
  leading: string;
  pages: number;
  /** The XMP packet of the file, for identifiers. */
  xmp?: string;
  /** The string values of the document info dictionary (title, subject, keywords), for identifiers. */
  info?: string;
}

export type PdfTextExtractor = (path: string) => Promise<PdfText>;

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

/** Reads the text of the first pages with pdfjs-dist. Returns empty text for unreadable files. */
export const extractPdfText: PdfTextExtractor = async (path) => {
  const maxPages = 2;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(path));
    const task = pdfjs.getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const doc = await task.promise;
    const texts: string[] = [];
    let xmp = "";
    let info = "";
    try {
      const md = (await doc.getMetadata()) as {
        info?: Record<string, unknown>;
        metadata?: { getRaw?: () => unknown } | null;
      };
      const raw = md.metadata?.getRaw?.();
      xmp = typeof raw === "string" ? raw : "";
      info = Object.values(md.info ?? {})
        .filter((v): v is string => typeof v === "string")
        .join("\n");
    } catch {
      // A damaged metadata stream costs the identifiers in it, not the page text.
    }
    try {
      for (let n = 1; n <= Math.min(maxPages, doc.numPages); n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items as TextItem[]) {
          if (typeof item.str !== "string") continue;
          text += item.str;
          text += item.hasEOL ? "\n" : " ";
        }
        texts.push(text.replace(/[ \t]+\n/g, "\n").trim());
      }
    } finally {
      await task.destroy();
    }
    return {
      firstPage: texts[0] ?? "",
      leading: texts.join("\n\n"),
      pages: doc.numPages,
      xmp,
      info,
    };
  } catch {
    return { firstPage: "", leading: "", pages: 0 };
  }
};

/**
 * DOI, arXiv id, ISBN and PMID of a PDF, best first: the XMP packet and the info dictionary, then
 * the first pages. Metadata the publisher wrote is more reliable than a number found in running text.
 */
export function pdfIdentifiers(text: PdfText): Identifier[] {
  const found: Identifier[] = [
    ...extractFromXmp(text.xmp ?? ""),
    ...extractIdentifiers(text.info ?? "", { stopAtReferences: false }),
  ];
  const fromMeta = new Set(found.map((i) => `${i.kind}:${i.value}`));
  for (const id of extractIdentifiers(text.leading)) {
    if (!fromMeta.has(`${id.kind}:${id.value}`)) found.push(id);
  }
  const rank = (i: Identifier): number => KIND_ORDER.indexOf(i.kind);
  // Stable: within one kind, the XMP identifiers stay in front of the page text ones.
  return found
    .map((id, n) => ({ id, n }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.n - b.n)
    .map((x) => x.id);
}

const KIND_ORDER = ["doi", "arxiv", "isbn", "pmid", "url"];

export interface HeaderGuess {
  title: string;
  firstAuthor?: string;
  year?: number;
  /** CSL type when the page says what it is, else undefined (title matching then asks for review). */
  type?: "article-journal" | "book" | "thesis";
}

const NOISE =
  /^(?:\d+|page \d+|©.*|copyright.*|https?:\/\/\S+|doi:.*|arxiv:.*|abstract|keywords?:.*)$/i;

/**
 * Guesses title, first author and year from the first page text: the first plausible line is the
 * title, the next line that looks like a person name is the author. The result is only a query
 * for title matching; the match rules in packages/metadata decide whether it is accepted.
 */
export function guessHeader(text: string): HeaderGuess | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0 && !NOISE.test(l));
  const titleIndex = lines.findIndex((l) => l.length >= 8 && l.split(" ").length >= 2);
  const title = lines[titleIndex];
  if (title === undefined) return undefined;
  const rest = lines.slice(titleIndex + 1, titleIndex + 8);
  const firstAuthor = rest.find((l) => looksLikeName(l));
  const year = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(text.slice(0, 3000))?.[1];
  const head = text.slice(0, 3000);
  const type = /\b(?:thesis|dissertation)\b|\bdissertation\b/i.test(head)
    ? "thesis"
    : /\b(?:journal|zeitschrift|proceedings|vol\.|volume|issn)\b/i.test(head)
      ? "article-journal"
      : /\b(?:isbn|verlag|publisher|press)\b/i.test(head)
        ? "book"
        : undefined;
  return {
    title,
    ...(firstAuthor ? { firstAuthor } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(type ? { type } : {}),
  };
}

/** Small words that make a capitalised line a subtitle ("Ethics After Certainty"), not a name. */
const TITLE_WORDS = new Set([
  "and",
  "after",
  "before",
  "between",
  "beyond",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "toward",
  "towards",
  "with",
  "without",
  "und",
  "oder",
  "ueber",
  "über",
  "zur",
  "zum",
  "vom",
  "im",
  "die",
  "das",
]);

function looksLikeName(line: string): boolean {
  if (/\d/.test(line) || line.length > 60) return false;
  const words = line.split(" ");
  if (words.length > 5) return false;
  if (words.some((w) => TITLE_WORDS.has(w.toLowerCase()))) return false;
  return words.every(
    (w) => /^\p{Lu}[\p{L}'.-]*$/u.test(w) || /^(?:van|von|de|der|den|di|da|zu)$/.test(w),
  );
}

import { extractWikiLinks } from "../wikilinks.js";

/** `^i-XXXXXXXXXX` at the end of a paragraph. */
const BLOCK = /\s\^(i-[0-9A-HJKMNP-TV-Z]{10})\s*$/;
const DATE = /^(\d{4}-\d{2}-\d{2}):\s*/;

export interface Paragraph {
  /** Text without the block id. */
  text: string;
  block?: string;
  /** Date at the start, YYYY-MM-DD. */
  date?: string;
  /** Wiki link targets, without anchors and aliases. */
  links: string[];
}

/** Splits a Markdown body into paragraphs. Headings, rules and fenced code are not paragraphs. */
export function splitParagraphs(body: string): Paragraph[] {
  const out: Paragraph[] = [];
  const stripped = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
  for (const raw of stripped.split(/\n\s*\n/)) {
    const lines = raw
      .split("\n")
      .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*(---+|\*\*\*+)\s*$/.test(l));
    const joined = lines.join("\n").trim();
    if (!joined) continue;
    const block = BLOCK.exec(joined)?.[1];
    const text = joined.replace(BLOCK, "").trim();
    const date = DATE.exec(text)?.[1];
    out.push({
      text,
      ...(block ? { block } : {}),
      ...(date ? { date } : {}),
      links: [...new Set(extractWikiLinks(text).map((l) => l.target))],
    });
  }
  return out;
}

/** The paragraph a new insight becomes: date first, block id last. */
export function insightParagraph(date: string, text: string, block: string): string {
  const one = text
    .replace(/\s*\n\s*/g, " ")
    .replace(/^\d{4}-\d{2}-\d{2}:\s*/, "")
    .trim();
  return `${date}: ${one} ^${block}`;
}

/** Appends a paragraph to Markdown text, separated by one blank line. */
export function appendParagraph(existing: string, paragraph: string): string {
  const base = existing.replace(/\s+$/, "");
  return base === "" ? `${paragraph}\n` : `${base}\n\n${paragraph}\n`;
}

import { z } from "zod";
import { ProjectSlug, Stamp } from "./common.js";

// Texts (D20, docs/spec/library-format.md): Markdown files under projects/<project>/texts/ whose
// citations use the Pandoc syntax, so that `pandoc --citeproc` can format them.

/** File name (without `.md`) of a text under projects/<project>/texts/. */
export const TextSlug = ProjectSlug;
export type TextSlug = z.infer<typeof TextSlug>;

/** Frontmatter of projects/<project>/texts/<text>.md; the body is the text itself. */
export const TextFrontmatter = z.object({
  title: z.string().min(1),
  /** CSL style id. Without it the style of the project applies. */
  style: z.string().optional(),
  /** BCP 47 language of the text, for example `de-DE`. Without it the locale of the project applies. */
  lang: z.string().optional(),
  created: Stamp.optional(),
});
export type TextFrontmatter = z.infer<typeof TextFrontmatter>;

/** One citation key found in a text. */
export interface CitationRef {
  key: string;
  /** Offset of the first character of the key (after the `@`, after `{` for `@{key}`). */
  from: number;
  /** Offset after the last character of the key. */
  to: number;
}

// Pandoc citation keys start with a letter, digit or underscore and may contain internal
// punctuation. Trailing punctuation belongs to the sentence.
const KEY_START = "\\p{L}\\p{N}_";
const KEY_INNER = `${KEY_START}:.#$%&\\-+?<>~/`;
const CITATION = new RegExp(
  `(?<![${KEY_START}\\\\@])-?@(?:\\{([^}\\n]+)\\}|([${KEY_START}][${KEY_INNER}]*))`,
  "gu",
);
const TRAILING_PUNCTUATION = /[:.#$%&\-+?<>~/]+$/;

function blank(text: string, from: number, to: number): string {
  return text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, " ") + text.slice(to);
}

/** Replaces `re` matches by spaces of the same length (line breaks stay), so offsets keep. */
function blankMatches(text: string, re: RegExp): string {
  let out = text;
  for (const m of text.matchAll(re)) out = blank(out, m.index ?? 0, (m.index ?? 0) + m[0].length);
  return out;
}

/**
 * The text with everything blanked out in which an `@` is not a citation: the YAML frontmatter,
 * fenced and inline code, HTML comments, wiki links, link targets, autolinks and bare URLs.
 */
function citable(text: string): string {
  let out = text;
  const front = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(out);
  if (front) out = blank(out, 0, front[0].length);

  // fenced code blocks, line by line
  let fence: { char: string; size: number } | undefined;
  let offset = 0;
  for (const line of out.split("\n")) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const inFence = fence !== undefined;
    if (!fence && open?.[1]) {
      fence = { char: open[1].charAt(0), size: open[1].length };
    } else if (fence) {
      const close = new RegExp(`^ {0,3}\\${fence.char}{${fence.size},}[ \\t]*$`).test(line);
      if (close) fence = undefined;
    }
    if (inFence || fence || open) out = blank(out, offset, offset + line.length);
    offset += line.length + 1;
  }

  out = blankMatches(out, /<!--[\s\S]*?-->/g);
  out = blankMatches(out, /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g);
  out = blankMatches(out, /!?\[\[[^\]\n]*\]\]/g);
  out = blankMatches(out, /\]\([^)\n]*\)/g);
  out = blankMatches(out, /<[A-Za-z][A-Za-z0-9+.-]*:[^>\s]*>/g);
  out = blankMatches(out, /\b(?:https?|ftp):\/\/[^\s<>)\]]+/g);
  return out;
}

/**
 * Every citation key in the Markdown of a text, in order of appearance: `[@key]`, `[@a; @b]`,
 * `[-@key]`, `@key` and `@{key}`. An e-mail address, an escaped `\@` and anything in code, links
 * or the frontmatter do not count.
 */
export function scanCitations(text: string): CitationRef[] {
  const found: CitationRef[] = [];
  for (const m of citable(text).matchAll(CITATION)) {
    const braced = m[1];
    const plain = m[2];
    const start = (m.index ?? 0) + m[0].indexOf("@") + 1;
    if (braced !== undefined) {
      const key = braced.trim();
      if (key) found.push({ key, from: start + 1, to: start + 1 + braced.length });
    } else if (plain) {
      const key = plain.replace(TRAILING_PUNCTUATION, "");
      if (key) found.push({ key, from: start, to: start + key.length });
    }
  }
  return found;
}

/** The distinct citation keys of a text, in order of first appearance. */
export function citedKeys(text: string): string[] {
  return [...new Set(scanCitations(text).map((c) => c.key))];
}

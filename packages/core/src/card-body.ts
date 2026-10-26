import { CARD_SECTIONS, type CardBody, LEGACY_NOTE_SECTIONS } from "@citegeist/schema";
import { normalizeNewlines } from "./hash.js";

type KnownKey = keyof typeof CARD_SECTIONS;
const KNOWN_ORDER: KnownKey[] = ["paraphrase", "core", "note"];

export class CardBodyError extends Error {}

const HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;

function trimBlankLines(lines: string[]): string {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]?.trim() === "") a++;
  while (b > a && lines[b - 1]?.trim() === "") b--;
  return lines.slice(a, b).join("\n");
}

/**
 * Parses the text of a card file below the frontmatter: a blockquote with the verbatim quote,
 * then level-2 sections. Known sections map to fields, unknown ones land in `extra` in order.
 * Text between the quote and the first heading becomes an extra section with an empty heading.
 *
 * The retired sections "In my words" and "Comment" are read into `note`. With both present
 * the note is the own words, a blank line, the comment (a "Note" section of the same file comes
 * last). The file is only changed when the card is written again.
 */
export function parseCardBody(text: string): CardBody {
  const lines = normalizeNewlines(text).split("\n");
  let i = 0;
  while (i < lines.length && lines[i]?.trim() === "") i++;
  const quoteLines: string[] = [];
  while (i < lines.length && /^>/.test(lines[i] ?? "")) {
    quoteLines.push((lines[i] ?? "").replace(/^> ?/, ""));
    i++;
  }
  if (quoteLines.length === 0) {
    throw new CardBodyError("card body must start with a blockquote (lines beginning with '> ')");
  }
  const quote = quoteLines.join("\n");

  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) inFence = !inFence;
    const h = inFence ? null : HEADING.exec(line);
    if (h) sections.push({ heading: (h[1] ?? "").trim(), lines: [] });
    else sections[sections.length - 1]?.lines.push(line);
  }

  const body: CardBody = { quote, extra: [] };
  const seen = new Set<string>();
  const legacyNote: string[] = [];
  const legacySeen = new Set<string>();
  for (const [idx, s] of sections.entries()) {
    const content = trimBlankLines(s.lines);
    if (idx === 0) {
      if (content !== "") body.extra.push({ heading: "", text: content });
      continue;
    }
    const legacy = LEGACY_NOTE_SECTIONS.find((h) => h.toLowerCase() === s.heading.toLowerCase());
    if (legacy && !legacySeen.has(legacy)) {
      legacySeen.add(legacy);
      if (content !== "") legacyNote.push(content);
      continue;
    }
    const key = KNOWN_ORDER.find((k) => CARD_SECTIONS[k].toLowerCase() === s.heading.toLowerCase());
    if (key && !seen.has(key)) {
      seen.add(key);
      body[key] = content;
    } else {
      body.extra.push({ heading: s.heading, text: content });
    }
  }
  if (legacyNote.length > 0) {
    body.note = [...legacyNote, ...(body.note ? [body.note] : [])].join("\n\n");
  }
  return body;
}

/** Inverse of {@link parseCardBody}. Output has no trailing line break. */
export function serializeCardBody(body: CardBody): string {
  const parts: string[] = [
    body.quote
      .split("\n")
      .map((l) => (l === "" ? ">" : `> ${l}`))
      .join("\n"),
  ];
  for (const e of body.extra) if (e.heading === "") parts.push(e.text);
  for (const k of KNOWN_ORDER) {
    const v = body[k];
    if (v !== undefined) parts.push(section(CARD_SECTIONS[k], v));
  }
  for (const e of body.extra) if (e.heading !== "") parts.push(section(e.heading, e.text));
  return parts.join("\n\n");
}

function section(heading: string, text: string): string {
  return text === "" ? `## ${heading}` : `## ${heading}\n\n${text}`;
}

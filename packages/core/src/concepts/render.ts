import type { ConceptUsage } from "@citegeist/schema";

export const ENTRIES_START =
  "<!-- concept:entries (written by citegeist from the frontmatter; edits here are overwritten) -->";
export const ENTRIES_END = "<!-- /concept:entries -->";

/** Page label for the quote lines: "S. 58" in German libraries, "p. 58" otherwise. */
function pageLabel(language: string, page: string): string {
  return `${language.toLowerCase().startsWith("de") ? "S." : "p."} ${page}`;
}

function renderUsage(u: ConceptUsage, language: string): string {
  const lines = [`## [[${u.item}]]`, "", u.text.trim()];
  for (const e of u.evidence) {
    const quote = e.quote
      .trim()
      .split(/\r?\n/)
      .map((l) => `> ${l}`.trimEnd())
      .join("\n");
    const cite = `> [[${e.card}]]${e.page ? `, ${pageLabel(language, e.page)}` : ""}`;
    lines.push("", quote, cite);
  }
  return lines.join("\n");
}

/** The part of the body that citegeist writes: one section per source, definitions first. */
export function renderEntries(usages: readonly ConceptUsage[], language: string): string {
  if (usages.length === 0) return "";
  const ordered = [...usages].sort(
    (a, b) =>
      Number(b.role === "defines") - Number(a.role === "defines") || a.item.localeCompare(b.item),
  );
  return `${ENTRIES_START}\n\n${ordered.map((u) => renderUsage(u, language)).join("\n\n")}\n\n${ENTRIES_END}`;
}

/** Splits a concept body into the reader's own text and the generated entries. */
export function splitBody(body: string): { note: string; entries: string } {
  const start = body.indexOf("<!-- concept:entries");
  if (start < 0) return { note: body.trim(), entries: "" };
  const end = body.indexOf(ENTRIES_END, start);
  const stop = end < 0 ? body.length : end + ENTRIES_END.length;
  const rest = `${body.slice(0, start)}${body.slice(stop)}`;
  return { note: rest.trim(), entries: body.slice(start, stop) };
}

/** The body of a concept file: the reader's text, then the generated entries. */
export function composeBody(
  note: string,
  usages: readonly ConceptUsage[],
  language: string,
): string {
  return [note.trim(), renderEntries(usages, language)].filter(Boolean).join("\n\n");
}

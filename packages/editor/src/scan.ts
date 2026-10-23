/** A `[[wiki link]]` or `![[embed]]` found in text. Offsets are relative to the scanned string. */
export interface WikiMatch {
  from: number;
  to: number;
  embed: boolean;
  target: string;
  anchor?: string;
  alias?: string;
  /** Offset of the first character after `[[`. */
  innerFrom: number;
  /** Offset where `]]` starts. */
  innerTo: number;
  /** Offset after the visible label: the alias start when there is an alias, else `innerFrom`. */
  labelFrom: number;
}

const WIKI = /(!?)\[\[([^[\]\n]+)\]\]/g;

/** Splits `target#anchor|alias` the way Obsidian reads it. */
export function parseInner(inner: string): { target: string; anchor?: string; alias?: string } {
  const bar = inner.indexOf("|");
  const head = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar + 1) : undefined;
  const hash = head.indexOf("#");
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim();
  const anchor = hash >= 0 ? head.slice(hash + 1) : undefined;
  return {
    target,
    ...(anchor ? { anchor } : {}),
    ...(alias !== undefined && alias !== "" ? { alias } : {}),
  };
}

/** Finds wiki links in text, skipping those that overlap `skip` ranges (code). */
export function scanWikiLinks(
  text: string,
  skip: ReadonlyArray<{ from: number; to: number }> = [],
  offset = 0,
): WikiMatch[] {
  const out: WikiMatch[] = [];
  for (const m of text.matchAll(WIKI)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (skip.some((s) => from + offset < s.to && to + offset > s.from)) continue;
    const inner = m[2] ?? "";
    const parsed = parseInner(inner);
    if (parsed.target === "") continue;
    const innerFrom = from + (m[1] ? 3 : 2);
    const bar = inner.indexOf("|");
    out.push({
      from,
      to,
      embed: m[1] === "!",
      ...parsed,
      innerFrom,
      innerTo: to - 2,
      labelFrom: bar >= 0 ? innerFrom + bar + 1 : innerFrom,
    });
  }
  return out;
}

/** End offset of a leading YAML frontmatter block, including the closing fence line, or null. */
export function frontmatterEnd(text: string): number | null {
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?=\r?\n|$)/.exec(text);
  return m ? m[0].length : null;
}

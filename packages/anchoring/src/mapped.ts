/**
 * Text with an origin map. `src[i]` is the offset in the source text that character `i` came from,
 * or -1 for characters that were inserted (separators). Every transformation keeps the map, which
 * is what lets a found range be turned back into blocks, pages and DOM positions.
 */
export interface Mapped {
  text: string;
  src: number[];
}

export function fromString(text: string, base = 0): Mapped {
  const src = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) src[i] = base + i;
  return { text, src };
}

export function concat(parts: Mapped[], sep = ""): Mapped {
  let text = "";
  const src: number[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0) {
      text += sep;
      for (let i = 0; i < sep.length; i++) src.push(-1);
    }
    text += p.text;
    for (const s of p.src) src.push(s);
  });
  return { text, src };
}

/**
 * Regex replace that keeps the origin map. Replacement characters inherit the origin of the match
 * start. A replacement equal to the match keeps the per-character origins.
 */
export function replaceRegex(
  m: Mapped,
  re: RegExp,
  repl: (match: RegExpMatchArray) => string,
): Mapped {
  let text = "";
  const src: number[] = [];
  let last = 0;
  for (const match of m.text.matchAll(re)) {
    const at = match.index ?? 0;
    for (let i = last; i < at; i++) {
      text += m.text[i];
      src.push(m.src[i] ?? -1);
    }
    const r = repl(match);
    for (let i = 0; i < r.length; i++) {
      text += r[i];
      src.push(r === match[0] ? (m.src[at + i] ?? -1) : (m.src[at] ?? -1));
    }
    last = at + match[0].length;
  }
  for (let i = last; i < m.text.length; i++) {
    text += m.text[i];
    src.push(m.src[i] ?? -1);
  }
  return { text, src };
}

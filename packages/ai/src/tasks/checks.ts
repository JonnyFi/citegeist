/** Deterministic checks shared by task evals. They catch gross failures; the card.verify task judges the rest. */

const STOPWORDS: Record<string, string[]> = {
  de: [
    "der",
    "die",
    "das",
    "und",
    "ist",
    "nicht",
    "mit",
    "von",
    "den",
    "ein",
    "eine",
    "dass",
    "sich",
    "auf",
    "für",
    "zu",
    "werden",
    "wird",
    "auch",
    "bei",
  ],
  en: [
    "the",
    "and",
    "is",
    "of",
    "to",
    "in",
    "that",
    "with",
    "for",
    "are",
    "this",
    "which",
    "not",
    "by",
    "as",
    "from",
    "an",
    "be",
    "was",
    "it",
  ],
};

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Share of words that are stopwords of the given language. Undefined when no list exists for it. */
export function languageScore(tag: string, text: string): number | undefined {
  const list = STOPWORDS[tag.split("-")[0] ?? tag];
  if (!list) return undefined;
  const w = words(text);
  if (w.length === 0) return 0;
  return w.filter((x) => list.includes(x)).length / w.length;
}

/** True when the text reads as the language `tag` and not clearly as another listed language. */
export function isWrittenIn(tag: string, text: string): boolean {
  const own = languageScore(tag, text);
  if (own === undefined) return true;
  for (const other of Object.keys(STOPWORDS)) {
    if (other === tag.split("-")[0]) continue;
    const s = languageScore(other, text) ?? 0;
    if (s > own) return false;
  }
  return own > 0.05;
}

/** Numbers (with decimals) that appear in `output` but not in `source`. Signals an invented figure. */
export function inventedNumbers(source: string, output: string): string[] {
  const norm = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
  const known = new Set(norm(source));
  return [...new Set(norm(output))].filter((n) => !known.has(n));
}

/** Longest run of consecutive words that output shares with source. Long runs mean copying. */
export function longestSharedRun(source: string, output: string): number {
  const s = words(source);
  const o = words(output);
  let best = 0;
  const index = new Map<string, number[]>();
  s.forEach((w, i) => {
    const l = index.get(w);
    if (l) l.push(i);
    else index.set(w, [i]);
  });
  for (let j = 0; j < o.length; j++) {
    for (const i of index.get(o[j] as string) ?? []) {
      let k = 0;
      while (i + k < s.length && j + k < o.length && s[i + k] === o[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

export function wordCount(text: string): number {
  return words(text).length;
}

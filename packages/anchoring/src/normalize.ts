import { fromString, type Mapped, replaceRegex } from "./mapped.js";

export const NORM_ID = "citegeist-norm-v1";

const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};

/**
 * citegeist-norm-v1: soft hyphens and zero-width characters removed, end-of-line hyphenation
 * joined, presentation-form ligatures U+FB00..FB06 folded to ASCII, NFC, whitespace collapsed and
 * trimmed. Both sides of every comparison go through this function. The result keeps the origin map.
 */
export function normalize(m: Mapped): Mapped {
  let r = replaceRegex(m, /\u00AD|\u200B|\u200C|\u200D|\uFEFF/g, () => "");
  r = replaceRegex(r, /(?<=\p{L})[-‐][ \t]*\r?\n[ \t]*(?=\p{Ll})/gu, () => "");
  r = replaceRegex(r, /[ﬀ-ﬆ]/g, (x) => LIGATURES[x[0] ?? ""] ?? x[0] ?? "");
  r = replaceRegex(r, /\P{M}\p{M}+/gu, (x) => x[0].normalize("NFC"));
  r = replaceRegex(r, /\s+/g, () => " ");
  let a = 0;
  let b = r.text.length;
  while (a < b && r.text[a] === " ") a++;
  while (b > a && r.text[b - 1] === " ") b--;
  return { text: r.text.slice(a, b), src: r.src.slice(a, b) };
}

/** Normalise a plain string, for example a quote typed or pasted by the user. */
export function normalizeText(text: string): string {
  return normalize(fromString(text)).text;
}

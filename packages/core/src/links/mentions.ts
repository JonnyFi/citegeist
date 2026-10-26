import type { Library } from "../library.js";

/** An item of the library that the text of a card seems to name. */
export interface Mention {
  citekey: string;
  title: string;
  authors?: string;
  year?: string;
  abstract?: string;
  /** What matched, in words: "citekey", "title", "author Land, given name Nick". */
  matched: string;
  score: number;
}

const WORD = "\\p{L}\\p{N}";
const TITLE_STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "between",
  "essay",
  "from",
  "introduction",
  "into",
  "notes",
  "study",
  "theory",
  "their",
  "toward",
  "towards",
  "über",
  "und",
  "with",
  "within",
  "zur",
  "zum",
]);

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole word (or phrase) match; letters and digits on either side rule it out. */
function wordRegex(word: string, flags: string, suffix = ""): RegExp {
  return new RegExp(`(?<![${WORD}])${escapeRegex(word)}${suffix}(?![${WORD}])`, flags);
}

interface CreatorRow {
  citekey: string;
  family: string | null;
  given: string | null;
  literal: string | null;
}

/** Longest part of a title before the subtitle, lower case. */
function mainTitle(title: string): string {
  return (title.split(/\s*[:–—]\s+/)[0] ?? title).trim().toLowerCase();
}

/**
 * Cheap string match from the text of a card to the items of the library, before any model runs.
 * A hit needs a strong signal on its own (the citekey, or the full main title) or an author's
 * family name, written with a capital letter as in the library, together with a second signal:
 * the given name, a distinctive word of the title or the year. A family name alone ("Land") is
 * too often a common word. The item the card comes from never matches.
 */
export function findMentions(lib: Library, cardCitekey: string, text: string): Mention[] {
  const lower = text.toLowerCase();
  const items = lib.index.all<{
    citekey: string;
    title: string;
    subtitle: string | null;
    year: string | null;
    authors: string | null;
    abstract: string | null;
  }>(
    "SELECT citekey, title, subtitle, year, authors, abstract FROM items WHERE citekey != ?",
    cardCitekey,
  );
  const creators = new Map<string, CreatorRow[]>();
  for (const c of lib.index.all<CreatorRow>(
    "SELECT citekey, family, given, literal FROM creators WHERE role = 'author' ORDER BY citekey, pos",
  )) {
    const list = creators.get(c.citekey);
    if (list) list.push(c);
    else creators.set(c.citekey, [c]);
  }

  const out: Mention[] = [];
  for (const item of items) {
    const reasons: string[] = [];
    let score = 0;

    if (wordRegex(item.citekey, "iu").test(text)) {
      reasons.push("citekey");
      score += 3;
    }
    const main = mainTitle(item.title);
    if ((main.split(/\s+/).length >= 3 || main.length >= 15) && lower.includes(main)) {
      reasons.push("title");
      score += 3;
    }

    const titleWords = [
      ...new Set(
        (item.title.match(new RegExp(`[${WORD}]{5,}`, "gu")) ?? [])
          .map((w) => w.toLowerCase())
          .filter((w) => !TITLE_STOPWORDS.has(w)),
      ),
    ];
    for (const c of creators.get(item.citekey) ?? []) {
      const family = c.family?.trim();
      if (!family || family.length < 3) continue;
      // case-sensitive: "Land" the author is not "land" the noun; a genitive "Lands" counts
      if (!wordRegex(family, "u", "(?:s|['’]s)?").test(text)) continue;
      const signals: string[] = [];
      const given = c.given?.trim().split(/\s+/)[0];
      if (given && given.length >= 2 && wordRegex(given, "u").test(text)) {
        signals.push(`given name ${given}`);
      }
      const word = titleWords.find((w) => wordRegex(w, "iu").test(text));
      if (word) signals.push(`title word ${word}`);
      if (item.year && wordRegex(item.year, "u").test(text)) signals.push(`year ${item.year}`);
      if (signals.length === 0) continue;
      reasons.push(`author ${family}`, ...signals);
      score += 2 + signals.length;
      break;
    }

    if (score < 3) continue;
    out.push({
      citekey: item.citekey,
      title: [item.title, item.subtitle].filter(Boolean).join(": "),
      ...(item.authors ? { authors: item.authors } : {}),
      ...(item.year ? { year: item.year } : {}),
      ...(item.abstract ? { abstract: item.abstract } : {}),
      matched: reasons.join(", "),
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.citekey.localeCompare(b.citekey));
}

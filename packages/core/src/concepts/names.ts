import { stems, words } from "../text.js";

/**
 * Key under which two spellings of a term count as the same name: lowercase, without accents or
 * punctuation, "ß" as "ss", whitespace collapsed. "Doppelte  Kontingenz" and "doppelte kontingenz"
 * share a key, "Autopoiesis" and "Autopoiese" do not (that is what aliases are for).
 */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Trimmed, deduplicated names; the title and names that repeat an earlier one are left out. */
export function dedupeAliases(title: string, aliases: readonly string[]): string[] {
  const seen = new Set([normName(title)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.replace(/\s+/g, " ").trim();
    const key = normName(alias);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** True when the name has a word long enough that a stem match says something. */
function matchable(tokens: string[]): boolean {
  return tokens.some((t) => [...t].length >= 3);
}

/**
 * Whether `text` contains `name` as a run of words, compared by stem so that "Systeme" finds
 * "System" and "selbstreferentielle Systeme" finds "selbstreferentielles System". Short names such
 * as abbreviations must match the whole word.
 */
export function nameMatches(text: string, name: string): boolean {
  const wanted = words(name);
  if (wanted.length === 0 || !matchable(wanted)) return false;
  const have = words(text);
  if (have.length < wanted.length) return false;
  const wantedStems = wanted.map((w) => ({ w: w.toLowerCase(), s: new Set(stems(w)) }));
  for (let i = 0; i + wanted.length <= have.length; i++) {
    let ok = true;
    for (let j = 0; j < wantedStems.length && ok; j++) {
      const h = have[i + j] as string;
      const w = wantedStems[j] as { w: string; s: Set<string> };
      ok =
        [...h.toLowerCase()].length < 4 || w.w.length < 4
          ? h.toLowerCase() === w.w
          : stems(h).some((s) => w.s.has(s));
    }
    if (ok) return true;
  }
  return false;
}

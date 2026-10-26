/** CSL locator labels. */
export type LocatorLabel =
  | "page"
  | "paragraph"
  | "chapter"
  | "section"
  | "volume"
  | "figure"
  | "note"
  | "line"
  | "verse"
  | "column"
  | "folio"
  | "opus"
  | "part"
  | "book"
  | "number"
  | "sub-verbo";

type Terms = { singular: string[]; plural: string[] };

// First entry of each list is the one `termFor` writes; the rest are accepted when reading.
const TERMS: Record<LocatorLabel, { de: Terms; en: Terms }> = {
  page: {
    de: { singular: ["S.", "Seite"], plural: ["S.", "Seiten"] },
    en: { singular: ["p.", "page"], plural: ["pp.", "pages"] },
  },
  paragraph: {
    de: { singular: ["Abs.", "Absatz"], plural: ["Abs.", "Absätze"] },
    en: { singular: ["para.", "paragraph", "¶"], plural: ["paras.", "paragraphs", "¶¶"] },
  },
  chapter: {
    de: { singular: ["Kap.", "Kapitel"], plural: ["Kap.", "Kapitel"] },
    en: { singular: ["chap.", "ch.", "chapter"], plural: ["chaps.", "chs.", "chapters"] },
  },
  section: {
    de: { singular: ["§", "Abschn.", "Abschnitt"], plural: ["§§", "Abschn.", "Abschnitte"] },
    en: { singular: ["sec.", "sect.", "section"], plural: ["secs.", "sects.", "sections"] },
  },
  volume: {
    de: { singular: ["Bd.", "Band"], plural: ["Bde.", "Bände"] },
    en: { singular: ["vol.", "volume"], plural: ["vols.", "volumes"] },
  },
  figure: {
    de: { singular: ["Abb.", "Abbildung"], plural: ["Abb.", "Abbildungen"] },
    en: { singular: ["fig.", "figure"], plural: ["figs.", "figures"] },
  },
  note: {
    de: { singular: ["Anm.", "Fn.", "Anmerkung"], plural: ["Anm.", "Fn.", "Anmerkungen"] },
    en: { singular: ["n.", "note"], plural: ["nn.", "notes"] },
  },
  line: {
    de: { singular: ["Z.", "Zeile"], plural: ["Z.", "Zeilen"] },
    en: { singular: ["l.", "line"], plural: ["ll.", "lines"] },
  },
  verse: {
    de: { singular: ["V.", "Vers"], plural: ["V.", "Verse"] },
    en: { singular: ["v.", "verse"], plural: ["vv.", "verses"] },
  },
  column: {
    de: { singular: ["Sp.", "Spalte"], plural: ["Sp.", "Spalten"] },
    en: { singular: ["col.", "column"], plural: ["cols.", "columns"] },
  },
  folio: {
    de: { singular: ["Fol.", "Folio"], plural: ["Fol.", "Folios"] },
    en: { singular: ["fol.", "folio"], plural: ["fols.", "folios"] },
  },
  opus: {
    de: { singular: ["op.", "Opus"], plural: ["opp.", "Opera"] },
    en: { singular: ["op.", "opus"], plural: ["opp.", "opera"] },
  },
  part: {
    de: { singular: ["Teil", "Tl."], plural: ["Teile", "Tle."] },
    en: { singular: ["pt.", "part"], plural: ["pts.", "parts"] },
  },
  book: {
    de: { singular: ["Buch", "Bk."], plural: ["Bücher", "Bücher"] },
    en: { singular: ["bk.", "book"], plural: ["bks.", "books"] },
  },
  number: {
    de: { singular: ["Nr.", "Nummer"], plural: ["Nrn.", "Nummern"] },
    en: { singular: ["no.", "number"], plural: ["nos.", "numbers"] },
  },
  "sub-verbo": {
    de: { singular: ["s. v.", "s.v."], plural: ["s. vv.", "s.vv."] },
    en: { singular: ["s.v.", "s. v."], plural: ["s.vv.", "s. vv."] },
  },
};

const LOOKUP = new Map<string, LocatorLabel>();
for (const [label, langs] of Object.entries(TERMS) as [
  LocatorLabel,
  (typeof TERMS)[LocatorLabel],
][]) {
  for (const lang of [langs.de, langs.en]) {
    for (const term of [...lang.singular, ...lang.plural]) {
      const key = term.toLowerCase().replace(/\s+/g, " ");
      if (!LOOKUP.has(key)) LOOKUP.set(key, label);
    }
  }
}

/** Every known term, longest first, for building a matching pattern. */
export const LOCATOR_TERMS: string[] = [...LOOKUP.keys()].sort((a, b) => b.length - a.length);

function normalize(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The CSL label of a locator term in German or English ("S.", "pp.", "Abs.", "chap.", "Bd."),
 * singular or plural, in any case. Undefined for text that is not a known term.
 */
export function labelForTerm(term: string): LocatorLabel | undefined {
  return LOOKUP.get(normalize(term));
}

/** The abbreviation to write for a label in `lang` ("de" or "en", region tags are ignored). */
export function termFor(label: LocatorLabel, lang: string, plural: boolean): string {
  const terms = TERMS[label][lang.toLowerCase().startsWith("de") ? "de" : "en"];
  return (plural ? terms.plural : terms.singular)[0] ?? "";
}

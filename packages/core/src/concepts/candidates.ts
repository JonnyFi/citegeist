import { stems } from "../text.js";
import { normName } from "./names.js";

/** One text that may repeat a term: a card (with its source) or a note (no source). */
export interface TermText {
  /** Card id for a card, note id for a note. */
  ref: string;
  /** Citekey of the source for a card; undefined for a note. */
  item?: string | undefined;
  text: string;
}

export interface TermCandidate {
  term: string;
  /** Cards whose text contains the term. */
  cards: string[];
  /** Sources of those cards. */
  items: string[];
  /** Occurrences across cards and notes, for ranking. */
  count: number;
}

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have
having he her here hers him his how i if in into is it its itself just me more most my no nor not
now of off on once only or other our out over own same she should so some such than that the their
them then there these they this those through to too under until up very was we were what when
where which while who whom why will with would you your however therefore thus hence whereas
although within without among across between toward towards upon per via et al etc eg ie
paper papers study studies figure table section chapter result results approach based using used
use example examples case cases one two three first second new different various several many
der die das den dem des ein eine einen einem einer eines und oder aber auch als wie wenn dass daß
weil denn doch noch nur schon sehr mehr viel viele wird werden wurde wurden worden ist sind war
waren sein hat haben hatte hatten kann können konnte muss müssen soll sollen darf dürfen will
wollen nicht kein keine keinen keinem keiner im in am an auf aus bei bis durch für gegen mit nach
ohne seit über um unter von vor zu zum zur zwischen sich sie er es wir ihr ihnen ihre ihrer ihrem
ihren sein seine seiner seinem seinen dieser diese dieses diesem diesen jede jeder jedes jedem
jeden alle allen aller alles andere anderen anderer anderes anderem so dann damit dabei dazu
dadurch daher deshalb jedoch dennoch außerdem also etwa bzw ca vgl siehe folgt wobei sowie
sondern entweder weder zudem hier dort heute immer wieder bereits selbst ganz gar etwas nichts
ersten zweiten dritten erste zweite dritte neue neuen neuer ergebnis ergebnisse beispiel
beispiele fall fälle`.split(/\s+/),
);

const TOKEN = /[\p{L}][\p{L}\p{M}'’-]*[\p{L}]|[\p{L}]/gu;
const MAX_WORDS = 3;
const MIN_UNIGRAM = 7;

interface Tok {
  surface: string;
  low: string;
  stop: boolean;
}

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const surface = m[0];
    const low = surface.toLowerCase();
    out.push({ surface, low, stop: STOP.has(low) || [...low].length < 3 });
  }
  return out;
}

/** The key two inflected forms of a term share: German stem of every word. */
function stemKey(toks: Tok[]): string {
  return toks.map((t) => stems(t.low)[0] ?? t.low).join(" ");
}

interface Acc {
  forms: Map<string, number>;
  cards: Set<string>;
  items: Set<string>;
  count: number;
}

/**
 * Terms that recur across sources: runs of one to three words without stop words at either end,
 * counted by distinct source. A term needs at least `minSources` sources; a single word also
 * needs seven letters, because short words are rarely terms. Terms in `known` (the names of
 * existing concepts, normalized) are left out. Notes add to the count but never to the sources.
 */
export function recurringTerms(
  texts: readonly TermText[],
  opts: { minSources?: number; known?: ReadonlySet<string>; limit?: number } = {},
): TermCandidate[] {
  const minSources = opts.minSources ?? 2;
  const acc = new Map<string, Acc>();
  for (const t of texts) {
    const toks = tokens(t.text);
    const seen = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      for (let n = 1; n <= MAX_WORDS && i + n <= toks.length; n++) {
        const run = toks.slice(i, i + n);
        if (run.some((x) => x.stop)) break;
        if (n === 1 && [...(run[0] as Tok).low].length < MIN_UNIGRAM) continue;
        const key = stemKey(run);
        const surface = run.map((x) => x.surface).join(" ");
        let a = acc.get(key);
        if (!a) {
          a = { forms: new Map(), cards: new Set(), items: new Set(), count: 0 };
          acc.set(key, a);
        }
        a.count++;
        if (seen.has(key)) continue;
        seen.add(key);
        a.forms.set(surface, (a.forms.get(surface) ?? 0) + 1);
        if (t.item) {
          a.cards.add(t.ref);
          a.items.add(t.item);
        }
      }
    }
  }

  const out: Array<TermCandidate & { key: string; words: number }> = [];
  for (const [key, a] of acc) {
    if (a.items.size < minSources) continue;
    const form = [...a.forms.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    const term = form?.[0] ?? key;
    if (opts.known?.has(normName(term))) continue;
    out.push({
      key,
      words: key.split(" ").length,
      term,
      cards: [...a.cards],
      items: [...a.items],
      count: a.count,
    });
  }
  out.sort(
    (a, b) =>
      b.items.length - a.items.length ||
      b.words - a.words ||
      b.count - a.count ||
      a.term.localeCompare(b.term),
  );

  // A word that only ever appears inside a longer term with the same sources is that term's part.
  const kept = out.filter((a) => {
    if (a.words > 1) return true;
    return !out.some(
      (b) =>
        b.words > a.words && b.key.split(" ").includes(a.key) && b.items.length >= a.items.length,
    );
  });
  return kept.slice(0, opts.limit ?? 30).map(({ key: _k, words: _w, ...rest }) => rest);
}

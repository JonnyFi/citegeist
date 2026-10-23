// Synthetic fixture text for the anchoring bench. It imitates what a PDF text layer delivers:
// pages of wrapped lines with end-of-line hyphenation, ligature words, numbers and formulas.
// Every character has an index in "item space" (the concatenation of all line strings), which is
// the ground truth that survives normalisation and perturbation through the origin maps.
import { concat, fromString, type Mapped } from "../mapped.js";
import { buildStream, type StreamUnit, type TextStream } from "../stream.js";

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = `the of and to in is that for with as are by on this we which be from at an or can it
model models attention sequence sequences network networks layer layers training learning language
representation representations transformer encoder decoder optimization gradient stochastic objective
function functions parameter parameters estimate estimates variance bias correction moment moments
convergence regret bound theorem proof algorithm results experiments performance baseline baselines
dataset datasets accuracy translation tokens token embedding embeddings input output vector vectors
matrix matrices softmax dropout regularization normalization residual connection connections
efficient efficiently difference different office effect effective official workflow flow flows
affine define defined definition fine finite figure first field fields buffer buffers suffix
traditional approach approaches method methods analysis analyses structure structures context
contexts evaluation evaluate evaluated pretraining fine-tuning bidirectional unidirectional
state-of-the-art large-scale well-known non-linear self-attention multi-head position-wise
however therefore moreover furthermore consequently additionally specifically particularly
significantly substantially approximately respectively computational computationally
parallelization parallelizable constraint constraints sublinear subsequent introduction
conclusion discussion appendix section sections table tables shown show shows used using use
obtain obtained achieve achieved improve improved improvement improvements outperform outperforms
compared comparison related work prior previous future several many most more less than
each both all any no not only also such these those their its our they them then thus hence
while where when whether because since although through between within without over under
learning-rate initialization hyperparameters hyperparameter validation held-out unlabeled
labeled supervised unsupervised semi-supervised multilingual cross-lingual monolingual vocabulary`
  .split(/\s+/)
  .filter(Boolean);

const SYLL = [
  "ka",
  "lo",
  "mi",
  "ten",
  "sor",
  "bra",
  "vel",
  "dun",
  "pix",
  "qua",
  "rem",
  "zal",
  "fro",
];
const SPECIAL = [
  "(1)",
  "(2)",
  "0.001",
  "0.9",
  "x_t",
  "O(n^2)",
  "§3.2",
  "[12]",
  "2017",
  "β1",
  "ε",
  "α=0.5",
];

function pseudoWord(rand: () => number): string {
  const n = 2 + Math.floor(rand() * 3);
  let w = "";
  for (let i = 0; i < n; i++) w += SYLL[Math.floor(rand() * SYLL.length)];
  return w;
}

export interface FixtureParagraph {
  page: number;
  /** wrapped lines as a PDF text layer delivers them, with hyphens at line ends */
  lines: string[];
  /** item-space base of each line */
  bases: number[];
}

export interface Furniture {
  header: { text: string; base: number };
  footer: { text: string; base: number };
}

export interface Fixture {
  pages: FixtureParagraph[][];
  /** running header and footer per page: in the PDF text layer, absent from the reflow view */
  furniture: Furniture[];
  paragraphs: FixtureParagraph[];
  totalChars: number;
}

export function makeFixture(seed: number, nPages = 14, paragraphsPerPage = 7): Fixture {
  const rand = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)] as T;
  const pages: FixtureParagraph[][] = [];
  const paragraphs: FixtureParagraph[] = [];
  const furniture: Furniture[] = [];
  let base = 0;
  for (let pg = 0; pg < nPages; pg++) {
    const headerText = `Proceedings of the Fixture Conference on Anchoring ${2017 + (pg % 3)}`;
    const header = { text: headerText, base };
    base += headerText.length;
    const onPage: FixtureParagraph[] = [];
    for (let pi = 0; pi < paragraphsPerPage; pi++) {
      const nWords = 40 + Math.floor(rand() * 90);
      const words: string[] = [];
      let sentenceStart = true;
      for (let i = 0; i < nWords; i++) {
        const r = rand();
        let w = r < 0.06 ? pick(SPECIAL) : r < 0.2 ? pseudoWord(rand) : pick(WORDS);
        if (sentenceStart) w = w[0]?.toUpperCase() + w.slice(1);
        sentenceStart = false;
        if (rand() < 0.07) {
          w += ".";
          sentenceStart = true;
        } else if (rand() < 0.06) w += ",";
        words.push(w);
      }
      // wrap greedily at 58 columns, hyphenating long words at the line end now and then
      const lines: string[] = [];
      let cur = "";
      const queue = [...words];
      while (queue.length > 0) {
        const w = queue.shift() as string;
        const next = cur ? `${cur} ${w}` : w;
        if (next.length <= 58) {
          cur = next;
          continue;
        }
        const room = 57 - cur.length - 1;
        if (cur && w.length >= 8 && room >= 4 && rand() < 0.5) {
          const k = Math.min(room, w.length - 3);
          lines.push(`${cur} ${w.slice(0, k)}-`);
          cur = "";
          queue.unshift(w.slice(k));
        } else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
      const bases: number[] = [];
      for (const l of lines) {
        bases.push(base);
        base += l.length;
      }
      const para: FixtureParagraph = { page: pg, lines, bases };
      onPage.push(para);
      paragraphs.push(para);
    }
    const footerText = String(pg + 1);
    const footer = { text: footerText, base };
    base += footerText.length;
    furniture.push({ header, footer });
    pages.push(onPage);
  }
  return { pages, furniture, paragraphs, totalChars: base };
}

/** The text stream as a PDF text layer presents it: one unit per page, "\n" after every line. */
export function pdfUnits(f: Fixture): StreamUnit[] {
  return f.pages.map((paras, page) => {
    let text = "";
    const src: number[] = [];
    const fu = f.furniture[page];
    const line = (str: string, base: number) => {
      text += `${str}\n`;
      for (let k = 0; k < str.length; k++) src.push(base + k);
      src.push(-1);
    };
    if (fu) line(fu.header.text, fu.header.base);
    for (const p of paras) {
      p.lines.forEach((l, i) => {
        text += `${l}\n`;
        for (let k = 0; k < l.length; k++) src.push((p.bases[i] ?? 0) + k);
        src.push(-1);
      });
    }
    if (fu) line(fu.footer.text, fu.footer.base);
    return { text, src, spans: [{ page, label: String(page + 1), start: 0, end: text.length }] };
  });
}

export function pdfStream(f: Fixture): TextStream {
  return buildStream(pdfUnits(f));
}

/** Reflow paragraphs: lines joined, end-of-line hyphenation removed, origin map kept. */
export function reflowParagraphs(f: Fixture): { m: Mapped; page: number }[] {
  return f.paragraphs.map((p) => {
    let acc: Mapped | null = null;
    p.lines.forEach((l, i) => {
      const line = fromString(l, p.bases[i] ?? 0);
      if (!acc) {
        acc = line;
        return;
      }
      const prev: Mapped = acc;
      if (/\p{L}-$/u.test(prev.text) && /^\p{Ll}/u.test(l)) {
        acc = concat([{ text: prev.text.slice(0, -1), src: prev.src.slice(0, -1) }, line], "");
      } else acc = concat([prev, line], " ");
    });
    return { m: acc ?? { text: "", src: [] }, page: p.page };
  });
}

export function reflowUnits(paras: { m: Mapped; page: number }[]): StreamUnit[] {
  return paras.map(({ m, page }) => ({
    text: m.text,
    src: m.src,
    spans: [{ page, label: String(page + 1), start: 0, end: m.text.length }],
  }));
}

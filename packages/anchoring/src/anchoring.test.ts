import type { Block } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import {
  buildBlockStream,
  buildPageStream,
  createSelectionAnchor,
  createTextAnchor,
  findQuote,
  fromString,
  locate,
  locatorFor,
  normalize,
  normalizeText,
  resolveAnchor,
  snapToWordBoundaries,
  snapToWords,
} from "./index.js";

describe("norm-v1", () => {
  it("folds ligatures, joins hyphenation, collapses whitespace", () => {
    expect(normalizeText("oﬃce  eﬀect\n flow")).toBe("office effect flow");
    expect(normalizeText("inter-\nnational  law")).toBe("international law");
    expect(normalizeText("soft­hyphen")).toBe("softhyphen");
    expect(normalizeText("  trimmed text \n")).toBe("trimmed text");
  });

  it("keeps a hyphen before an uppercase letter or a digit", () => {
    expect(normalizeText("Jean-\nPaul")).toBe("Jean- Paul");
    expect(normalizeText("COVID-\n19")).toBe("COVID- 19");
  });

  it("composes combining marks (NFC)", () => {
    expect(normalizeText("Café")).toBe("Café");
  });

  it("keeps a per-character origin map", () => {
    const m = normalize(fromString("aﬁb  c", 10));
    expect(m.text).toBe("afib c");
    // ligature characters point to the ligature, the space run to its first space
    expect(m.src).toEqual([10, 11, 11, 12, 13, 15]);
  });
});

describe("word-boundary snapping", () => {
  it("extends both edges to whole words", () => {
    const t = "we saw that outperforms both sides of the rule";
    const s = t.indexOf("s both");
    const e = t.indexOf("rule") + 2;
    const r = snapToWords(t, s, e);
    expect(t.slice(r.start, r.end)).toBe("outperforms both sides of the rule");
  });

  it("leaves ranges that sit on word boundaries alone", () => {
    const t = "one two three";
    expect(snapToWords(t, 4, 7)).toEqual({ start: 4, end: 7 });
  });
});

describe("snapping a card selection to word boundaries", () => {
  const t =
    "the nature of modern life: the problem of Kommunikationsschwierigkeiten, Luhmann's view";
  const snap = (from: string, to: string) => {
    const s = t.indexOf(from);
    const e = t.indexOf(to, s) + to.length;
    const r = snapToWordBoundaries(t, s, e);
    return t.slice(r.start, r.end);
  };

  it("completes a word that the selection ends in", () => {
    // the reported bug: the selection ended in "th" of "the"
    expect(snap("nature of modern life: th", "life: th")).toBe("nature of modern life: the");
  });

  it("completes a word that the selection starts in", () => {
    expect(snap("ature of modern", "modern")).toBe("nature of modern");
    expect(snap("odern life", "life")).toBe("modern life");
  });

  it("completes both edges at once and keeps long German compounds whole", () => {
    expect(snap("ommunikationsschwier", "schwier")).toBe("Kommunikationsschwierigkeiten");
  });

  it("treats an apostrophe between letters as part of the word", () => {
    expect(snap("Luhmann", "Luhmann")).toBe("Luhmann's");
    expect(snap("Luhmann'", "Luhmann'")).toBe("Luhmann's");
    expect(snap("s view", "view")).toBe("Luhmann's view");
  });

  it("leaves a selection on word boundaries alone, and a hyphen splits words", () => {
    expect(snap("of modern", "modern")).toBe("of modern");
    const h = "a state-of-the-art method";
    const s = h.indexOf("of");
    expect(snapToWordBoundaries(h, s, s + 2)).toEqual({ start: s, end: s + 2 });
  });

  it("trims edge whitespace and punctuation stays out", () => {
    const s = t.indexOf(" nature");
    const e = t.indexOf("life:") + 5;
    const r = snapToWordBoundaries(t, s, e);
    expect(t.slice(r.start, r.end)).toBe("nature of modern life:");
  });

  it("leaves a runaway token alone and never crosses into the neighbouring word", () => {
    const digits = `x ${"1234567890".repeat(20)} y`;
    const r = snapToWordBoundaries(digits, 100, 110);
    expect(r).toEqual({ start: 100, end: 110 });
    expect(snap("life: the", "the")).toBe("life: the");
  });

  it("never grows an empty selection", () => {
    const r = snapToWordBoundaries(t, 5, 5);
    expect(r.end).toBeLessThanOrEqual(r.start);
  });

  it("builds the anchor from the snapped range, with the context around it", () => {
    const stream = buildPageStream(["Intro text. The nature of modern life: the problem is deep."]);
    const s = stream.text.indexOf("nature");
    const e = stream.text.indexOf("life: th") + "life: th".length;
    const plain = createTextAnchor(stream, s, e);
    expect(plain?.exact).toBe("nature of modern life: th");
    const snapped = createSelectionAnchor(stream, s, e);
    expect(snapped?.exact).toBe("nature of modern life: the");
    expect(snapped?.start).toBe(s);
    expect(snapped?.end).toBe(e + 1);
    expect(snapped?.prefix.endsWith("The ")).toBe(true);
    expect(snapped?.suffix.startsWith(" problem")).toBe(true);
    // the snapped quote resolves back to itself
    const r = resolveAnchor(stream, snapped as NonNullable<typeof snapped>);
    expect(r).toMatchObject({ status: "anchored", method: "position" });
  });

  it("does not join words across the units of a stream", () => {
    const stream = buildPageStream(["end of page one", "start of page two"]);
    const s = stream.text.indexOf("one");
    const snapped = createSelectionAnchor(stream, s, s + 2);
    expect(snapped?.exact).toBe("one");
    const start = stream.text.indexOf("start") + 2;
    expect(createSelectionAnchor(stream, start - 6, start)?.exact).toBe("one start");
  });
});

const block = (
  id: string,
  text: string,
  spans: Block["spans"],
  extra: Partial<Block> = {},
): Block => ({
  id,
  type: "paragraph",
  flow: "body",
  text,
  spans,
  src: { engine: "test" },
  ...extra,
});

const BLOCKS: Block[] = [
  block("bfurn001", "Journal of Tests 2026", [{ page: 0, label: "9", start: 0, end: 21 }], {
    type: "page-furniture",
    flow: "furniture",
  }),
  block("bpara001", "Systems differentiate themselves from their environment by closure.", [
    { page: 0, label: "9", start: 0, end: 65 },
  ]),
  block(
    "bpara002",
    "Communication is the elementary operation of social systems. It cannot be reduced to action. The unity of the three selections is not given in advance.",
    [
      { page: 0, label: "9", start: 0, end: 93 },
      { page: 1, label: "10", start: 93, end: 151 },
    ],
  ),
  block(
    "bpara003",
    "Observation presupposes a distinction, and every distinction has a marked side.",
    [{ page: 1, label: "10", start: 0, end: 77 }],
  ),
];

describe("block streams", () => {
  const stream = buildBlockStream(BLOCKS);

  it("skips page furniture and keeps block ids", () => {
    expect(stream.text).not.toContain("Journal of Tests");
    expect(stream.units.map((u) => u.id)).toEqual(["bpara001", "bpara002", "bpara003"]);
  });

  it("derives page ranges from spans", () => {
    expect(stream.pages.map((p) => [p.page, p.label])).toEqual([
      [0, "9"],
      [1, "10"],
    ]);
    const p1 = stream.pages[1];
    expect(stream.text.slice(p1?.start, p1?.end)).toContain("The unity of the three selections");
  });

  it("maps a range to blocks, page index and printed page label", () => {
    const quote = "It cannot be reduced to action.";
    const at = stream.text.indexOf(quote);
    const loc = locate(stream, at, at + quote.length);
    expect(loc.blocks).toEqual([{ id: "bpara002", start: 61, end: 61 + quote.length }]);
    expect(loc.first).toEqual({ page: 0, label: "9" });
    expect(locatorFor(loc)).toEqual({ label: "page", start: "9", confirmed: false });
  });

  it("gives a page-spanning range a start and an end label", () => {
    const quote = "reduced to action. The unity of the three selections";
    const at = stream.text.indexOf(quote);
    const loc = locate(stream, at, at + quote.length);
    expect(loc.pages).toEqual([
      { page: 0, label: "9" },
      { page: 1, label: "10" },
    ]);
    expect(locatorFor(loc)).toEqual({ label: "page", start: "9", end: "10", confirmed: false });
  });

  it("spans two blocks", () => {
    const quote = "by closure. Communication is";
    const at = stream.text.indexOf(quote);
    const loc = locate(stream, at, at + quote.length);
    expect(loc.blocks.map((b) => b.id)).toEqual(["bpara001", "bpara002"]);
  });

  it("creates a text anchor with 32 characters of context and a block hint", () => {
    const quote = "Observation presupposes a distinction";
    const at = stream.text.indexOf(quote);
    const a = createTextAnchor(stream, at, at + quote.length);
    expect(a?.exact).toBe(quote);
    expect(a?.block).toBe("bpara003");
    expect(a?.prefix.length).toBe(32);
    expect(a?.suffix).toBe(", and every distinction has a ma");
    expect(a?.start).toBe(at);
  });
});

describe("resolve", () => {
  const old = buildBlockStream(BLOCKS);
  const quote = "Communication is the elementary operation of social systems.";
  const at = old.text.indexOf(quote);
  const anchor = createTextAnchor(old, at, at + quote.length);
  if (!anchor) throw new Error("anchor");

  it("uses the verified position first", () => {
    const r = resolveAnchor(old, anchor);
    expect(r).toMatchObject({ status: "anchored", method: "position", start: at });
  });

  it("falls back to the exact quote when the document shifted", () => {
    const shifted = buildBlockStream([
      block("bnew00001", "A new first paragraph that moves everything.", [
        { page: 0, label: "9", start: 0, end: 44 },
      ]),
      ...BLOCKS,
    ]);
    const r = resolveAnchor(shifted, anchor);
    expect(r).toMatchObject({ status: "anchored", method: "exact" });
    if (r.status === "anchored") expect(shifted.text.slice(r.start, r.end)).toBe(quote);
  });

  it("finds a quote with a changed word fuzzily and in the page window", () => {
    const changed = BLOCKS.map((b) =>
      b.id === "bpara002" ? { ...b, text: b.text.replace("elementary", "elemental") } : b,
    );
    const target = buildBlockStream(changed);
    const r = resolveAnchor(target, anchor);
    expect(r.status).toBe("anchored");
    if (r.status === "anchored") {
      expect(r.method).toBe("fuzzy-window");
      expect(r.quoteScore).toBeGreaterThanOrEqual(0.9);
      expect(target.text.slice(r.start, r.end)).toContain("elemental operation");
    }
  });

  it("orphans a quote whose text was deleted", () => {
    const target = buildBlockStream(BLOCKS.filter((b) => b.id !== "bpara002"));
    expect(resolveAnchor(target, anchor).status).toBe("orphaned");
  });

  it("flags duplicated text as ambiguous", () => {
    const dup = buildBlockStream([...BLOCKS, { ...BLOCKS[2], id: "bpara004" } as Block]);
    const r = resolveAnchor(dup, { exact: quote, prefix: "", suffix: "" });
    expect(r.status === "anchored" && r.ambiguous).toBe(true);
  });

  it("prefers the hit on the hinted page for a bare quote", () => {
    const q = "every distinction has a marked side";
    const two = buildBlockStream([
      ...BLOCKS,
      block("bpara009", `Remember: ${q}.`, [{ page: 5, label: "14", start: 0, end: 50 }]),
    ]);
    const r = findQuote(two, q, { pageHint: 1 });
    expect(r.status === "anchored" && two.text.slice(r.start, r.end)).toBe(q);
    if (r.status === "anchored") expect(r.start).toBeLessThan(two.text.indexOf("Remember"));
  });
});

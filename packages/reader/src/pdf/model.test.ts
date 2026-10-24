import { rangeFromSource, resolveAnchor } from "@citegeist/anchoring";
import { describe, expect, it } from "vitest";
import { anchorsForRange } from "../anchors.js";
import { FIXTURE_LABELS, FIXTURE_PAGES, fixtureStream } from "../testing/fixture.js";
import {
  buildPageTexts,
  buildPdfStream,
  domRectsToPdfRects,
  itemOfSource,
  pdfRectToBox,
  type RawTextItem,
  textRangeToRects,
} from "./model.js";

/** One text item per printed line, like a PDF text layer of generated text. */
function rawPages(): RawTextItem[][] {
  return FIXTURE_PAGES.map((paras) => {
    let y = 720;
    const items: RawTextItem[] = [];
    for (const p of paras) {
      for (const line of p.lines) {
        items.push({
          str: line,
          transform: [11, 0, 0, 11, 72, y],
          width: line.length * 5.5,
          height: 11,
          hasEOL: false,
        });
        y -= 16;
      }
      y -= 10;
    }
    return items;
  });
}

const viewport = {
  convertToPdfPoint: (x: number, y: number) => [x / 1.5, 792 - y / 1.5],
  convertToViewportPoint: (x: number, y: number) => [x * 1.5, (792 - y) * 1.5],
};

describe("pdf text model", () => {
  const pages = buildPageTexts(rawPages());
  const stream = buildPdfStream(pages, FIXTURE_LABELS);

  it("breaks lines by baseline and joins hyphenation in the normalised stream", () => {
    expect(pages[0]?.text.split("\n")).toHaveLength(8);
    expect(stream.text).toContain("presupposes a distinction, and every distinction");
    expect(stream.pages.map((p) => p.label)).toEqual(FIXTURE_LABELS);
  });

  it("makes a text anchor from a stream range and locates it on a printed page", () => {
    const quote = "Meaning is the medium in which psychic and social systems reproduce themselves.";
    const at = stream.text.indexOf(quote);
    expect(at).toBeGreaterThan(0);
    const base = pages[1]?.base ?? 0;
    expect(rangeFromSource(stream, base, base + 40)).not.toBeNull();
    const anchors = anchorsForRange(stream, at, at + quote.length);
    expect(anchors?.quote).toBe(quote);
    expect(anchors?.location.first).toEqual({ page: 1, label: "10" });
  });

  it("uses the canonical block stream for the anchor when given", () => {
    const canonical = fixtureStream();
    const quote = "Closure does not mean isolation";
    const at = stream.text.indexOf(quote);
    const anchors = anchorsForRange(stream, at, at + quote.length, canonical);
    expect(anchors?.textAnchor.block).toBe("bpara0002");
    expect(anchors?.location.blocks[0]?.id).toBe("bpara0002");
    if (anchors) expect(resolveAnchor(stream, anchors.textAnchor).status).toBe("anchored");
  });

  it("snaps a quote that ends or starts in the middle of a word", () => {
    const at = stream.text.indexOf("Closure does not mean isolation");
    const cut = anchorsForRange(stream, at, at + "Closure does not mean isola".length);
    expect(cut?.quote).toBe("Closure does not mean isolation");
    expect(cut?.textAnchor.end).toBe(at + "Closure does not mean isolation".length);
    const late = anchorsForRange(stream, at + 2, at + "Closure does not mean isolation".length);
    expect(late?.quote).toBe("Closure does not mean isolation");
    // a hyphenated word that the stream has joined counts as one word
    const d = stream.text.indexOf("distinction");
    expect(anchorsForRange(stream, d + 2, d + 6)?.quote).toBe("distinction");
  });

  it("finds the text item and offset of a source offset", () => {
    const page = pages[0];
    if (!page) throw new Error("page");
    const second = page.items[1];
    if (!second) throw new Error("item");
    expect(itemOfSource(pages, page.base + second.start + 3, false)).toEqual({
      page: 0,
      item: 1,
      offset: 3,
    });
    // a range end is the offset after the last character, so it can reach the item length
    expect(itemOfSource(pages, page.base + second.start + second.str.length, true)).toEqual({
      page: 0,
      item: 1,
      offset: second.str.length,
    });
    // the line break after an item belongs to no item
    expect(itemOfSource(pages, page.base + second.start + second.str.length, false)).toBeNull();
    expect(itemOfSource(pages, -1, false)).toBeNull();
  });

  it("converts a page-text range to line rects and back through a viewport", () => {
    const page = pages[0];
    if (!page) throw new Error("page");
    const a = page.text.indexOf("Communication");
    const b = page.text.indexOf("action.") + "action.".length;
    const rects = textRangeToRects(page, a, b);
    expect(rects).toHaveLength(2);
    const first = rects[0] ?? [0, 0, 0, 0];
    const box = pdfRectToBox(first, viewport);
    const back = domRectsToPdfRects(
      [
        {
          left: box.left,
          top: box.top,
          right: box.left + box.width,
          bottom: box.top + box.height,
          width: box.width,
          height: box.height,
        },
      ],
      { left: 0, top: 0 },
      viewport,
    );
    expect(back[0]?.[0]).toBeCloseTo(first[0], 3);
    expect(back[0]?.[3]).toBeCloseTo(first[3], 3);
  });
});

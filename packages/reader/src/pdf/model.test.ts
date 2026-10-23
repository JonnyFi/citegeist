import { rangeFromSource, resolveAnchor } from "@citegeist/anchoring";
import { describe, expect, it } from "vitest";
import { anchorsForRange } from "../anchors.js";
import { FIXTURE_LABELS, FIXTURE_PAGES, fixtureStream } from "../testing/fixture.js";
import {
  buildPageTexts,
  buildPdfStream,
  domRectsToPdfRects,
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

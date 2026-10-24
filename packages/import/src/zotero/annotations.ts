import type { SourceAnnotation } from "../types.js";

/** A quote card made from a Zotero PDF annotation, before the PDF has a source hash. */
export interface CardDraft {
  ref: string;
  /** The highlighted text, verbatim. */
  quote: string;
  /** The reader's comment; it goes into the note. */
  note?: string;
  /** Zero-based page index. */
  page: number;
  /** Rectangles in PDF user space, `[x1, y1, x2, y2]`, as Zotero stores them. */
  quads: [number, number, number, number][];
  /** Printed page label, which becomes the locator. */
  pageLabel?: string;
  tags: string[];
}

export interface AnnotationSkip {
  code: string;
  message: string;
}

/** The PDF position of an annotation: page index and rectangles, or undefined when it has none. */
export function parsePdfPosition(
  json: string,
): { page: number; quads: [number, number, number, number][] } | undefined {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const { pageIndex, rects } = data as { pageIndex?: unknown; rects?: unknown };
  if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) {
    return undefined;
  }
  if (!Array.isArray(rects)) return undefined;
  const quads: [number, number, number, number][] = [];
  for (const r of rects) {
    if (
      Array.isArray(r) &&
      r.length === 4 &&
      r.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      quads.push([r[0], r[1], r[2], r[3]] as [number, number, number, number]);
    }
  }
  return quads.length > 0 ? { page: pageIndex, quads } : undefined;
}

/**
 * Converts a highlight or underline with text into a card draft. Image, ink and text annotations
 * and notes without a highlighted passage have no verbatim quote, so they are skipped.
 */
export function annotationToCard(
  a: SourceAnnotation,
): { card: CardDraft } | { skip: AnnotationSkip } {
  if (a.type !== "highlight" && a.type !== "underline") {
    return {
      skip: {
        code: "ANNOTATION_TYPE_UNSUPPORTED",
        message: `${a.type} annotations have no quotable text and were not imported`,
      },
    };
  }
  const quote = a.text.replace(/\r\n?/g, "\n").trim();
  if (quote === "") {
    return {
      skip: {
        code: "ANNOTATION_NO_TEXT",
        message: `${a.type} without extracted text was not imported`,
      },
    };
  }
  const position = parsePdfPosition(a.position);
  if (!position) {
    return {
      skip: {
        code: "ANNOTATION_POSITION_UNSUPPORTED",
        message:
          "the annotation has no PDF position (EPUB and snapshot annotations are not imported)",
      },
    };
  }
  const comment = a.comment.trim();
  return {
    card: {
      ref: a.ref,
      quote,
      ...(comment ? { note: comment } : {}),
      page: position.page,
      quads: position.quads,
      ...(a.pageLabel ? { pageLabel: a.pageLabel } : {}),
      tags: a.tags,
    },
  };
}
